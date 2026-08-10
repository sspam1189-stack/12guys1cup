# 12 Guys 1 Cup — League History

Static site for the 12 Guys 1 Cup Sleeper league: champions wall (1st/2nd/3rd/PF
champ/last place), all-time standings, head-to-head, record book, season pages
with draft boards, trade history, punishments, rules, and member profiles.

Live: https://sspam1189-stack.github.io/12guys1cup/

## How it works

1. `npm run fetch` — snapshots the Sleeper API into `data/raw/` (all seasons).
2. `npm run compute` — computes stats into `data/computed/`.
3. `npm run build` — Astro renders the static site from the computed JSON.

Data refreshes automatically every Tuesday via GitHub Actions (`Refresh data`
workflow), or on demand from the Actions tab. Every push to `main` redeploys.

Every stat is attributed to the permanent Sleeper `user_id` that was in the
league *that season*, so past members keep their own records — no franchise
history bleeding between people. Regular season and playoffs are strictly
separated; consolation games never count toward anyone's record.

## Commissioner notes

- **Punishments:** edit `data/punishments.json`:
  `[{ "season": "2024", "title": "Waffle House 24hrs", "description": "…", "media": ["https://…"] }]`
- **Payouts & bylaws:** edit `data/rules.json`:
  `{ "payouts": [{ "label": "1st place", "amount": "$600" }], "bylaws": ["No collusion.", "…"] }`
- **Identity overrides:** if an account ever changes hands, add to
  `data/overrides.json`: `{ "2024": { "<roster_id or user_id>": "<real user_id>" } }`
  then rerun `npm run compute`. This keeps each real person's records separate.

## Dev

`npm run dev` — local dev server · `npm test` — unit + real-data validation
