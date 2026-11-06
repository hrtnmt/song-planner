// Actions for 演奏したい曲リスト: the user's personal want-to-play song list.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import * as schema from "./schema";

const genreEnum = z.enum(["吹奏楽", "ピアノ", "室内楽", "管弦楽", "合唱", "その他"]);
const statusEnum = z.enum(["いつか演奏したい", "練習中", "演奏済み"]);
const eraEnum = z.enum(["バロック", "古典派", "ロマン派", "近現代", "現代", "その他"]);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式の日付が必要です");

const songShape = z.object({
  id: z.number(),
  title: z.string(),
  composer: z.string(),
  genre: genreEnum,
  status: statusEnum,
  priority: z.number(),
  note: z.string(),
  era: eraEnum.nullable(),
  eraYear: z.number().nullable(),
  readingStart: z.string().nullable(),
  finishDeadline: z.string().nullable(),
  performanceDate: z.string().nullable(),
  performanceName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const relationShape = z.object({
  id: z.number(),
  fromSongId: z.number(),
  toSongId: z.number(),
  groupKey: z.number(),
});

type SongRow = typeof schema.songs.$inferSelect;
type RelationRow = typeof schema.songRelations.$inferSelect;

function toSong(row: SongRow) {
  return {
    id: row.id,
    title: row.title,
    composer: row.composer,
    genre: row.genre,
    status: row.status,
    priority: row.priority,
    note: row.note,
    era: row.era,
    eraYear: row.eraYear,
    readingStart: row.readingStart,
    finishDeadline: row.finishDeadline,
    performanceDate: row.performanceDate,
    performanceName: row.performanceName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRelation(row: RelationRow) {
  return {
    id: row.id,
    fromSongId: row.fromSongId,
    toSongId: row.toSongId,
    groupKey: row.groupKey,
  };
}

const listResponse = z.object({
  songs: z.array(songShape),
  relations: z.array(relationShape),
});

// Asia/Tokyo の今日 (YYYY-MM-DD)。期限判定はすべてこの暦日基準。
function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const scheduleItemShape = z.object({
  songId: z.number(),
  title: z.string(),
  performanceName: z.string(),
  readingStart: z.string().nullable(),
  finishDeadline: z.string().nullable(),
  performanceDate: z.string().nullable(),
});

const scheduleResponse = z.object({
  today: z.string(),
  weekLater: z.string(),
  // 今日から7日以内に「1週間前」を迎える (または過ぎた) 期限・本番
  dueWithinWeek: z.array(
    scheduleItemShape.extend({
      kind: z.enum(["仕上げ期限", "本番"]),
      date: z.string(),
      daysLeft: z.number(),
    }),
  ),
  // 今日が譜読み開始日ちょうど〜7日前の曲
  readingSoon: z.array(
    scheduleItemShape.extend({ startsInDays: z.number() }),
  ),
  upcoming: z.array(scheduleItemShape),
});

async function loadSchedule(
  ctx: Ctx,
): Promise<z.infer<typeof scheduleResponse>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.songs);
  const today = todayJst();
  const weekLater = addDays(today, 7);

  const dayDiff = (target: string) =>
    Math.round(
      (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    );

  const base = (row: SongRow) => ({
    songId: row.id,
    title: row.title,
    performanceName: row.performanceName,
    readingStart: row.readingStart,
    finishDeadline: row.finishDeadline,
    performanceDate: row.performanceDate,
  });

  const dueWithinWeek: z.infer<typeof scheduleResponse>["dueWithinWeek"] = [];
  const readingSoon: z.infer<typeof scheduleResponse>["readingSoon"] = [];
  const upcoming: z.infer<typeof scheduleResponse>["upcoming"] = [];

  for (const row of rows) {
    // 演奏済みの曲はリマインド対象外 (本番・期限は過ぎたものとして扱う)
    if (row.status !== "演奏済み") {
      if (row.finishDeadline && row.finishDeadline <= weekLater) {
        dueWithinWeek.push({
          ...base(row),
          kind: "仕上げ期限",
          date: row.finishDeadline,
          daysLeft: dayDiff(row.finishDeadline),
        });
      }
      if (row.performanceDate && row.performanceDate <= weekLater) {
        dueWithinWeek.push({
          ...base(row),
          kind: "本番",
          date: row.performanceDate,
          daysLeft: dayDiff(row.performanceDate),
        });
      }
      if (row.readingStart && row.readingStart >= today && row.readingStart <= weekLater) {
        readingSoon.push({ ...base(row), startsInDays: dayDiff(row.readingStart) });
      }
    }
    if (
      row.readingStart ||
      row.finishDeadline ||
      row.performanceDate
    ) {
      upcoming.push(base(row));
    }
  }

  dueWithinWeek.sort((a, b) => a.date.localeCompare(b.date));
  readingSoon.sort((a, b) => a.startsInDays - b.startsInDays);
  const nextDate = (item: z.infer<typeof scheduleItemShape>) =>
    [item.performanceDate, item.finishDeadline, item.readingStart]
      .filter((d): d is string => typeof d === "string" && d >= today)
      .sort()[0] ?? "9999-12-31";
  upcoming.sort((a, b) => nextDate(a).localeCompare(nextDate(b)));

  return { today, weekLater, dueWithinWeek, readingSoon, upcoming };
}

export const Actions = {
  listSongs: defineAction({
    description:
      "Lists all registered songs and their roadmap relations. Sorts by priority, recency, composer, or era.",
    request: z.object({
      sort: z
        .enum(["priority", "newest", "oldest", "composer", "era"])
        .default("priority"),
    }),
    response: listResponse,
    async handler(ctx, args): Promise<z.infer<typeof listResponse>> {
      const db = ctx.db<typeof schema>();
      const order =
        args.sort === "newest"
          ? [desc(schema.songs.id)]
          : args.sort === "oldest"
            ? [asc(schema.songs.id)]
            : args.sort === "composer"
              ? [asc(schema.songs.composer), desc(schema.songs.priority), desc(schema.songs.id)]
              : [desc(schema.songs.priority), desc(schema.songs.id)];
      const rows = await db.select().from(schema.songs).orderBy(...order);
      let songs = rows.map(toSong);
      if (args.sort === "era") {
        const eraRank = new Map<string, number>(
          eraEnum.options.map((e, i) => [e, i]),
        );
        songs = [...songs].sort((a, b) => {
          const rankA = a.era ? (eraRank.get(a.era) ?? 99) : 99;
          const rankB = b.era ? (eraRank.get(b.era) ?? 99) : 99;
          if (rankA !== rankB) return rankA - rankB;
          const yearA = a.eraYear ?? Number.MAX_SAFE_INTEGER;
          const yearB = b.eraYear ?? Number.MAX_SAFE_INTEGER;
          if (yearA !== yearB) return yearA - yearB;
          return b.priority - a.priority || b.id - a.id;
        });
      }
      const relRows = await db
        .select()
        .from(schema.songRelations)
        .orderBy(asc(schema.songRelations.id));
      return { songs, relations: relRows.map(toRelation) };
    },
  }),

  addSong: defineAction({
    description: "Registers a new song the user wants to play.",
    request: z.object({
      title: z.string().trim().min(1).max(200),
      composer: z.string().trim().max(200).default(""),
      genre: genreEnum.default("その他"),
      status: statusEnum.default("いつか演奏したい"),
      priority: z.number().int().min(1).max(3).default(2),
      note: z.string().trim().max(2000).default(""),
      era: eraEnum.nullable().default(null),
      eraYear: z.number().int().min(1).max(2100).nullable().default(null),
      readingStart: dateString.nullable().default(null),
      finishDeadline: dateString.nullable().default(null),
      performanceDate: dateString.nullable().default(null),
      performanceName: z.string().trim().max(200).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.songs)
        .values({
          title: args.title,
          composer: args.composer,
          genre: args.genre,
          status: args.status,
          priority: args.priority,
          note: args.note,
          era: args.era,
          eraYear: args.eraYear,
          readingStart: args.readingStart,
          finishDeadline: args.finishDeadline,
          performanceDate: args.performanceDate,
          performanceName: args.performanceName,
        })
        .returning({ id: schema.songs.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addSong: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateSong: defineAction({
    description: "Updates fields of an existing song entry.",
    request: z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(200).optional(),
      composer: z.string().trim().max(200).optional(),
      genre: genreEnum.optional(),
      status: statusEnum.optional(),
      priority: z.number().int().min(1).max(3).optional(),
      note: z.string().trim().max(2000).optional(),
      era: eraEnum.nullable().optional(),
      eraYear: z.number().int().min(1).max(2100).nullable().optional(),
      readingStart: dateString.nullable().optional(),
      finishDeadline: dateString.nullable().optional(),
      performanceDate: dateString.nullable().optional(),
      performanceName: z.string().trim().max(200).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const { id, ...fields } = args;
      await db
        .update(schema.songs)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.songs.id, id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteSong: defineAction({
    description: "Deletes a song entry and any roadmap relations touching it.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.batch([
        db
          .delete(schema.songRelations)
          .where(
            or(
              eq(schema.songRelations.fromSongId, args.id),
              eq(schema.songRelations.toSongId, args.id),
            ),
          ),
        db.delete(schema.songs).where(eq(schema.songs.id, args.id)),
      ]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addRelation: defineAction({
    description:
      "Adds a roadmap arrow: finish fromSong before moving on to toSong. Relations to the same target with different groupKey values are OR alternatives; same groupKey means AND.",
    request: z.object({
      fromSongId: z.number().int().positive(),
      toSongId: z.number().int().positive(),
      groupKey: z.number().int().min(0).max(99).default(0),
    }),
    response: z.object({
      ok: z.boolean(),
      reason: z.string().nullable(),
      id: z.number().nullable(),
    }),
    async handler(ctx, args) {
      if (args.fromSongId === args.toSongId) {
        return { ok: false, reason: "同じ曲同士はつなげません", id: null };
      }
      const db = ctx.db<typeof schema>();
      const songRows = await db
        .select({ id: schema.songs.id })
        .from(schema.songs)
        .where(inArray(schema.songs.id, [args.fromSongId, args.toSongId]));
      if (songRows.length < 2) {
        return { ok: false, reason: "曲が見つかりません", id: null };
      }
      const existing = await db
        .select()
        .from(schema.songRelations)
        .where(
          and(
            eq(schema.songRelations.fromSongId, args.fromSongId),
            eq(schema.songRelations.toSongId, args.toSongId),
          ),
        );
      if (existing.length > 0) {
        return { ok: false, reason: "その矢印はすでにつながっています", id: null };
      }
      // 循環チェック: toSong から fromSong へ既存の矢印でたどれる場合は不可
      const all = await db.select().from(schema.songRelations);
      const adjacency = new Map<number, number[]>();
      for (const rel of all) {
        const list = adjacency.get(rel.fromSongId) ?? [];
        list.push(rel.toSongId);
        adjacency.set(rel.fromSongId, list);
      }
      const visited = new Set<number>();
      const stack = [args.toSongId];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === undefined) break;
        if (cur === args.fromSongId) {
          return {
            ok: false,
            reason: "循環してしまうため、この矢印は引けません",
            id: null,
          };
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const next of adjacency.get(cur) ?? []) stack.push(next);
      }
      const result = await db
        .insert(schema.songRelations)
        .values({
          fromSongId: args.fromSongId,
          toSongId: args.toSongId,
          groupKey: args.groupKey,
        })
        .returning({ id: schema.songRelations.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addRelation: insert returned no rows");
      ctx.invalidateQueries();
      return { ok: true, reason: null, id: inserted.id };
    },
  }),

  deleteRelation: defineAction({
    description: "Removes one roadmap arrow by its relation id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.songRelations)
        .where(eq(schema.songRelations.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getSchedule: defineAction({
    description:
      "Returns the schedule overview: deadlines and performances within 7 days (the 1-week-before reminder window), reading starts coming up, and all dated songs.",
    request: z.object({}),
    response: scheduleResponse,
    async handler(ctx): Promise<z.infer<typeof scheduleResponse>> {
      return loadSchedule(ctx);
    },
  }),

  refreshSchedule: defineAction({
    description:
      "Daily silent refresh entry point (no chat delivery): recomputes the deadline window so the reminder banner is current. The user-facing notification is delivered by the artifact's agent schedule, which reads this data and messages 1 week / 3 days / 1 day before and on the day.",
    request: z.object({}),
    response: scheduleResponse,
    async handler(ctx): Promise<z.infer<typeof scheduleResponse>> {
      return loadSchedule(ctx);
    },
  }),
} satisfies ActionsModule;
