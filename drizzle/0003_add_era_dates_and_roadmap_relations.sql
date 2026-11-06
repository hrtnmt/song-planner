ALTER TABLE songs ADD COLUMN era TEXT;
--> statement-breakpoint
ALTER TABLE songs ADD COLUMN era_year INTEGER;
--> statement-breakpoint
ALTER TABLE songs ADD COLUMN reading_start TEXT;
--> statement-breakpoint
ALTER TABLE songs ADD COLUMN finish_deadline TEXT;
--> statement-breakpoint
ALTER TABLE songs ADD COLUMN performance_date TEXT;
--> statement-breakpoint
ALTER TABLE songs ADD COLUMN performance_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE song_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_song_id INTEGER NOT NULL,
  to_song_id INTEGER NOT NULL,
  group_key INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
