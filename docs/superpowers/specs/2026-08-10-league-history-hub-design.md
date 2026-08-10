# 12 Guys 1 Cup — League History & Records Hub

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## Overview

A static website for the "12 Guys 1 Cup" Sleeper fantasy football league (league ID
`1382479927399419904`, 2026 season), presenting the league's full history: champions,
all-time standings, head-to-head records, a record book, season pages, draft history,
and trades. Hosted free on GitHub Pages. Power rankings (commissioner has a custom
formula) are explicitly **out of scope** for this phase and will be a later addition.

## League facts (verified against the Sleeper API)

- Seasons: 2021–2025 complete, 2026 pre-draft. League chain walked via
  `previous_league_id`.
- 2021–2022 the league was "14 Guys 1 Cup" with 14 teams; 12 teams from 2023 on.
- Members are identified by permanent Sleeper `user_id`s. Verified: no user_id is
  shared between different people across seasons. Departed members: Tex1225,
  kevinocean, DarthOsO, likemike27 (after 2022), chrishen95 (after 2023).
  Joined: clvnluu, djho57 (2023), alvo123 (2024).
- Scoring: 0.5 PPR. Playoffs: 6 teams, start week 15 (2026 settings; each season
  uses its own stored settings).

## Core requirements

1. **No double-counting of records.** Sleeper's UI hands a franchise's history to
   whoever currently owns the roster. This site instead attributes every result to
   the `user_id` present in *that season's* league. A manual override file allows
   reassigning any (season, roster) to a different person if an account takeover is
   ever discovered.
2. **Regular season and playoffs are strictly separated.** Regular-season weeks
   (week 1 through `playoff_week_start - 1`, per each season's settings) feed W-L
   records, standings, and PF/PA totals. Playoff bracket games are tracked
   separately (playoff W-L, brackets, championships). Consolation/toilet-bowl games
   never count toward anyone's record.
3. **Three per-season honors:**
   - **Champion** — winner of the playoff bracket final.
   - **PF champ** — highest total points-for across regular-season weeks only.
   - **Last place** — the loser of the losers-bracket final when the season has
     one; otherwise the worst regular-season finish (record, then PF, per Sleeper
     tiebreakers). Consolation games determine this placement but still never
     count toward W-L records (hall of shame).

## Site map

| Page | Route | Content |
|---|---|---|
| Home | `/` | League banner (est. 2021), champions wall: champion + PF champ + last place per season, headline records teasers |
| All-Time Standings | `/standings` | One row per person: seasons played, career regular-season W-L, win %, PF/PA, championships, PF titles, playoff appearances, last places. Sortable. Former members flagged. |
| Head-to-Head | `/h2h` | Matrix of every person vs. every person (all-time regular-season + playoff records shown separately); cell click reveals individual game list |
| Record Book | `/records` | Highest/lowest weekly score, biggest blowout, closest game, most points in a loss, fewest in a win, longest win/loss streaks, best/worst season records, highest season PF, playoff-specific records. Each record: who, when, vs. whom. |
| Season pages | `/season/2021` … | Final standings, playoff bracket, week-by-week matchup scores, full draft board |
| Trades | `/trades` | All completed trades across seasons: participants, players/picks moved, grouped by season |
| Punishments | `/punishments` | One entry per season: the punishment, who suffered it (auto-linked to that season's last place), description, and optional photo/video evidence links. Content comes from a hand-editable `data/punishments.json` — Sleeper has no punishment data. |
| Member pages | `/member/<user_id>` | Seasons played, year-by-year finishes, career stats, personal records, PF titles, trade history, all team names used |

## Architecture

Pre-baked static site. Three stages, fully decoupled:

### 1. Fetch (`scripts/fetch-data.mjs`, Node)

Walks the league chain from the 2026 league back to 2021. Per season, downloads:
league object (settings/scoring), users, rosters, matchups for every week, winners
and losers playoff brackets, draft + draft picks, transactions (for trades). Also
fetches Sleeper's NFL players list once (large; used to resolve player IDs to
names/positions in drafts and trades). Everything is written verbatim to
`data/raw/<season>/*.json` and committed — a permanent snapshot independent of
Sleeper's API availability.

### 2. Compute (`scripts/build-stats.mjs`, Node)

Reads `data/raw/`, applies identity resolution, and emits computed JSON consumed by
the site:

- `data/members.json` — generated map of `user_id` → person (display name, team
  names by season, seasons active).
- `data/overrides.json` — hand-editable, starts empty. Shape:
  `{ "<season>": { "<roster_id or user_id>": "<actual user_id>" } }` to reassign a
  season's team to a different person.
- `data/punishments.json` — hand-editable. One entry per season:
  `{ "season", "title", "description", "media": [urls] }`. The victim is derived
  automatically from that season's computed last-place finisher.
- `data/computed/*.json` — all-time standings, H2H matrix, record book, per-season
  summaries (standings, bracket, weekly results, draft board), trades list,
  per-member profiles.

All math lives here — no stats are computed in page templates.

### 3. Render (Astro)

Astro static site in `src/pages/`, pre-rendered to plain HTML/CSS with minimal JS
(table sorting, H2H cell expansion). Dark theme, football-inspired accents, no
heavy UI framework. Mobile-first (league mates will open it on phones).

## Deployment

- GitHub Pages via GitHub Actions: build + deploy on every push to `main`.
- Data refresh workflow: manually triggerable (workflow_dispatch) and scheduled
  weekly during the NFL season (Sep–Jan). Runs fetch + compute, commits changed
  data, which triggers the deploy. Keeps the current season's page fresh with zero
  manual work.
- Site base path configured for `https://<user>.github.io/12guys1cup/`.

## Error handling

- Fetch script: retries with backoff on transient API failures; hard-fails (leaving
  the previous committed snapshot intact) rather than committing partial data.
- Compute script: validates that every roster in every season resolves to exactly
  one person; fails loudly on unknown user_ids or malformed matchup data instead of
  silently skipping.
- Missing/in-progress season data (2026 pre-draft) renders a "season not started"
  state, not an error.

## Testing

- Vitest unit tests on the compute step: H2H accumulation, streak detection, record
  detection, regular-season/playoff separation, PF-champ calculation, and the
  override mechanism — driven by small fixture data.
- Real-data spot checks: computed 2025 champion, PF champ, and final standings must
  match what Sleeper displays for the 2025 league.

## Out of scope (future phases)

- Power rankings (commissioner's custom formula).
- Live/current-week matchup views.
- Any write operations or authentication — the site is read-only public history.
