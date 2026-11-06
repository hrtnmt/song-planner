DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  composer TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT 'その他',
  status TEXT NOT NULL DEFAULT 'いつか演奏したい',
  priority INTEGER NOT NULL DEFAULT 2,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
