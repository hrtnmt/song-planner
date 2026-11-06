// Drizzle schema for this space: the user's want-to-play song list.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const songs = sqliteTable("songs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  composer: text("composer").notNull().default(""),
  genre: text("genre", {
    enum: ["吹奏楽", "ピアノ", "室内楽", "管弦楽", "合唱", "その他"],
  })
    .notNull()
    .default("その他"),
  status: text("status", {
    enum: ["いつか演奏したい", "練習中", "演奏済み"],
  })
    .notNull()
    .default("いつか演奏したい"),
  priority: integer("priority").notNull().default(2), // 1..3 (3 = とくに弾きたい)
  note: text("note").notNull().default(""),
  // 時代区分 (バロック/古典派/ロマン派/近現代/現代/その他)。未設定は null。
  era: text("era", {
    enum: ["バロック", "古典派", "ロマン派", "近現代", "現代", "その他"],
  }),
  // 作曲年 (西暦)。時代ソートの補助に使う任意項目。
  eraYear: integer("era_year"),
  // スケジュール: YYYY-MM-DD (JST の暦日)。未設定は null。
  readingStart: text("reading_start"),
  finishDeadline: text("finish_deadline"),
  performanceDate: text("performance_date"),
  performanceName: text("performance_name").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ロードマップの矢印: from_song を終えてから to_song へ進む。
// 同じ to_song に対する行のうち group_key が異なるものは OR グループ
// (どれか1グループを満たせばよい)。同じ group_key 内は AND。
export const songRelations = sqliteTable("song_relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromSongId: integer("from_song_id").notNull(),
  toSongId: integer("to_song_id").notNull(),
  groupKey: integer("group_key").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
