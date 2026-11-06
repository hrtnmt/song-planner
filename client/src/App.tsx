import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type Song = ApiResponse<typeof api, "listSongs">["songs"][number];
type Relation = ApiResponse<typeof api, "listSongs">["relations"][number];
type Schedule = ApiResponse<typeof api, "getSchedule">;
type Genre = Song["genre"];
type Status = Song["status"];
type Era = NonNullable<Song["era"]>;
type SortKey = "priority" | "newest" | "oldest" | "composer" | "era";

const GENRES: Genre[] = ["吹奏楽", "ピアノ", "室内楽", "管弦楽", "合唱", "その他"];
const STATUSES: Status[] = ["いつか演奏したい", "練習中", "演奏済み"];
const ERAS: Era[] = ["バロック", "古典派", "ロマン派", "近現代", "現代", "その他"];

const STATUS_STYLE: Record<Status, string> = {
  いつか演奏したい: "border-[var(--dim)] text-[var(--dim)]",
  練習中: "border-[var(--gold)] text-[var(--gold)]",
  演奏済み: "border-[var(--accent)] text-[var(--accent)]",
};

function stars(priority: number): string {
  return "★".repeat(priority) + "☆".repeat(3 - priority);
}

// ---- 日付ユーティリティ (Asia/Tokyo の暦日基準) ----

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diffDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDate(dateStr: string): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${y}年${m}月${d}日（${wd}）`;
}

function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) return `${-daysLeft}日超過`;
  if (daysLeft === 0) return "今日";
  if (daysLeft === 1) return "明日";
  return `あと${daysLeft}日`;
}

// ---- 作曲者→時代の簡易辞書 (目安。あとから手で直せる) ----

const COMPOSER_ERA: Record<string, { era: Era; year: number | null }> = {
  バッハ: { era: "バロック", year: null },
  ヘンデル: { era: "バロック", year: null },
  ヴィヴァルディ: { era: "バロック", year: null },
  テレマン: { era: "バロック", year: null },
  スカルラッティ: { era: "バロック", year: null },
  ラモー: { era: "バロック", year: null },
  クープラン: { era: "バロック", year: null },
  ハイドン: { era: "古典派", year: null },
  モーツァルト: { era: "古典派", year: null },
  ベートーヴェン: { era: "古典派", year: null },
  クレメンティ: { era: "古典派", year: null },
  シューベルト: { era: "ロマン派", year: null },
  ショパン: { era: "ロマン派", year: null },
  シューマン: { era: "ロマン派", year: null },
  リスト: { era: "ロマン派", year: null },
  ブラームス: { era: "ロマン派", year: null },
  チャイコフスキー: { era: "ロマン派", year: null },
  メンデルスゾーン: { era: "ロマン派", year: null },
  ウェーバー: { era: "ロマン派", year: null },
  ロッシーニ: { era: "ロマン派", year: null },
  ヴェルディ: { era: "ロマン派", year: null },
  ワーグナー: { era: "ロマン派", year: null },
  グリーグ: { era: "ロマン派", year: null },
  ドヴォルザーク: { era: "ロマン派", year: null },
  サンサーンス: { era: "ロマン派", year: null },
  フォーレ: { era: "ロマン派", year: null },
  フランク: { era: "ロマン派", year: null },
  ブルックナー: { era: "ロマン派", year: null },
  マーラー: { era: "近現代", year: null },
  ドビュッシー: { era: "近現代", year: null },
  ラヴェル: { era: "近現代", year: null },
  ラフマニノフ: { era: "近現代", year: null },
  スクリャービン: { era: "近現代", year: null },
  プロコフィエフ: { era: "近現代", year: null },
  ストラヴィンスキー: { era: "近現代", year: null },
  バルトーク: { era: "近現代", year: null },
  ショスタコーヴィチ: { era: "近現代", year: null },
  ヒンデミット: { era: "近現代", year: null },
  プーランク: { era: "近現代", year: null },
  サティ: { era: "近現代", year: null },
  エルガー: { era: "近現代", year: null },
  シベリウス: { era: "近現代", year: null },
  ニールセン: { era: "近現代", year: null },
  カプースチン: { era: "現代", year: null },
  武満徹: { era: "現代", year: null },
  久石譲: { era: "現代", year: null },
};

function guessEra(composer: string): { era: Era; year: number | null } | null {
  const norm = composer.replace(/[\s　・=]/g, "").toLowerCase();
  if (!norm) return null;
  for (const [name, info] of Object.entries(COMPOSER_ERA)) {
    const key = name.replace(/[\s　・=]/g, "").toLowerCase();
    if (norm.includes(key) || key.includes(norm)) return info;
  }
  return null;
}

// ピティナ・ピアノ曲事典の公式キーワード検索 (GET /search?key=)
function ptnaUrl(song: Pick<Song, "title" | "composer">): string {
  const key = [song.composer, song.title].filter(Boolean).join(" ");
  return `https://enc.piano.or.jp/search?key=${encodeURIComponent(key)}`;
}

const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)] placeholder:text-[var(--dim)] focus:outline-2 focus:outline-[var(--accent)]";
const labelCls = "block text-sm font-medium text-[var(--dim)] mb-1";

type Draft = {
  title: string;
  composer: string;
  genre: Genre;
  status: Status;
  priority: number;
  note: string;
  era: Era | "";
  eraYear: string;
  readingStart: string;
  finishDeadline: string;
  performanceDate: string;
  performanceName: string;
};

const emptyDraft: Draft = {
  title: "",
  composer: "",
  genre: "その他",
  status: "いつか演奏したい",
  priority: 2,
  note: "",
  era: "",
  eraYear: "",
  readingStart: "",
  finishDeadline: "",
  performanceDate: "",
  performanceName: "",
};

function draftFromSong(song: Song): Draft {
  return {
    title: song.title,
    composer: song.composer,
    genre: song.genre,
    status: song.status,
    priority: song.priority,
    note: song.note,
    era: song.era ?? "",
    eraYear: song.eraYear != null ? String(song.eraYear) : "",
    readingStart: song.readingStart ?? "",
    finishDeadline: song.finishDeadline ?? "",
    performanceDate: song.performanceDate ?? "",
    performanceName: song.performanceName,
  };
}

type SongInput = Parameters<typeof api.addSong>[0];

function toSongInput(draft: Draft): SongInput {
  const yearNum = draft.eraYear.trim() === "" ? null : Number(draft.eraYear);
  return {
    title: draft.title.trim(),
    composer: draft.composer.trim(),
    genre: draft.genre,
    status: draft.status,
    priority: draft.priority,
    note: draft.note.trim(),
    era: draft.era === "" ? null : draft.era,
    eraYear: yearNum != null && Number.isFinite(yearNum) ? Math.trunc(yearNum) : null,
    readingStart: draft.readingStart === "" ? null : draft.readingStart,
    finishDeadline: draft.finishDeadline === "" ? null : draft.finishDeadline,
    performanceDate: draft.performanceDate === "" ? null : draft.performanceDate,
    performanceName: draft.performanceName.trim(),
  };
}

function SongForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: SongInput) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [guessMsg, setGuessMsg] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    onSubmit(toSongInput(draft));
  }

  function applyGuess() {
    const g = guessEra(draft.composer);
    if (!g) {
      setGuessMsg("辞書にない作曲家です。時代は手で選んでください。");
      return;
    }
    setDraft((d) => ({
      ...d,
      era: g.era,
      eraYear: d.eraYear === "" && g.year != null ? String(g.year) : d.eraYear,
    }));
    setGuessMsg(`「${draft.composer}」は${g.era}の目安です。違えば直してください。`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="song-title" className={labelCls}>
          曲名 <span className="text-[var(--accent)]">必須</span>
        </label>
        <input
          id="song-title"
          className={inputCls}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="例：交響曲第5番「運命」"
          required
        />
      </div>
      <div>
        <label htmlFor="song-composer" className={labelCls}>
          作曲者
        </label>
        <input
          id="song-composer"
          className={inputCls}
          value={draft.composer}
          onChange={(e) => setDraft({ ...draft, composer: e.target.value })}
          placeholder="例：ベートーヴェン"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="song-genre" className={labelCls}>
            ジャンル・編成
          </label>
          <select
            id="song-genre"
            className={inputCls}
            value={draft.genre}
            onChange={(e) => setDraft({ ...draft, genre: e.target.value as Genre })}
          >
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="song-status" className={labelCls}>
            ステータス
          </label>
          <select
            id="song-status"
            className={inputCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="song-era" className={labelCls}>
            時代
          </label>
          <select
            id="song-era"
            className={inputCls}
            value={draft.era}
            onChange={(e) => setDraft({ ...draft, era: e.target.value as Era | "" })}
          >
            <option value="">未設定</option>
            {ERAS.map((er) => (
              <option key={er} value={er}>
                {er}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="song-era-year" className={labelCls}>
            作曲年（任意）
          </label>
          <input
            id="song-era-year"
            className={inputCls}
            type="number"
            inputMode="numeric"
            min={1}
            max={2100}
            value={draft.eraYear}
            onChange={(e) => setDraft({ ...draft, eraYear: e.target.value })}
            placeholder="例：1808"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={applyGuess}
          disabled={!draft.composer.trim()}
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          作曲者から時代を推定
        </button>
        {guessMsg && <p className="text-xs text-[var(--dim)]">{guessMsg}</p>}
      </div>
      <div>
        <span className={labelCls}>弾きたい度</span>
        <div className="flex gap-2" role="group" aria-label="弾きたい度">
          {[1, 2, 3].map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={draft.priority === p}
              aria-label={`弾きたい度 ${p}`}
              onClick={() => setDraft({ ...draft, priority: p })}
              className={`flex-1 rounded-[var(--radius)] border px-2 py-2 text-base tracking-widest ${
                draft.priority === p
                  ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                  : "border-[var(--border)] text-[var(--dim)]"
              }`}
            >
              {stars(p)}
            </button>
          ))}
        </div>
      </div>
      <fieldset className="space-y-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium text-[var(--dim)]">
          スケジュール
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="song-reading-start" className={labelCls}>
              譜読み開始
            </label>
            <input
              id="song-reading-start"
              className={inputCls}
              type="date"
              value={draft.readingStart}
              onChange={(e) => setDraft({ ...draft, readingStart: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="song-finish-deadline" className={labelCls}>
              仕上げ期限
            </label>
            <input
              id="song-finish-deadline"
              className={inputCls}
              type="date"
              value={draft.finishDeadline}
              onChange={(e) => setDraft({ ...draft, finishDeadline: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="song-performance-date" className={labelCls}>
              本番
            </label>
            <input
              id="song-performance-date"
              className={inputCls}
              type="date"
              value={draft.performanceDate}
              onChange={(e) => setDraft({ ...draft, performanceDate: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label htmlFor="song-performance-name" className={labelCls}>
            本番の名前（任意）
          </label>
          <input
            id="song-performance-name"
            className={inputCls}
            value={draft.performanceName}
            onChange={(e) => setDraft({ ...draft, performanceName: e.target.value })}
            placeholder="例：定期演奏会、発表会"
          />
        </div>
        <p className="text-xs text-[var(--dim)]">
          仕上げ期限と本番は、7日前・3日前・前日・当日にチャットでお知らせします。
        </p>
      </fieldset>
      <div>
        <label htmlFor="song-note" className={labelCls}>
          メモ
        </label>
        <textarea
          id="song-note"
          className={inputCls}
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          placeholder="聴いたきっかけ、弾きたい理由、参考音源など"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !draft.title.trim()}
          className="flex-1 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-40"
        >
          {pending ? "保存中…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2.5 text-base text-[var(--dim)]"
          >
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}

// ---- スケジュール表示 ----

function ScheduleLines({ song }: { song: Song }) {
  const today = todayJst();
  const items: { label: string; date: string; highlight: boolean }[] = [];
  if (song.readingStart) {
    items.push({ label: "譜読み開始", date: song.readingStart, highlight: false });
  }
  if (song.finishDeadline) {
    const left = diffDays(today, song.finishDeadline);
    items.push({
      label: "仕上げ期限",
      date: song.finishDeadline,
      highlight: song.status !== "演奏済み" && left <= 7,
    });
  }
  if (song.performanceDate) {
    const left = diffDays(today, song.performanceDate);
    items.push({
      label: song.performanceName ? `本番（${song.performanceName}）` : "本番",
      date: song.performanceDate,
      highlight: song.status !== "演奏済み" && left <= 7,
    });
  }
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {items.map((item) => {
        const left = diffDays(today, item.date);
        return (
          <li key={item.label} className="flex flex-wrap items-center gap-x-2">
            <span className="text-[var(--dim)]">{item.label}</span>
            <span>{formatDate(item.date)}</span>
            <span
              className={
                item.highlight
                  ? "font-semibold text-[var(--accent)]"
                  : "text-[var(--dim)]"
              }
            >
              （{daysLabel(left)}）
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ReminderBanner({ schedule }: { schedule: Schedule | undefined }) {
  if (!schedule) return null;
  const { dueWithinWeek, readingSoon } = schedule;
  if (dueWithinWeek.length === 0 && readingSoon.length === 0) return null;
  return (
    <section
      aria-label="リマインダー"
      className="rounded-[var(--radius)] border border-[var(--gold)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-[family-name:var(--font-score)] text-lg font-bold">
        リマインダー：1週間前になりました
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {dueWithinWeek.map((item) => (
          <li key={`${item.kind}-${item.songId}`}>
            <span className="font-semibold text-[var(--accent)]">{item.kind}</span>
            　{item.title}
            {item.kind === "本番" && item.performanceName
              ? `（${item.performanceName}）`
              : ""}
            　{formatDate(item.date)}（{daysLabel(item.daysLeft)}）
          </li>
        ))}
        {readingSoon.map((item) => (
          <li key={`reading-${item.songId}`}>
            <span className="font-semibold text-[var(--gold)]">譜読み開始</span>
            　{item.title}　{formatDate(item.readingStart ?? "")}（
            {item.startsInDays === 0 ? "今日から" : `あと${item.startsInDays}日`}）
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-[var(--dim)]">
        仕上げ期限・本番は7日前／3日前／前日／当日にもチャットでお知らせします。
      </p>
    </section>
  );
}

function ScheduleSection({ songs }: { songs: Song[] }) {
  const today = todayJst();
  const dated = songs.filter(
    (s) => s.readingStart || s.finishDeadline || s.performanceDate,
  );
  if (dated.length === 0) return null;
  const nextDate = (s: Song) =>
    [s.performanceDate, s.finishDeadline, s.readingStart]
      .filter((d): d is string => typeof d === "string" && d >= today)
      .sort()[0] ?? "9999-12-31";
  const sorted = [...dated].sort((a, b) => nextDate(a).localeCompare(nextDate(b)));
  return (
    <section aria-label="予定" className="mt-6">
      <h2 className="font-[family-name:var(--font-score)] text-xl font-bold">予定</h2>
      <ul className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        {sorted.map((s) => (
          <li key={s.id} className="px-4 py-3">
            <p className="font-medium">
              {s.title}
              {s.composer && (
                <span className="ml-2 text-sm text-[var(--dim)]">{s.composer}</span>
              )}
            </p>
            <ScheduleLines song={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- 曲カード ----

function SongCard({
  song,
  songs,
  relations,
  highlighted,
}: {
  song: Song;
  songs: Song[];
  relations: Relation[];
  highlighted: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["songs"] });

  const update = useMutation({
    mutationFn: (args: Parameters<typeof api.updateSong>[0]) => api.updateSong(args),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSong({ id: song.id }),
    onSuccess: invalidate,
  });

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const titleOf = (id: number) => byId.get(id)?.title ?? "（削除された曲）";

  const incoming = relations.filter((r) => r.toSongId === song.id);
  const outgoing = relations.filter((r) => r.fromSongId === song.id);
  const incomingGroups = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const r of incoming) {
      const arr = groups.get(r.groupKey) ?? [];
      arr.push(titleOf(r.fromSongId));
      groups.set(r.groupKey, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, byId]);

  if (editing) {
    return (
      <li className="border-b border-[var(--border)] bg-[var(--surface)] p-4">
        <SongForm
          initial={draftFromSong(song)}
          submitLabel="変更を保存"
          pending={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => {
            update.mutate(
              { id: song.id, ...input },
              { onSuccess: () => setEditing(false) },
            );
          }}
        />
      </li>
    );
  }

  return (
    <li
      id={`song-card-${song.id}`}
      className={`border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 ${
        highlighted ? "outline-2 outline-[var(--accent)] -outline-offset-2" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-[family-name:var(--font-score)] text-lg font-semibold leading-snug text-[var(--text)]">
            {song.title}
          </h3>
          {song.composer && (
            <p className="mt-0.5 text-sm text-[var(--dim)]">{song.composer}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[song.status]}`}
        >
          {song.status}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="rounded bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--dim)]">
          {song.genre}
        </span>
        {song.era && (
          <span className="rounded bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--dim)]">
            {song.era}
            {song.eraYear != null ? `・${song.eraYear}年` : ""}
          </span>
        )}
        <span className="tracking-widest text-[var(--accent)]" aria-label={`弾きたい度 ${song.priority}`}>
          {stars(song.priority)}
        </span>
        <a
          href={ptnaUrl(song)}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-[var(--accent)] underline underline-offset-2"
        >
          ピティナで調べる
        </a>
      </div>

      <ScheduleLines song={song} />

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="mt-2 space-y-1 text-sm text-[var(--dim)]">
          {incoming.length > 0 && (
            <p>
              前提：
              {incomingGroups
                .map(([, titles]) => titles.join(" ＋ "))
                .join(" ／ ")}
              {incomingGroups.length > 1 && (
                <span className="ml-1 text-xs">（／ はどちらか1組でOK）</span>
              )}
            </p>
          )}
          {outgoing.length > 0 && (
            <p>この曲のあと：{outgoing.map((r) => titleOf(r.toSongId)).join("、")}</p>
          )}
        </div>
      )}

      {song.note && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
          {song.note}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor={`status-${song.id}`} className="sr-only">
          {song.title}のステータスを変更
        </label>
        <select
          id={`status-${song.id}`}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
          value={song.status}
          onChange={(e) =>
            update.mutate({ id: song.id, status: e.target.value as Status })
          }
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]"
        >
          編集
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {remove.isPending ? "削除中…" : "本当に削除"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--dim)]"
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--dim)]"
          >
            削除
          </button>
        )}
      </div>
    </li>
  );
}

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T | "すべて";
  onChange: (v: T | "すべて") => void;
}) {
  return (
    <div>
      <span className="sr-only">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {(["すべて", ...options] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            onClick={() => onChange(opt)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              value === opt
                ? "border-[var(--text)] bg-[var(--text)] font-semibold text-[var(--bg)]"
                : "border-[var(--border)] text-[var(--dim)]"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- ロードマップ ----

const COL_W = 180;
const GAP_X = 56;
const NODE_H = 88;
const GAP_Y = 20;
const HEADER_H = 30;

type Layout = {
  positions: Map<number, { col: number; row: number }>;
  cols: number;
  rows: number;
  cyclicIds: Set<number>;
};

function computeLayout(songs: Song[], relations: Relation[]): Layout {
  const involved = new Set<number>();
  for (const r of relations) {
    involved.add(r.fromSongId);
    involved.add(r.toSongId);
  }
  const nodes = songs.filter((s) => involved.has(s.id));
  const ids = new Set(nodes.map((s) => s.id));
  const byId = new Map(nodes.map((s) => [s.id, s]));
  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (const s of nodes) {
    preds.set(s.id, []);
    succs.set(s.id, []);
    indeg.set(s.id, 0);
  }
  for (const r of relations) {
    if (!ids.has(r.fromSongId) || !ids.has(r.toSongId)) continue;
    const p = preds.get(r.toSongId);
    if (p) p.push(r.fromSongId);
    const sc = succs.get(r.fromSongId);
    if (sc) sc.push(r.toSongId);
    indeg.set(r.toSongId, (indeg.get(r.toSongId) ?? 0) + 1);
  }

  // Kahn法でレイヤー付け (循環に含まれる曲はレイヤーなし)
  const layer = new Map<number, number>();
  const remaining = new Map(indeg);
  let frontier = nodes.filter((s) => (indeg.get(s.id) ?? 0) === 0).map((s) => s.id);
  let depth = 0;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const id of frontier) layer.set(id, depth);
    for (const id of frontier) {
      for (const t of succs.get(id) ?? []) {
        const left = (remaining.get(t) ?? 0) - 1;
        remaining.set(t, left);
        if (left === 0) next.push(t);
      }
    }
    frontier = next;
    depth += 1;
  }
  const cyclicIds = new Set(
    nodes.filter((s) => !layer.has(s.id)).map((s) => s.id),
  );

  // レイヤー内は前提曲の平均位置 (バリセンター) で並べて交差を減らす
  const byLayer = new Map<number, number[]>();
  for (const [id, l] of layer) {
    const arr = byLayer.get(l) ?? [];
    arr.push(id);
    byLayer.set(l, arr);
  }
  const rowOf = new Map<number, number>();
  let rows = 0;
  const cols = byLayer.size;
  for (let l = 0; l < cols; l += 1) {
    const arr = byLayer.get(l) ?? [];
    const score = (id: number) => {
      const placed = (preds.get(id) ?? []).filter((p) => rowOf.has(p));
      if (placed.length === 0) return Number.MAX_SAFE_INTEGER;
      return placed.reduce((sum, p) => sum + (rowOf.get(p) ?? 0), 0) / placed.length;
    };
    arr.sort((a, b) => {
      const d = score(a) - score(b);
      if (d !== 0) return d;
      const pa = byId.get(a)?.priority ?? 0;
      const pb = byId.get(b)?.priority ?? 0;
      return pb - pa || a - b;
    });
    arr.forEach((id, i) => rowOf.set(id, i));
    rows = Math.max(rows, arr.length);
  }
  const positions = new Map<number, { col: number; row: number }>();
  for (const [id, l] of layer) {
    positions.set(id, { col: l, row: rowOf.get(id) ?? 0 });
  }
  return { positions, cols, rows, cyclicIds };
}

function RoadmapGraph({
  songs,
  relations,
  onSelect,
}: {
  songs: Song[];
  relations: Relation[];
  onSelect: (id: number) => void;
}) {
  const layout = useMemo(() => computeLayout(songs, relations), [songs, relations]);
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const orTargets = useMemo(() => {
    const groupsByTarget = new Map<number, Set<number>>();
    for (const r of relations) {
      const set = groupsByTarget.get(r.toSongId) ?? new Set<number>();
      set.add(r.groupKey);
      groupsByTarget.set(r.toSongId, set);
    }
    const result = new Set<number>();
    for (const [id, set] of groupsByTarget) {
      if (set.size >= 2) result.add(id);
    }
    return result;
  }, [relations]);

  if (relations.length === 0) {
    return (
      <p className="py-4 text-sm text-[var(--dim)]">
        まだ矢印がありません。下のフォームで「この曲を終えたら次はこの曲」をつなぐと、ここに流れ図が表示されます。
      </p>
    );
  }

  const { positions, cols, rows, cyclicIds } = layout;
  const width = cols * COL_W + Math.max(0, cols - 1) * GAP_X;
  const height = HEADER_H + rows * NODE_H + Math.max(0, rows - 1) * GAP_Y;
  const xOf = (col: number) => col * (COL_W + GAP_X);
  const yOf = (row: number) => HEADER_H + row * (NODE_H + GAP_Y);

  const placedSongs = songs.filter((s) => positions.has(s.id));

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="relative" style={{ width, height }}>
          {Array.from({ length: cols }, (_, c) => (
            <span
              key={c}
              className="absolute top-0 text-xs font-semibold tracking-widest text-[var(--dim)]"
              style={{ left: xOf(c), width: COL_W }}
            >
              STEP {c + 1}
            </span>
          ))}
          <svg
            className="absolute inset-0"
            width={width}
            height={height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="roadmap-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dim)" />
              </marker>
              <marker
                id="roadmap-arrow-or"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gold)" />
              </marker>
            </defs>
            {relations.map((r) => {
              const from = positions.get(r.fromSongId);
              const to = positions.get(r.toSongId);
              if (!from || !to) return null;
              const x1 = xOf(from.col) + COL_W;
              const y1 = yOf(from.row) + NODE_H / 2;
              const x2 = xOf(to.col);
              const y2 = yOf(to.row) + NODE_H / 2;
              const bend = Math.max(28, Math.abs(x2 - x1) / 2);
              const isOr = r.groupKey > 0;
              return (
                <path
                  key={r.id}
                  d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isOr ? "var(--gold)" : "var(--dim)"}
                  strokeWidth={isOr ? 2.5 : 2}
                  markerEnd={isOr ? "url(#roadmap-arrow-or)" : "url(#roadmap-arrow)"}
                />
              );
            })}
          </svg>
          {placedSongs.map((song) => {
            const pos = positions.get(song.id);
            if (!pos) return null;
            return (
              <button
                key={song.id}
                type="button"
                onClick={() => onSelect(song.id)}
                aria-label={`${song.title}を一覧で見る`}
                className="absolute overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 text-left shadow-sm"
                style={{
                  left: xOf(pos.col),
                  top: yOf(pos.row),
                  width: COL_W,
                  height: NODE_H,
                }}
              >
                <span className="block truncate text-sm font-semibold leading-snug">
                  {song.title}
                </span>
                {song.composer && (
                  <span className="block truncate text-xs text-[var(--dim)]">
                    {song.composer}
                  </span>
                )}
                <span className="mt-1 flex items-center gap-1.5">
                  <span
                    className={`rounded-full border px-1.5 py-px text-[11px] font-semibold ${STATUS_STYLE[song.status]}`}
                  >
                    {song.status}
                  </span>
                  {orTargets.has(song.id) && (
                    <span className="rounded-full border border-[var(--gold)] px-1.5 py-px text-[11px] font-semibold text-[var(--gold)]">
                      OR分岐
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-[var(--dim)]">
        金色の矢印はORグループの枝分かれです。ノードをタップすると下の一覧でその曲を表示します。
      </p>
      {cyclicIds.size > 0 && (
        <p className="mt-1 text-xs text-[var(--accent)]">
          循環に含まれるため図に置けない曲：
          {[...cyclicIds].map((id) => byId.get(id)?.title ?? "").filter(Boolean).join("、")}
          （下の矢印一覧で確認・削除できます）
        </p>
      )}
    </div>
  );
}

function RoadmapSection({
  songs,
  relations,
  onSelect,
}: {
  songs: Song[];
  relations: Relation[];
  onSelect: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [groupSel, setGroupSel] = useState<string>("and");
  const [relError, setRelError] = useState<string | null>(null);

  useEffect(() => {
    setGroupSel("and");
  }, [toId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["songs"] });

  const addRel = useMutation({
    mutationFn: (args: Parameters<typeof api.addRelation>[0]) => api.addRelation(args),
    onSuccess: (res) => {
      if (!res.ok) {
        setRelError(res.reason ?? "矢印を追加できませんでした");
        return;
      }
      setRelError(null);
      invalidate();
    },
    onError: () => setRelError("矢印を追加できませんでした"),
  });
  const delRel = useMutation({
    mutationFn: (id: number) => api.deleteRelation({ id }),
    onSuccess: invalidate,
  });

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const titleOf = (id: number) => byId.get(id)?.title ?? "（削除された曲）";

  const existingGroups = useMemo(() => {
    if (toId == null) return [] as number[];
    return [...new Set(relations.filter((r) => r.toSongId === toId).map((r) => r.groupKey))].sort(
      (a, b) => a - b,
    );
  }, [relations, toId]);

  const sortedRelations = useMemo(
    () =>
      [...relations].sort(
        (a, b) => a.toSongId - b.toSongId || a.groupKey - b.groupKey || a.id - b.id,
      ),
    [relations],
  );

  function handleAdd() {
    if (fromId == null || toId == null) {
      setRelError("つなぐ曲を2つ選んでください");
      return;
    }
    if (fromId === toId) {
      setRelError("同じ曲同士はつなげません");
      return;
    }
    let groupKey: number;
    if (groupSel === "new") {
      groupKey = existingGroups.length > 0 ? Math.max(...existingGroups) + 1 : 1;
    } else if (groupSel.startsWith("g")) {
      groupKey = Number(groupSel.slice(1));
    } else {
      groupKey = existingGroups[0] ?? 0;
    }
    addRel.mutate({ fromSongId: fromId, toSongId: toId, groupKey });
  }

  const selectCls =
    "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";

  return (
    <section aria-label="ロードマップ" className="mt-6">
      <h2 className="font-[family-name:var(--font-score)] text-xl font-bold">
        ロードマップ
      </h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        「この曲をやってから、この曲へ」。前提は複数つなげられます。別グループにすると
        OR（どれか1組を終えれば次へ進める）になります。
      </p>

      <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <RoadmapGraph songs={songs} relations={relations} onSelect={onSelect} />

        {relations.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3 text-sm">
            {sortedRelations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0">
                  {titleOf(r.fromSongId)} <span aria-hidden="true">→</span>{" "}
                  {titleOf(r.toSongId)}
                </span>
                {r.groupKey > 0 && (
                  <span className="rounded-full border border-[var(--gold)] px-2 py-px text-xs font-semibold text-[var(--gold)]">
                    ORグループ{r.groupKey}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`${titleOf(r.fromSongId)}から${titleOf(r.toSongId)}への矢印を削除`}
                  onClick={() => delRel.mutate(r.id)}
                  disabled={delRel.isPending}
                  className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--dim)] disabled:opacity-40"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        {songs.length >= 2 ? (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rel-from" className={labelCls}>
                  先にやる曲
                </label>
                <select
                  id="rel-from"
                  className={selectCls}
                  value={fromId ?? ""}
                  onChange={(e) =>
                    setFromId(e.target.value === "" ? null : Number(e.target.value))
                  }
                >
                  <option value="">選んでください</option>
                  {songs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rel-to" className={labelCls}>
                  次にやる曲
                </label>
                <select
                  id="rel-to"
                  className={selectCls}
                  value={toId ?? ""}
                  onChange={(e) =>
                    setToId(e.target.value === "" ? null : Number(e.target.value))
                  }
                >
                  <option value="">選んでください</option>
                  {songs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {toId != null && (
              <div>
                <label htmlFor="rel-group" className={labelCls}>
                  つなぎ方
                </label>
                <select
                  id="rel-group"
                  className={selectCls}
                  value={groupSel}
                  onChange={(e) => setGroupSel(e.target.value)}
                >
                  <option value="and">
                    {existingGroups.length > 0
                      ? "既存の前提とセット（AND：全部終えたら進める）"
                      : "前提にする（AND）"}
                  </option>
                  {existingGroups.map((g) => (
                    <option key={g} value={`g${g}`}>
                      ORグループ{g}に追加（この組のどれかでOK）
                    </option>
                  ))}
                  <option value="new">
                    新しいORグループにする（別のルートとして分岐）
                  </option>
                </select>
              </div>
            )}
            {relError && <p className="text-sm text-[var(--accent)]">{relError}</p>}
            <button
              type="button"
              onClick={handleAdd}
              disabled={addRel.isPending || fromId == null || toId == null}
              className="w-full rounded-[var(--radius)] bg-[var(--text)] px-4 py-2.5 text-base font-semibold text-[var(--bg)] disabled:opacity-40"
            >
              {addRel.isPending ? "追加中…" : "矢印をつなぐ"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--dim)]">
            曲が2曲以上になると、ここで順番をつなげられます。
          </p>
        )}
      </div>
    </section>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortKey>("priority");
  const [genreFilter, setGenreFilter] = useState<Genre | "すべて">("すべて");
  const [statusFilter, setStatusFilter] = useState<Status | "すべて">("すべて");
  const [eraFilter, setEraFilter] = useState<Era | "すべて">("すべて");
  const [query, setQuery] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const songsQuery = useQuery({
    queryKey: ["songs", sort],
    queryFn: () => api.listSongs({ sort }),
  });
  const scheduleQuery = useQuery({
    queryKey: ["schedule"],
    queryFn: () => api.getSchedule({}),
  });

  const add = useMutation({
    mutationFn: (input: SongInput) => api.addSong(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      setFormKey((k) => k + 1);
    },
  });

  const allSongs = songsQuery.data?.songs ?? [];
  const relations = songsQuery.data?.relations ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSongs.filter((s) => {
      if (genreFilter !== "すべて" && s.genre !== genreFilter) return false;
      if (statusFilter !== "すべて" && s.status !== statusFilter) return false;
      if (eraFilter !== "すべて" && s.era !== eraFilter) return false;
      if (
        q &&
        !s.title.toLowerCase().includes(q) &&
        !s.composer.toLowerCase().includes(q) &&
        !s.note.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [allSongs, genreFilter, statusFilter, eraFilter, query]);

  const total = allSongs.length;

  function handleSelectSong(id: number) {
    setSelectedId(id);
    setSort("newest");
    setGenreFilter("すべて");
    setStatusFilter("すべて");
    setEraFilter("すべて");
    setQuery("");
    requestAnimationFrame(() => {
      document
        .getElementById(`song-card-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4">
        <ReminderBanner schedule={scheduleQuery.data} />

        <section
          aria-label="曲を登録"
          className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <h2 className="font-[family-name:var(--font-score)] text-xl font-bold">
            演奏したい曲を登録
          </h2>
          <div className="mt-3">
            <SongForm
              key={formKey}
              initial={emptyDraft}
              submitLabel="リストに追加"
              pending={add.isPending}
              onSubmit={(input) => add.mutate(input)}
            />
          </div>
          {add.isError && (
            <p className="mt-2 text-sm text-[var(--accent)]">
              保存できませんでした。もう一度お試しください。
            </p>
          )}
        </section>

        {total >= 1 && (
          <RoadmapSection
            songs={allSongs}
            relations={relations}
            onSelect={handleSelectSong}
          />
        )}

        <ScheduleSection songs={allSongs} />

        <section aria-label="曲の一覧" className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-[family-name:var(--font-score)] text-xl font-bold">
              リスト
            </h2>
            <p className="text-sm text-[var(--dim)]">
              {total}曲{filtered.length !== total && `（${filtered.length}曲を表示）`}
            </p>
          </div>

          <div className="mt-3 space-y-2.5">
            <input
              type="search"
              aria-label="曲名・作曲者・メモで検索"
              className={inputCls}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="曲名・作曲者・メモで検索"
            />
            <FilterChips label="ジャンルで絞り込み" options={GENRES} value={genreFilter} onChange={setGenreFilter} />
            <FilterChips label="ステータスで絞り込み" options={STATUSES} value={statusFilter} onChange={setStatusFilter} />
            <FilterChips label="時代で絞り込み" options={ERAS} value={eraFilter} onChange={setEraFilter} />
            <div className="flex items-center gap-2">
              <label htmlFor="sort" className="text-sm text-[var(--dim)]">
                並び替え
              </label>
              <select
                id="sort"
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="priority">弾きたい度が高い順</option>
                <option value="composer">作曲者順</option>
                <option value="era">時代順（古い時代から）</option>
                <option value="newest">新しい順</option>
                <option value="oldest">古い順</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            {songsQuery.isPending ? (
              <p className="py-8 text-center text-sm text-[var(--dim)]">読み込み中…</p>
            ) : songsQuery.isError ? (
              <p className="py-8 text-center text-sm text-[var(--accent)]">
                一覧を読み込めませんでした。
              </p>
            ) : total === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-4 py-10 text-center">
                <p className="font-[family-name:var(--font-score)] text-lg font-semibold">
                  まだ曲が登録されていません
                </p>
                <p className="mt-2 text-sm text-[var(--dim)]">
                  ふと「弾いてみたい」と思った曲を、上のフォームから書き留めておきましょう。
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--dim)]">
                条件に合う曲がありません。検索や絞り込みを変えてみてください。
              </p>
            ) : (
              <ul className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
                {filtered.map((song) => (
                  <SongCard
                    key={song.id}
                    song={song}
                    songs={allSongs}
                    relations={relations}
                    highlighted={song.id === selectedId}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
