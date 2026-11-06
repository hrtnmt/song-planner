# Data Plan

# Data Plan

Core data is user input stored in the artifact's own database (songs, roadmap relations, schedule dates). No external API is integrated.

External reference link (verified 2026-11-06): ピティナ・ピアノ曲事典 (PTNA Piano Encyclopedia), https://enc.piano.or.jp/ — its official keyword search is a GET form to `/search` with a `key` parameter (confirmed from the site's own search form markup on the top page, and by loading https://enc.piano.or.jp/search?key=ショパン%20ノクターン which returned real search results). Each song card links out to `https://enc.piano.or.jp/search?key=<作曲者 曲名>` so the user can look up difficulty (ステップ), recordings, and scores. No PTNA data is scraped or stored; the research-only PTNA dataset via NII is not used.

Reminders: deadline/performance dates are stored per song; `getSchedule`/`refreshSchedule` compute the 7-day window in Asia/Tokyo. A daily agent cron job (owner space:yan-zou-sitaiqu-risuto) reads the schedule and sends a chat notification at 7 days / 3 days / 1 day before and on the day. There is no OS-level push from the artifact itself, so the page also shows an in-page reminder banner.
