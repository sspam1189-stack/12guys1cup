# League History & Records Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pre-baked static website on GitHub Pages presenting the full history of the "12 Guys 1 Cup" Sleeper league: champions, all-time standings, head-to-head, record book, season pages, drafts, trades, punishments, and member pages.

**Architecture:** Three decoupled stages: (1) `scripts/fetch-data.mjs` snapshots the Sleeper API into `data/raw/<season>/`; (2) `scripts/build-stats.mjs` + pure library modules in `scripts/lib/` compute all stats into `data/computed/*.json`, attributing everything to permanent Sleeper `user_id`s with a manual override file; (3) an Astro static site renders the computed JSON. Regular season and playoffs are strictly separated everywhere.

**Tech Stack:** Node 20+ (built-in `fetch`), Astro 5 (static output), Vitest, GitHub Actions + GitHub Pages. No UI framework; one small vanilla JS table-sorter.

**Spec:** `docs/superpowers/specs/2026-08-10-league-history-hub-design.md`

**League facts needed by code:** current league ID `1382479927399419904`; seasons 2021–2026 reachable via `previous_league_id`; GitHub Pages target `https://henryphamphp.github.io/12guys1cup`.

## File structure

```
package.json, astro.config.mjs, .gitignore
scripts/
  fetch-data.mjs        # CLI: snapshot Sleeper API → data/raw/
  build-stats.mjs       # CLI: data/raw/ → data/computed/
  lib/sleeper.mjs       # fetchJson with retry/backoff
  lib/identity.mjs      # roster→person resolution, members map, overrides
  lib/matchups.mjs      # pair weekly matchup entries
  lib/season.mjs        # per-season summary (standings, brackets, honors, games, draft)
  lib/alltime.mjs       # career aggregation
  lib/h2h.mjs           # head-to-head matrix
  lib/records.mjs       # record book incl. streaks
  lib/trades.mjs        # trade extraction
data/
  raw/<season>/*.json   # committed API snapshots
  raw/players.json      # trimmed player-id → name map (trade assets)
  overrides.json        # hand-edited identity overrides (starts empty)
  punishments.json      # hand-edited punishment entries
  computed/*.json       # members, seasons, alltime, h2h, records, trades
src/
  layouts/Base.astro    # shared shell + nav
  styles/global.css     # dark theme
  components/MemberLink.astro
  pages/index.astro                 # home / champions wall
  pages/standings.astro             # all-time standings
  pages/h2h.astro                   # head-to-head grid
  pages/records.astro               # record book
  pages/trades.astro                # trade history
  pages/punishments.astro           # punishments
  pages/season/[year].astro         # season pages
  pages/member/[id].astro           # member pages
tests/
  fixtures/mini-league.mjs          # shared 4-team fixture season
  identity.test.mjs, matchups.test.mjs, season.test.mjs, alltime.test.mjs,
  h2h.test.mjs, records.test.mjs, trades.test.mjs, realdata.test.mjs
.github/workflows/deploy.yml, refresh-data.yml
README.md
```

Data shape used throughout (defined once in `season.mjs`, consumed everywhere):

```js
// game
{ season: '2024', week: 5, type: 'regular'|'playoff',
  a: { userId: '469…', points: 112.5 }, b: { userId: '467…', points: 98.2 } }
// season summary
{ season, name, notStarted?: true, playoffWeekStart,
  standings: [{ userId, rosterId, teamName, wins, losses, ties, pf, pa,
                playoffWins, playoffLosses, place }],
  champion, runnerUp, pfChamp, lastPlace,   // userIds (or null)
  games: [game...],                          // regular + winners-bracket only
  draft: [{ round, pickNo, slot, userId, player, position }] }
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `astro.config.mjs`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "12guys1cup",
  "private": true,
  "type": "module",
  "scripts": {
    "fetch": "node scripts/fetch-data.mjs",
    "compute": "node scripts/build-stats.mjs",
    "test": "vitest run",
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
.astro/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install astro vitest`
Expected: `package.json` gains `dependencies`/`devDependencies`; `package-lock.json` created.

- [ ] **Step 4: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://henryphamphp.github.io',
  base: '/12guys1cup',
});
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore astro.config.mjs
git commit -m "chore: scaffold project (astro + vitest)"
```

---

### Task 2: Sleeper API helper

**Files:**
- Create: `scripts/lib/sleeper.mjs`
- Test: `tests/sleeper.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/sleeper.test.mjs
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson } from '../scripts/lib/sleeper.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')));
    expect(await fetchJson('/league/1')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://api.sleeper.app/v1/league/1');
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response('[1]'));
    vi.stubGlobal('fetch', fn);
    expect(await fetchJson('/x', { retries: 2, delayMs: 1 })).toEqual([1]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    await expect(fetchJson('/x', { retries: 1, delayMs: 1 })).rejects.toThrow('HTTP 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sleeper.test.mjs`
Expected: FAIL — cannot find module `scripts/lib/sleeper.mjs`.

- [ ] **Step 3: Implement `scripts/lib/sleeper.mjs`**

```js
const BASE = 'https://api.sleeper.app/v1';

export async function fetchJson(path, { retries = 3, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sleeper.test.mjs`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sleeper.mjs tests/sleeper.test.mjs
git commit -m "feat: sleeper api helper with retry"
```

---

### Task 3: Fetch script

**Files:**
- Create: `scripts/fetch-data.mjs`

No unit test (network CLI; hard-fails on error leaving previous snapshot intact — validated by running it in Task 4 and by the real-data test in Task 12).

- [ ] **Step 1: Implement `scripts/fetch-data.mjs`**

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchJson } from './lib/sleeper.mjs';

const CURRENT_LEAGUE_ID = '1382479927399419904';
const RAW = new URL('../data/raw/', import.meta.url);
const MAX_WEEK = 18;

async function save(season, name, data) {
  const dir = new URL(`${season}/`, RAW);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(`${name}.json`, dir), JSON.stringify(data, null, 1));
}

// Walk the league chain from current season back to the first.
const leagues = [];
for (let id = CURRENT_LEAGUE_ID; id; ) {
  const league = await fetchJson(`/league/${id}`);
  leagues.push(league);
  id = league.previous_league_id;
}

const tradedPlayerIds = new Set();

for (const league of leagues) {
  const { season, league_id: lid } = league;
  console.log(`Fetching ${season} (${lid})…`);
  await save(season, 'league', league);
  await save(season, 'users', await fetchJson(`/league/${lid}/users`));
  await save(season, 'rosters', await fetchJson(`/league/${lid}/rosters`));

  const matchups = {};
  const transactions = {};
  for (let w = 1; w <= MAX_WEEK; w++) {
    matchups[w] = await fetchJson(`/league/${lid}/matchups/${w}`);
    transactions[w] = await fetchJson(`/league/${lid}/transactions/${w}`);
    for (const t of transactions[w] ?? []) {
      if (t.type === 'trade' && t.status === 'complete') {
        for (const pid of Object.keys(t.adds ?? {})) tradedPlayerIds.add(pid);
      }
    }
  }
  await save(season, 'matchups', matchups);
  await save(season, 'transactions', transactions);

  await save(season, 'winners_bracket', await fetchJson(`/league/${lid}/winners_bracket`));
  await save(season, 'losers_bracket', await fetchJson(`/league/${lid}/losers_bracket`));

  const drafts = await fetchJson(`/league/${lid}/drafts`);
  await save(season, 'draft', drafts?.[0] ?? null);
  await save(
    season,
    'draft_picks',
    drafts?.[0] ? await fetchJson(`/draft/${drafts[0].draft_id}/picks`) : [],
  );
}

// Trim the huge players blob to just ids referenced by trades.
console.log('Fetching player list…');
const allPlayers = await fetchJson('/players/nfl');
const players = {};
for (const pid of tradedPlayerIds) {
  const p = allPlayers[pid];
  players[pid] = p
    ? { name: p.full_name ?? `${p.first_name} ${p.last_name}`, position: p.position ?? '' }
    : { name: pid, position: '' };
}
await mkdir(RAW, { recursive: true });
await writeFile(new URL('players.json', RAW), JSON.stringify(players, null, 1));
console.log(`Done. ${leagues.length} seasons, ${tradedPlayerIds.size} traded players.`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/fetch-data.mjs
git commit -m "feat: sleeper snapshot fetch script"
```

---

### Task 4: Run the fetch, commit the snapshot

- [ ] **Step 1: Run the fetch**

Run: `npm run fetch`
Expected: logs one line per season 2026→2021, then the players line; `data/raw/<season>/` populated for six seasons plus `data/raw/players.json`.

- [ ] **Step 2: Sanity-check the snapshot**

Run: `node -e "import('node:fs').then(fs => console.log(fs.readdirSync('data/raw')))"`
Expected: `[ '2021', '2022', '2023', '2024', '2025', '2026', 'players.json' ]`

- [ ] **Step 3: Commit**

```bash
git add data/raw
git commit -m "data: initial sleeper snapshot (2021-2026)"
```

---

### Task 5: Identity resolution

**Files:**
- Create: `scripts/lib/identity.mjs`, `data/overrides.json`, `tests/fixtures/mini-league.mjs`
- Test: `tests/identity.test.mjs`

- [ ] **Step 1: Create the shared fixture `tests/fixtures/mini-league.mjs`**

A 4-team season with 3 regular weeks and a 2-team playoff (week 4). Known outcomes: Alice 3-0 champ & PF champ (330), Bob 2-1 runner-up, Carol 1-2 **last place** (loses toilet bowl), Dave 0-3 but wins toilet bowl (3rd). This deliberately exercises "last place = loser of losers-bracket final, not worst record".

```js
// tests/fixtures/mini-league.mjs
export const users = [
  { user_id: 'u1', display_name: 'Alice', metadata: { team_name: 'Team A' } },
  { user_id: 'u2', display_name: 'Bob', metadata: { team_name: 'Team B' } },
  { user_id: 'u3', display_name: 'Carol', metadata: { team_name: 'Team C' } },
  { user_id: 'u4', display_name: 'Dave', metadata: { team_name: 'Team D' } },
];

export const rosters = [
  { roster_id: 1, owner_id: 'u1' },
  { roster_id: 2, owner_id: 'u2' },
  { roster_id: 3, owner_id: 'u3' },
  { roster_id: 4, owner_id: 'u4' },
];

const m = (id, roster, points) => ({ matchup_id: id, roster_id: roster, points });

export const season = {
  season: '2030',
  league: {
    season: '2030', name: 'Mini League', status: 'complete', league_id: 'L1',
    settings: { playoff_week_start: 4, playoff_teams: 2 },
  },
  users,
  rosters,
  matchups: {
    1: [m(1, 1, 100), m(1, 2, 90), m(2, 3, 80), m(2, 4, 70)],
    2: [m(1, 1, 110), m(1, 3, 60), m(2, 2, 95), m(2, 4, 85)],
    3: [m(1, 1, 120), m(1, 4, 50), m(2, 2, 88), m(2, 3, 87)],
    4: [m(1, 1, 105), m(1, 2, 99), m(2, 3, 65), m(2, 4, 88)],
  },
  winners_bracket: [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }],
  losers_bracket: [{ r: 1, m: 1, t1: 3, t2: 4, w: 4, l: 3, p: 1 }],
  draft_picks: [
    { round: 1, pick_no: 1, draft_slot: 1, roster_id: 1, picked_by: 'u1',
      metadata: { first_name: 'Star', last_name: 'Runner', position: 'RB' } },
  ],
  transactions: {
    2: [{
      type: 'trade', status: 'complete', roster_ids: [1, 2],
      adds: { p100: 1, p200: 2 },
      draft_picks: [{ season: '2031', round: 2, owner_id: 1, previous_owner_id: 2, roster_id: 2 }],
      created: 1700000000000,
    }],
  },
};

export const players = {
  p100: { name: 'John Smith', position: 'RB' },
  p200: { name: 'Mike Jones', position: 'WR' },
};
```

- [ ] **Step 2: Write the failing test**

```js
// tests/identity.test.mjs
import { describe, it, expect } from 'vitest';
import { loadOwnerMap, buildMembers } from '../scripts/lib/identity.mjs';
import { season } from './fixtures/mini-league.mjs';

describe('loadOwnerMap', () => {
  it('maps roster_id to owner user_id', () => {
    const map = loadOwnerMap(season.rosters);
    expect(map.get(1)).toBe('u1');
    expect(map.get(4)).toBe('u4');
  });

  it('applies overrides by roster id and by user id', () => {
    expect(loadOwnerMap(season.rosters, { 2: 'u9' }).get(2)).toBe('u9');
    expect(loadOwnerMap(season.rosters, { u3: 'u8' }).get(3)).toBe('u8');
  });

  it('throws on ownerless roster', () => {
    expect(() => loadOwnerMap([{ roster_id: 9, owner_id: null }])).toThrow(/roster 9/i);
  });
});

describe('buildMembers', () => {
  it('collects one entry per person with team names by season', () => {
    const members = buildMembers([season], {});
    expect(Object.keys(members).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(members.u1).toMatchObject({
      name: 'Alice', seasons: ['2030'], teamNames: { 2030: 'Team A' },
    });
  });

  it('keeps an overridden person separate from the account holder', () => {
    const members = buildMembers([season], { 2030: { u3: 'u8' } });
    expect(members.u8.seasons).toEqual(['2030']);
    expect(members.u3).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/identity.test.mjs`
Expected: FAIL — cannot find module `scripts/lib/identity.mjs`.

- [ ] **Step 4: Implement `scripts/lib/identity.mjs`**

```js
// Overrides shape: { [rosterIdOrUserId]: actualUserId } for one season.
export function loadOwnerMap(rosters, overrides = {}) {
  const map = new Map();
  for (const r of rosters) {
    let owner = r.owner_id == null ? null : String(r.owner_id);
    const replacement = overrides[String(r.roster_id)] ?? (owner && overrides[owner]);
    if (replacement) owner = String(replacement);
    if (!owner) throw new Error(`Roster ${r.roster_id} has no owner and no override`);
    map.set(r.roster_id, owner);
  }
  return map;
}

// seasonsRaw: [{ season, users, rosters }] sorted ascending by season.
// overridesBySeason: { [season]: { [rosterIdOrUserId]: userId } }
export function buildMembers(seasonsRaw, overridesBySeason = {}) {
  const members = {};
  for (const raw of seasonsRaw) {
    const ownerMap = loadOwnerMap(raw.rosters, overridesBySeason[raw.season] ?? {});
    const usersById = Object.fromEntries(raw.users.map((u) => [u.user_id, u]));
    for (const userId of ownerMap.values()) {
      const u = usersById[userId];
      const m = (members[userId] ??= {
        userId, name: userId, avatar: null, seasons: [], teamNames: {},
      });
      if (u?.display_name) m.name = u.display_name; // later seasons win
      if (u?.avatar) m.avatar = u.avatar;
      if (!m.seasons.includes(raw.season)) m.seasons.push(raw.season);
      m.teamNames[raw.season] = u?.metadata?.team_name || u?.display_name || 'Unnamed';
    }
  }
  return members;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/identity.test.mjs`
Expected: 5 passed.

- [ ] **Step 6: Create `data/overrides.json`**

```json
{}
```

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/identity.mjs tests/identity.test.mjs tests/fixtures/mini-league.mjs data/overrides.json
git commit -m "feat: identity resolution with manual overrides"
```

---

### Task 6: Matchup pairing

**Files:**
- Create: `scripts/lib/matchups.mjs`
- Test: `tests/matchups.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/matchups.test.mjs
import { describe, it, expect } from 'vitest';
import { pairWeek } from '../scripts/lib/matchups.mjs';
import { season } from './fixtures/mini-league.mjs';

describe('pairWeek', () => {
  it('pairs entries by matchup_id', () => {
    const pairs = pairWeek(season.matchups[1]);
    expect(pairs).toHaveLength(2);
    const first = pairs.find((p) => p.a.matchup_id === 1);
    expect([first.a.roster_id, first.b.roster_id].sort()).toEqual([1, 2]);
  });

  it('skips null matchup ids and unpaired entries', () => {
    expect(pairWeek([
      { matchup_id: null, roster_id: 1, points: 10 },
      { matchup_id: 7, roster_id: 2, points: 20 },
    ])).toEqual([]);
  });

  it('returns [] for empty or missing input', () => {
    expect(pairWeek([])).toEqual([]);
    expect(pairWeek(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/matchups.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/matchups.mjs`**

```js
export function pairWeek(entries) {
  const byMatch = new Map();
  for (const e of entries ?? []) {
    if (e.matchup_id == null) continue;
    if (!byMatch.has(e.matchup_id)) byMatch.set(e.matchup_id, []);
    byMatch.get(e.matchup_id).push(e);
  }
  const pairs = [];
  for (const list of byMatch.values()) {
    if (list.length === 2) pairs.push({ a: list[0], b: list[1] });
  }
  return pairs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/matchups.test.mjs`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/matchups.mjs tests/matchups.test.mjs
git commit -m "feat: weekly matchup pairing"
```

---

### Task 7: Season summary

**Files:**
- Create: `scripts/lib/season.mjs`
- Test: `tests/season.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/season.test.mjs
import { describe, it, expect } from 'vitest';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const summary = summarizeSeason(season);
const team = (userId) => summary.standings.find((t) => t.userId === userId);

describe('summarizeSeason', () => {
  it('computes regular-season records and points (playoffs excluded)', () => {
    expect(team('u1')).toMatchObject({ wins: 3, losses: 0, pf: 330, pa: 200 });
    expect(team('u2')).toMatchObject({ wins: 2, losses: 1, pf: 273 });
    expect(team('u4')).toMatchObject({ wins: 0, losses: 3, pf: 205 });
  });

  it('tracks playoff wins separately (winners bracket only)', () => {
    expect(team('u1')).toMatchObject({ playoffWins: 1, playoffLosses: 0 });
    expect(team('u2')).toMatchObject({ playoffWins: 0, playoffLosses: 1 });
    expect(team('u3')).toMatchObject({ playoffWins: 0, playoffLosses: 0 }); // toilet bowl doesn't count
  });

  it('awards honors: champion, runner-up, PF champ, last place', () => {
    expect(summary.champion).toBe('u1');
    expect(summary.runnerUp).toBe('u2');
    expect(summary.pfChamp).toBe('u1');
    expect(summary.lastPlace).toBe('u3'); // lost toilet bowl despite better record than u4
  });

  it('assigns final placements from brackets', () => {
    expect(team('u1').place).toBe(1);
    expect(team('u2').place).toBe(2);
    expect(team('u4').place).toBe(3);
    expect(team('u3').place).toBe(4);
  });

  it('emits games: 6 regular + 1 playoff, no consolation', () => {
    expect(summary.games.filter((g) => g.type === 'regular')).toHaveLength(6);
    expect(summary.games.filter((g) => g.type === 'playoff')).toHaveLength(1);
  });

  it('builds the draft board', () => {
    expect(summary.draft[0]).toMatchObject({
      round: 1, pickNo: 1, userId: 'u1', player: 'Star Runner', position: 'RB',
    });
  });

  it('returns notStarted for pre-draft seasons', () => {
    const pre = summarizeSeason({
      ...season,
      league: { ...season.league, status: 'pre_draft' },
    });
    expect(pre.notStarted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/season.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/season.mjs`**

```js
import { pairWeek } from './matchups.mjs';
import { loadOwnerMap } from './identity.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export function summarizeSeason(raw, overrides = {}) {
  const { league, users, rosters, matchups } = raw;
  const season = league.season;
  if (league.status === 'pre_draft' || league.status === 'drafting') {
    return { season, name: league.name, notStarted: true };
  }

  const ownerMap = loadOwnerMap(rosters, overrides);
  const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const pws = league.settings.playoff_week_start;

  const teams = new Map();
  for (const [rosterId, userId] of ownerMap) {
    const u = usersById[userId];
    teams.set(rosterId, {
      userId, rosterId,
      teamName: u?.metadata?.team_name || u?.display_name || 'Unnamed',
      wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
      playoffWins: 0, playoffLosses: 0, place: null,
    });
  }

  const game = (week, type, ta, pa, tb, pb) => ({
    season, week, type,
    a: { userId: ta.userId, points: pa },
    b: { userId: tb.userId, points: pb },
  });
  const games = [];

  // Regular season: weeks 1 .. playoff_week_start - 1.
  for (let week = 1; week < pws; week++) {
    for (const { a, b } of pairWeek(matchups[week])) {
      if (!a.points && !b.points) continue; // unplayed (in-progress season)
      const ta = teams.get(a.roster_id);
      const tb = teams.get(b.roster_id);
      ta.pf += a.points; ta.pa += b.points;
      tb.pf += b.points; tb.pa += a.points;
      if (a.points > b.points) { ta.wins++; tb.losses++; }
      else if (b.points > a.points) { tb.wins++; ta.losses++; }
      else { ta.ties++; tb.ties++; }
      games.push(game(week, 'regular', ta, a.points, tb, b.points));
    }
  }
  for (const t of teams.values()) { t.pf = round2(t.pf); t.pa = round2(t.pa); }

  // Playoffs: winners-bracket games only. Round r plays in week pws + r - 1.
  for (const match of raw.winners_bracket ?? []) {
    if (typeof match.t1 !== 'number' || typeof match.t2 !== 'number' || match.w == null) continue;
    const week = pws + match.r - 1;
    const wanted = [match.t1, match.t2].sort().join();
    const pair = pairWeek(matchups[week]).find(
      ({ a, b }) => [a.roster_id, b.roster_id].sort().join() === wanted,
    );
    if (!pair) continue;
    const ta = teams.get(pair.a.roster_id);
    const tb = teams.get(pair.b.roster_id);
    if (pair.a.points > pair.b.points) { ta.playoffWins++; tb.playoffLosses++; }
    else { tb.playoffWins++; ta.playoffLosses++; }
    games.push(game(week, 'playoff', ta, pair.a.points, tb, pair.b.points));
  }

  // Placements. Winners bracket p:X → places X and X+1.
  // Losers bracket p:X → places playoff_teams + X and + X + 1.
  const nPlayoff = league.settings.playoff_teams;
  for (const m of raw.winners_bracket ?? []) {
    if (m.p != null && m.w != null && teams.has(m.w)) {
      teams.get(m.w).place = m.p;
      if (teams.has(m.l)) teams.get(m.l).place = m.p + 1;
    }
  }
  for (const m of raw.losers_bracket ?? []) {
    if (m.p != null && m.w != null && teams.has(m.w)) {
      teams.get(m.w).place = nPlayoff + m.p;
      if (teams.has(m.l)) teams.get(m.l).place = nPlayoff + m.p + 1;
    }
  }
  // Fallback for unplaced teams: by record, then PF, into remaining slots.
  const taken = new Set([...teams.values()].map((t) => t.place).filter((p) => p != null));
  const unplaced = [...teams.values()].filter((t) => t.place == null)
    .sort((x, y) => y.wins - x.wins || y.pf - x.pf);
  let next = 1;
  for (const t of unplaced) {
    while (taken.has(next)) next++;
    t.place = next;
    taken.add(next);
  }

  // Honors.
  const final = (raw.winners_bracket ?? []).find((m) => m.p === 1 && m.w != null);
  const champion = final ? teams.get(final.w)?.userId ?? null : null;
  const runnerUp = final ? teams.get(final.l)?.userId ?? null : null;
  const loserMatches = (raw.losers_bracket ?? []).filter((m) => m.p != null && m.w != null);
  const lastMatch = loserMatches.sort((a, b) => b.p - a.p)[0];
  const lastPlace = lastMatch
    ? teams.get(lastMatch.l)?.userId ?? null
    : [...teams.values()].sort((a, b) => b.place - a.place)[0]?.userId ?? null;
  const pfChamp = [...teams.values()].sort((a, b) => b.pf - a.pf)[0]?.userId ?? null;

  const draft = (raw.draft_picks ?? []).map((p) => ({
    round: p.round, pickNo: p.pick_no, slot: p.draft_slot,
    userId: p.picked_by || ownerMap.get(p.roster_id) || null,
    player: `${p.metadata?.first_name ?? ''} ${p.metadata?.last_name ?? ''}`.trim(),
    position: p.metadata?.position ?? '',
  }));

  return {
    season, name: league.name, playoffWeekStart: pws,
    standings: [...teams.values()].sort((a, b) => a.place - b.place),
    champion, runnerUp, pfChamp, lastPlace, games, draft,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/season.test.mjs`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/season.mjs tests/season.test.mjs
git commit -m "feat: per-season summary with strict regular/playoff separation"
```

---

### Task 8: All-time aggregation

**Files:**
- Create: `scripts/lib/alltime.mjs`
- Test: `tests/alltime.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/alltime.test.mjs
import { describe, it, expect } from 'vitest';
import { buildAlltime } from '../scripts/lib/alltime.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

// Two identical seasons → doubled career stats, doubled honors.
const s1 = summarizeSeason(season);
const s2 = { ...summarizeSeason(season), season: '2031' };
const careers = buildAlltime([s1, s2, { season: '2032', notStarted: true }]);
const career = (id) => careers.find((c) => c.userId === id);

describe('buildAlltime', () => {
  it('sums careers across seasons and skips unstarted ones', () => {
    expect(career('u1')).toMatchObject({
      seasons: 2, wins: 6, losses: 0, pf: 660, championships: 2, pfTitles: 2,
      playoffAppearances: 2, lastPlaces: 0, playoffWins: 2,
    });
    expect(career('u3')).toMatchObject({ lastPlaces: 2, playoffAppearances: 0 });
  });

  it('records year-by-year finishes', () => {
    expect(career('u4').finishes).toEqual({ 2030: 3, 2031: 3 });
  });

  it('sorts by win percentage descending', () => {
    expect(careers[0].userId).toBe('u1');
    expect(careers.at(-1).userId).toBe('u4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/alltime.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/alltime.mjs`**

```js
const round2 = (n) => Math.round(n * 100) / 100;

export function winPct(c) {
  const games = c.wins + c.losses + c.ties;
  return games ? (c.wins + c.ties / 2) / games : 0;
}

export function buildAlltime(seasonSummaries) {
  const careers = {};
  for (const s of seasonSummaries) {
    if (s.notStarted) continue;
    for (const t of s.standings) {
      const c = (careers[t.userId] ??= {
        userId: t.userId, seasons: 0, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
        playoffWins: 0, playoffLosses: 0, championships: 0, pfTitles: 0,
        playoffAppearances: 0, lastPlaces: 0, finishes: {},
      });
      c.seasons++;
      c.wins += t.wins; c.losses += t.losses; c.ties += t.ties;
      c.pf = round2(c.pf + t.pf); c.pa = round2(c.pa + t.pa);
      c.playoffWins += t.playoffWins; c.playoffLosses += t.playoffLosses;
      c.finishes[s.season] = t.place;
      if (s.champion === t.userId) c.championships++;
      if (s.pfChamp === t.userId) c.pfTitles++;
      if (s.lastPlace === t.userId) c.lastPlaces++;
      if (t.playoffWins + t.playoffLosses > 0) c.playoffAppearances++;
    }
  }
  return Object.values(careers).sort((a, b) => winPct(b) - winPct(a));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/alltime.test.mjs`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/alltime.mjs tests/alltime.test.mjs
git commit -m "feat: all-time career aggregation"
```

---

### Task 9: Head-to-head matrix

**Files:**
- Create: `scripts/lib/h2h.mjs`
- Test: `tests/h2h.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/h2h.test.mjs
import { describe, it, expect } from 'vitest';
import { buildH2h } from '../scripts/lib/h2h.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const cells = buildH2h(summarizeSeason(season).games);

describe('buildH2h', () => {
  it('accumulates regular-season records per pairing (key sorted by userId)', () => {
    // u1 beat u2 in week 1 (regular) and week 4 (playoff final).
    expect(cells['u1|u2'].regular).toEqual({ aWins: 1, bWins: 0, ties: 0 });
    expect(cells['u1|u2'].playoff).toEqual({ aWins: 1, bWins: 0, ties: 0 });
    expect(cells['u2|u3'].regular).toEqual({ aWins: 1, bWins: 0, ties: 0 });
  });

  it('keeps the raw game list per pairing', () => {
    expect(cells['u1|u2'].games).toHaveLength(2);
    expect(cells['u1|u4'].games).toHaveLength(1);
  });

  it('has no cell for pairs that never met', () => {
    // In the fixture every pair met at least once; a fabricated id has no cell.
    expect(cells['u1|u9']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/h2h.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/h2h.mjs`**

```js
export function buildH2h(allGames) {
  const cells = {};
  for (const g of allGames) {
    const [x, y] = g.a.userId < g.b.userId ? [g.a, g.b] : [g.b, g.a];
    const key = `${x.userId}|${y.userId}`;
    const c = (cells[key] ??= {
      a: x.userId, b: y.userId,
      regular: { aWins: 0, bWins: 0, ties: 0 },
      playoff: { aWins: 0, bWins: 0, ties: 0 },
      games: [],
    });
    const bucket = g.type === 'regular' ? c.regular : c.playoff;
    if (x.points > y.points) bucket.aWins++;
    else if (y.points > x.points) bucket.bWins++;
    else bucket.ties++;
    c.games.push(g);
  }
  return cells;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/h2h.test.mjs`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/h2h.mjs tests/h2h.test.mjs
git commit -m "feat: head-to-head matrix"
```

---

### Task 10: Record book

**Files:**
- Create: `scripts/lib/records.mjs`
- Test: `tests/records.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/records.test.mjs
import { describe, it, expect } from 'vitest';
import { buildRecords } from '../scripts/lib/records.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const records = buildRecords([summarizeSeason(season)]);

describe('buildRecords (regular season)', () => {
  it('weekly score records', () => {
    expect(records.highestGame[0]).toMatchObject({ userId: 'u1', points: 120, week: 3 });
    expect(records.lowestGame[0]).toMatchObject({ userId: 'u4', points: 50, week: 3 });
  });

  it('margin records', () => {
    expect(records.biggestBlowout[0]).toMatchObject({ userId: 'u1', margin: 70 });
    expect(records.closestGame[0]).toMatchObject({ userId: 'u2', margin: 1 });
  });

  it('hard-luck records', () => {
    expect(records.mostPointsInLoss[0]).toMatchObject({ userId: 'u2', points: 90 });
    expect(records.fewestPointsInWin[0]).toMatchObject({ userId: 'u3', points: 80 });
  });

  it('streaks', () => {
    expect(records.longestWinStreak[0]).toMatchObject({ userId: 'u1', length: 3 });
    expect(records.longestLossStreak[0]).toMatchObject({ userId: 'u4', length: 3 });
  });

  it('season records', () => {
    expect(records.bestSeasons[0]).toMatchObject({ userId: 'u1', wins: 3, losses: 0 });
    expect(records.highestSeasonPf[0]).toMatchObject({ userId: 'u1', pf: 330 });
  });

  it('playoff records stay separate', () => {
    expect(records.playoffHighestGame[0]).toMatchObject({ userId: 'u1', points: 105 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/records.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/records.mjs`**

```js
const TOP_N = 5;

// One row per team per game: { userId, points, oppUserId, oppPoints, margin, won, season, week }
function performances(games) {
  return games.flatMap((g) => [
    { userId: g.a.userId, points: g.a.points, oppUserId: g.b.userId, oppPoints: g.b.points,
      margin: g.a.points - g.b.points, won: g.a.points > g.b.points, season: g.season, week: g.week },
    { userId: g.b.userId, points: g.b.points, oppUserId: g.a.userId, oppPoints: g.a.points,
      margin: g.b.points - g.a.points, won: g.b.points > g.a.points, season: g.season, week: g.week },
  ]);
}

function streaks(games, target) {
  const chron = [...games].sort((a, b) => a.season.localeCompare(b.season) || a.week - b.week);
  const seqs = {};
  for (const p of performances(chron)) {
    (seqs[p.userId] ??= []).push(p.margin === 0 ? 'T' : p.won ? 'W' : 'L');
  }
  return Object.entries(seqs)
    .map(([userId, seq]) => {
      let cur = 0, best = 0;
      for (const r of seq) { cur = r === target ? cur + 1 : 0; best = Math.max(best, cur); }
      return { userId, length: best };
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, TOP_N);
}

const top = (arr, cmp) => [...arr].sort(cmp).slice(0, TOP_N);

export function buildRecords(seasonSummaries) {
  const started = seasonSummaries.filter((s) => !s.notStarted);
  const reg = started.flatMap((s) => s.games.filter((g) => g.type === 'regular'));
  const po = started.flatMap((s) => s.games.filter((g) => g.type === 'playoff'));
  const rp = performances(reg);
  const seasonRows = started.flatMap((s) =>
    s.standings.map((t) => ({ season: s.season, userId: t.userId, wins: t.wins,
      losses: t.losses, ties: t.ties, pf: t.pf })));

  return {
    highestGame: top(rp, (a, b) => b.points - a.points),
    lowestGame: top(rp, (a, b) => a.points - b.points),
    biggestBlowout: top(rp.filter((p) => p.won), (a, b) => b.margin - a.margin),
    closestGame: top(rp.filter((p) => p.won), (a, b) => a.margin - b.margin),
    mostPointsInLoss: top(rp.filter((p) => !p.won && p.margin !== 0), (a, b) => b.points - a.points),
    fewestPointsInWin: top(rp.filter((p) => p.won), (a, b) => a.points - b.points),
    longestWinStreak: streaks(reg, 'W'),
    longestLossStreak: streaks(reg, 'L'),
    bestSeasons: top(seasonRows, (a, b) => b.wins - a.wins || b.pf - a.pf),
    worstSeasons: top(seasonRows, (a, b) => a.wins - b.wins || a.pf - b.pf),
    highestSeasonPf: top(seasonRows, (a, b) => b.pf - a.pf),
    playoffHighestGame: top(performances(po), (a, b) => b.points - a.points),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/records.test.mjs`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/records.mjs tests/records.test.mjs
git commit -m "feat: record book with streaks and season records"
```

---

### Task 11: Trades

**Files:**
- Create: `scripts/lib/trades.mjs`
- Test: `tests/trades.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/trades.test.mjs
import { describe, it, expect } from 'vitest';
import { extractTrades } from '../scripts/lib/trades.mjs';
import { loadOwnerMap } from '../scripts/lib/identity.mjs';
import { season, players } from './fixtures/mini-league.mjs';

describe('extractTrades', () => {
  it('extracts completed trades with resolved names', () => {
    const trades = extractTrades(season, loadOwnerMap(season.rosters), players);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      season: '2030', week: 2, parties: ['u1', 'u2'],
    });
    expect(trades[0].assets.u1.players).toEqual(['John Smith (RB)']);
    expect(trades[0].assets.u1.picks).toEqual(['2031 Round 2']);
    expect(trades[0].assets.u2.players).toEqual(['Mike Jones (WR)']);
  });

  it('ignores non-trade and incomplete transactions', () => {
    const raw = {
      ...season,
      transactions: { 1: [
        { type: 'waiver', status: 'complete', roster_ids: [1] },
        { type: 'trade', status: 'failed', roster_ids: [1, 2], adds: {} },
      ] },
    };
    expect(extractTrades(raw, loadOwnerMap(season.rosters), players)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/trades.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `scripts/lib/trades.mjs`**

```js
export function extractTrades(raw, ownerMap, players = {}) {
  const out = [];
  for (const [week, txs] of Object.entries(raw.transactions ?? {})) {
    for (const t of txs ?? []) {
      if (t.type !== 'trade' || t.status !== 'complete') continue;
      const assets = {};
      const parties = (t.roster_ids ?? []).map((rid) => ownerMap.get(rid)).filter(Boolean);
      for (const userId of parties) assets[userId] = { players: [], picks: [] };
      for (const [pid, rid] of Object.entries(t.adds ?? {})) {
        const userId = ownerMap.get(rid);
        if (!assets[userId]) continue;
        const p = players[pid];
        assets[userId].players.push(p ? `${p.name} (${p.position})` : String(pid));
      }
      for (const pk of t.draft_picks ?? []) {
        const userId = ownerMap.get(pk.owner_id);
        if (assets[userId]) assets[userId].picks.push(`${pk.season} Round ${pk.round}`);
      }
      out.push({ season: raw.season, week: Number(week), parties, assets, created: t.created ?? null });
    }
  }
  return out.sort((a, b) => a.week - b.week);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/trades.test.mjs`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/trades.mjs tests/trades.test.mjs
git commit -m "feat: trade extraction"
```

---

### Task 12: Compute orchestrator + real-data validation

**Files:**
- Create: `scripts/build-stats.mjs`, `data/punishments.json`
- Test: `tests/realdata.test.mjs`

- [ ] **Step 1: Create `data/punishments.json`** (Henry fills in details later; empty is valid)

```json
[]
```

- [ ] **Step 2: Implement `scripts/build-stats.mjs`**

```js
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { buildMembers, loadOwnerMap } from './lib/identity.mjs';
import { summarizeSeason } from './lib/season.mjs';
import { buildAlltime } from './lib/alltime.mjs';
import { buildH2h } from './lib/h2h.mjs';
import { buildRecords } from './lib/records.mjs';
import { extractTrades } from './lib/trades.mjs';

const DATA = new URL('../data/', import.meta.url);
const RAW = new URL('raw/', DATA);
const OUT = new URL('computed/', DATA);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

export async function loadRawSeasons() {
  const dirs = (await readdir(RAW)).filter((d) => /^\d{4}$/.test(d)).sort();
  const seasons = [];
  for (const season of dirs) {
    const at = (f) => new URL(`${season}/${f}.json`, RAW);
    seasons.push({
      season,
      league: await readJson(at('league')),
      users: await readJson(at('users')),
      rosters: await readJson(at('rosters')),
      matchups: await readJson(at('matchups')),
      transactions: await readJson(at('transactions')),
      winners_bracket: await readJson(at('winners_bracket')),
      losers_bracket: await readJson(at('losers_bracket')),
      draft_picks: await readJson(at('draft_picks')),
    });
  }
  return seasons;
}

const raws = await loadRawSeasons();
const overrides = await readJson(new URL('overrides.json', DATA));
const players = await readJson(new URL('players.json', RAW));

const members = buildMembers(raws, overrides);
const summaries = raws.map((raw) => summarizeSeason(raw, overrides[raw.season] ?? {}));

// Validation: every game participant must be a known member.
for (const s of summaries) {
  for (const g of s.games ?? []) {
    for (const side of [g.a, g.b]) {
      if (!members[side.userId]) {
        throw new Error(`Unknown userId ${side.userId} in ${s.season} week ${g.week}`);
      }
    }
  }
}

const allGames = summaries.filter((s) => !s.notStarted).flatMap((s) => s.games);
const trades = raws.flatMap((raw) =>
  raw.league.status === 'pre_draft' || raw.league.status === 'drafting'
    ? []
    : extractTrades(raw, loadOwnerMap(raw.rosters, overrides[raw.season] ?? {}), players));

await mkdir(OUT, { recursive: true });
const write = (name, data) =>
  writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data, null, 1));
await write('members', members);
await write('seasons', summaries);
await write('alltime', buildAlltime(summaries));
await write('h2h', buildH2h(allGames));
await write('records', buildRecords(summaries));
await write('trades', trades);
console.log(`Computed ${summaries.length} seasons, ${allGames.length} games, ${trades.length} trades.`);
```

- [ ] **Step 3: Write the real-data validation test**

Cross-checks our computed regular-season records/points against Sleeper's own per-roster totals (`rosters[].settings`) for every completed season — this is the "matches what Sleeper shows" spot check. Skips gracefully if `data/raw/` doesn't exist.

```js
// tests/realdata.test.mjs
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { summarizeSeason } from '../scripts/lib/season.mjs';

const hasData = existsSync(new URL('../data/raw', import.meta.url));

describe.skipIf(!hasData)('real data cross-validation', async () => {
  const { loadRawSeasons } = await import('../scripts/build-stats.mjs');
  const raws = (await loadRawSeasons()).filter((r) => r.league.status === 'complete');

  it('has 5 completed seasons', () => {
    expect(raws.map((r) => r.season)).toEqual(['2021', '2022', '2023', '2024', '2025']);
  });

  it.each(raws.map((r) => [r.season, r]))(
    'season %s matches sleeper roster totals',
    (name, raw) => {
      const summary = summarizeSeason(raw);
      for (const roster of raw.rosters) {
        const t = summary.standings.find((x) => x.rosterId === roster.roster_id);
        expect(t.wins, `wins roster ${roster.roster_id}`).toBe(roster.settings.wins);
        expect(t.losses, `losses roster ${roster.roster_id}`).toBe(roster.settings.losses);
        const sleeperPf = roster.settings.fpts + (roster.settings.fpts_decimal ?? 0) / 100;
        expect(Math.abs(t.pf - sleeperPf), `pf roster ${roster.roster_id}`).toBeLessThan(0.05);
      }
      expect(summary.champion).toBeTruthy();
      expect(summary.pfChamp).toBeTruthy();
      expect(summary.lastPlace).toBeTruthy();
    },
  );
});
```

Note: `build-stats.mjs` runs its pipeline on import (it's a script). The test imports it only for `loadRawSeasons`, which also executes the pipeline — that is acceptable (idempotent, writes `data/computed/`). If it proves annoying, move `loadRawSeasons` to `scripts/lib/loadraw.mjs`; keep behavior identical.

- [ ] **Step 4: Run the compute + full test suite**

Run: `npm run compute && npm test`
Expected: compute logs seasons/games/trades counts; ALL tests pass including 5 per-season cross-validations. If a cross-validation fails, debug with the systematic-debugging skill — do not loosen the assertion.

- [ ] **Step 5: Commit computed data**

```bash
git add scripts/build-stats.mjs tests/realdata.test.mjs data/punishments.json data/computed
git commit -m "feat: stats pipeline validated against sleeper totals"
```

---

### Task 13: Astro base + home page (champions wall)

**Files:**
- Create: `src/styles/global.css`, `src/layouts/Base.astro`, `src/components/MemberLink.astro`, `src/pages/index.astro`

- [ ] **Step 1: Create `src/styles/global.css`**

```css
:root {
  --bg: #0d1117; --bg2: #161b22; --card: #1c2330;
  --text: #e6edf3; --muted: #8b949e;
  --accent: #3fb950; --gold: #e3b341; --red: #f85149;
  --border: #30363d;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
main { max-width: 1000px; margin: 0 auto; padding: 1rem; }
h1, h2 { font-weight: 800; letter-spacing: -0.02em; }
h1 { font-size: 1.7rem; } h2 { font-size: 1.25rem; margin-top: 2rem; }
nav {
  background: var(--bg2); border-bottom: 1px solid var(--border);
  display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.5rem 1rem;
  position: sticky; top: 0; z-index: 10;
}
nav a { color: var(--text); padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.9rem; }
nav a:hover { background: var(--card); text-decoration: none; }
nav .brand { font-weight: 800; color: var(--gold); }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
table.sortable th { cursor: pointer; user-select: none; }
.table-wrap { overflow-x: auto; }
.card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 10px; padding: 1rem;
}
.wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0.75rem; }
.gold { color: var(--gold); } .muted { color: var(--muted); } .red { color: var(--red); }
.badge {
  display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.45rem;
  border-radius: 999px; border: 1px solid var(--border); color: var(--muted);
}
details summary { cursor: pointer; color: var(--accent); }
```

- [ ] **Step 2: Create `src/layouts/Base.astro`**

```astro
---
import '../styles/global.css';
const { title = '12 Guys 1 Cup' } = Astro.props;
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const links = [
  ['/', 'Home'], ['/standings/', 'All-Time'], ['/h2h/', 'Head-to-Head'],
  ['/records/', 'Records'], ['/trades/', 'Trades'], ['/punishments/', 'Punishments'],
];
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <nav>
      <a class="brand" href={`${base}/`}>🏆 12 Guys 1 Cup</a>
      {links.slice(1).map(([href, label]) => <a href={`${base}${href}`}>{label}</a>)}
    </nav>
    <main><slot /></main>
  </body>
</html>
```

- [ ] **Step 3: Create `src/components/MemberLink.astro`**

```astro
---
import members from '../../data/computed/members.json';
const { id } = Astro.props;
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const name = members[id]?.name ?? id;
---
<a href={`${base}/member/${id}/`}>{name}</a>
```

- [ ] **Step 4: Create `src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import seasons from '../../data/computed/seasons.json';
import records from '../../data/computed/records.json';
import members from '../../data/computed/members.json';
const played = seasons.filter((s) => !s.notStarted).sort((a, b) => b.season.localeCompare(a.season));
const upcoming = seasons.filter((s) => s.notStarted);
const name = (id) => members[id]?.name ?? id;
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
---
<Base title="12 Guys 1 Cup — League History">
  <h1>12 Guys 1 Cup</h1>
  <p class="muted">League history &amp; records · est. 2021 (as 14 Guys 1 Cup)</p>
  {upcoming.map((s) => <p class="badge">{s.season} season: not started yet</p>)}

  <h2>Champions Wall</h2>
  <div class="wall">
    {played.map((s) => (
      <div class="card">
        <div class="muted">{s.season} · {s.name}</div>
        <div>🏆 <strong class="gold"><MemberLink id={s.champion} /></strong></div>
        <div>📈 PF champ: <MemberLink id={s.pfChamp} /></div>
        <div>💩 Last: <span class="red"><MemberLink id={s.lastPlace} /></span></div>
        <div><a href={`${base}/season/${s.season}/`}>Season page →</a></div>
      </div>
    ))}
  </div>

  <h2>Headline Records</h2>
  <div class="wall">
    <div class="card">
      <div class="muted">Highest single week</div>
      <strong>{records.highestGame[0].points}</strong> — {name(records.highestGame[0].userId)}
      <span class="muted">({records.highestGame[0].season} wk {records.highestGame[0].week})</span>
    </div>
    <div class="card">
      <div class="muted">Biggest blowout</div>
      <strong>{records.biggestBlowout[0].margin.toFixed(2)}</strong> — {name(records.biggestBlowout[0].userId)}
      <span class="muted">({records.biggestBlowout[0].season} wk {records.biggestBlowout[0].week})</span>
    </div>
    <div class="card">
      <div class="muted">Longest win streak</div>
      <strong>{records.longestWinStreak[0].length}</strong> — {name(records.longestWinStreak[0].userId)}
    </div>
  </div>
  <p><a href={`${base}/records/`}>Full record book →</a></p>
</Base>
```

- [ ] **Step 5: Verify it builds and renders**

Run: `npm run build`
Expected: build succeeds, `dist/index.html` exists and contains "Champions Wall".
Then run: `npm run dev` and load `http://localhost:4321/12guys1cup/` in the browser (or check `dist/index.html` content) — champion names from real data appear.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: astro shell, theme, home page champions wall"
```

---

### Task 14: All-time standings page + table sorter

**Files:**
- Create: `src/pages/standings.astro`, `src/scripts/sort-tables.js`

- [ ] **Step 1: Create `src/scripts/sort-tables.js`**

```js
for (const th of document.querySelectorAll('table.sortable th')) {
  th.addEventListener('click', () => {
    const table = th.closest('table');
    const tbody = table.tBodies[0];
    const idx = [...th.parentNode.children].indexOf(th);
    const asc = th.dataset.asc !== 'true';
    for (const h of th.parentNode.children) delete h.dataset.asc;
    th.dataset.asc = asc;
    const rows = [...tbody.rows];
    rows.sort((a, b) => {
      const av = a.cells[idx].dataset.v ?? a.cells[idx].textContent.trim();
      const bv = b.cells[idx].dataset.v ?? b.cells[idx].textContent.trim();
      const an = parseFloat(av), bn = parseFloat(bv);
      const cmp = Number.isNaN(an) || Number.isNaN(bn)
        ? String(av).localeCompare(String(bv))
        : an - bn;
      return asc ? cmp : -cmp;
    });
    tbody.append(...rows);
  });
}
```

- [ ] **Step 2: Create `src/pages/standings.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import alltime from '../../data/computed/alltime.json';
import members from '../../data/computed/members.json';
import seasons from '../../data/computed/seasons.json';
const latest = seasons.filter((s) => !s.notStarted).map((s) => s.season).sort().at(-1);
const isFormer = (id) => !(members[id]?.seasons ?? []).some((s) => s >= latest);
const pct = (c) => {
  const g = c.wins + c.losses + c.ties;
  return g ? ((c.wins + c.ties / 2) / g).toFixed(3) : '—';
};
---
<Base title="All-Time Standings — 12 Guys 1 Cup">
  <h1>All-Time Standings</h1>
  <p class="muted">Regular season only. Playoff results tracked separately. Click headers to sort.</p>
  <div class="table-wrap">
    <table class="sortable">
      <thead><tr>
        <th>Member</th><th>Seasons</th><th>W</th><th>L</th><th>T</th><th>Win %</th>
        <th>PF</th><th>PA</th><th>Playoff W-L</th><th>🏆</th><th>PF Titles</th>
        <th>Playoffs</th><th>Last Places</th>
      </tr></thead>
      <tbody>
        {alltime.map((c) => (
          <tr>
            <td><MemberLink id={c.userId} />{isFormer(c.userId) && <span class="badge"> former</span>}</td>
            <td>{c.seasons}</td><td>{c.wins}</td><td>{c.losses}</td><td>{c.ties}</td>
            <td data-v={pct(c)}>{pct(c)}</td>
            <td data-v={c.pf}>{c.pf.toFixed(2)}</td>
            <td data-v={c.pa}>{c.pa.toFixed(2)}</td>
            <td data-v={c.playoffWins}>{c.playoffWins}-{c.playoffLosses}</td>
            <td>{c.championships || ''}</td><td>{c.pfTitles || ''}</td>
            <td>{c.playoffAppearances}</td><td class="red">{c.lastPlaces || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  <script src="../scripts/sort-tables.js"></script>
</Base>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success; `dist/standings/index.html` lists all members including departed ones flagged "former".

- [ ] **Step 4: Commit**

```bash
git add src/pages/standings.astro src/scripts/sort-tables.js
git commit -m "feat: all-time standings page with sortable table"
```

---

### Task 15: Head-to-head page

**Files:**
- Create: `src/pages/h2h.astro`

- [ ] **Step 1: Create `src/pages/h2h.astro`**

Grid shows all-time regular-season record (row vs column); playoff record in parentheses when they've met in playoffs. Cells link to per-pairing game lists below.

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import h2h from '../../data/computed/h2h.json';
import members from '../../data/computed/members.json';
const ids = Object.keys(members);
const name = (id) => members[id]?.name ?? id;
const cell = (r, c) => h2h[r < c ? `${r}|${c}` : `${c}|${r}`] ?? null;
// Record of `r` against `c` from r's perspective.
const rec = (r, c) => {
  const x = cell(r, c);
  if (!x) return null;
  const mine = x.a === r;
  const reg = mine ? [x.regular.aWins, x.regular.bWins] : [x.regular.bWins, x.regular.aWins];
  const po = mine ? [x.playoff.aWins, x.playoff.bWins] : [x.playoff.bWins, x.playoff.aWins];
  return { reg, po, hasPo: x.playoff.aWins + x.playoff.bWins > 0, key: x.a + x.b };
};
const pairings = Object.values(h2h);
---
<Base title="Head-to-Head — 12 Guys 1 Cup">
  <h1>Head-to-Head</h1>
  <p class="muted">All-time regular-season records, row vs column. Playoff meetings in parentheses. Click a cell for the game list.</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th></th>{ids.map((c) => <th>{name(c)}</th>)}</tr></thead>
      <tbody>
        {ids.map((r) => (
          <tr>
            <th><MemberLink id={r} /></th>
            {ids.map((c) => {
              if (r === c) return <td class="muted">—</td>;
              const x = rec(r, c);
              return x
                ? <td><a href={`#p-${x.key}`}>{x.reg[0]}-{x.reg[1]}{x.hasPo ? ` (${x.po[0]}-${x.po[1]})` : ''}</a></td>
                : <td class="muted">·</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  <h2>All Matchups</h2>
  {pairings.map((p) => (
    <details id={`p-${p.a}${p.b}`} class="card" style="margin-bottom:0.5rem">
      <summary>
        {name(p.a)} vs {name(p.b)} — {p.regular.aWins}-{p.regular.bWins}
        {p.playoff.aWins + p.playoff.bWins > 0 ? ` (playoffs ${p.playoff.aWins}-${p.playoff.bWins})` : ''}
      </summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Season</th><th>Week</th><th>Type</th><th>{name(p.a)}</th><th>{name(p.b)}</th></tr></thead>
        <tbody>
          {p.games.map((g) => {
            const [pa, pb] = g.a.userId === p.a ? [g.a.points, g.b.points] : [g.b.points, g.a.points];
            return <tr><td>{g.season}</td><td>{g.week}</td><td>{g.type}</td>
              <td class={pa > pb ? 'gold' : ''}>{pa}</td><td class={pb > pa ? 'gold' : ''}>{pb}</td></tr>;
          })}
        </tbody>
      </table></div>
    </details>
  ))}
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; `dist/h2h/index.html` contains the grid.

- [ ] **Step 3: Commit**

```bash
git add src/pages/h2h.astro
git commit -m "feat: head-to-head grid with game lists"
```

---

### Task 16: Record book page

**Files:**
- Create: `src/pages/records.astro`

- [ ] **Step 1: Create `src/pages/records.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import records from '../../data/computed/records.json';

const gameCols = ['Points', 'Member', 'Opponent', 'When'];
const sections = [
  ['Highest single-week score', records.highestGame, 'points'],
  ['Lowest single-week score', records.lowestGame, 'points'],
  ['Biggest blowout (margin)', records.biggestBlowout, 'margin'],
  ['Closest game (margin)', records.closestGame, 'margin'],
  ['Most points in a loss', records.mostPointsInLoss, 'points'],
  ['Fewest points in a win', records.fewestPointsInWin, 'points'],
  ['Playoff: highest single-week score', records.playoffHighestGame, 'points'],
];
---
<Base title="Record Book — 12 Guys 1 Cup">
  <h1>Record Book</h1>
  <p class="muted">Regular season unless marked playoff. Top 5 each.</p>

  {sections.map(([title, rows, field]) => (
    <section>
      <h2>{title}</h2>
      <div class="table-wrap"><table>
        <thead><tr>{gameCols.map((c) => <th>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td><strong>{r[field].toFixed(2)}</strong>{field === 'margin' ? ` (${r.points}–${r.oppPoints})` : ''}</td>
              <td><MemberLink id={r.userId} /></td>
              <td><MemberLink id={r.oppUserId} /></td>
              <td class="muted">{r.season} wk {r.week}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  ))}

  <h2>Longest win streak</h2>
  <div class="table-wrap"><table><tbody>
    {records.longestWinStreak.map((r) => <tr><td><strong>{r.length}</strong></td><td><MemberLink id={r.userId} /></td></tr>)}
  </tbody></table></div>

  <h2>Longest losing streak</h2>
  <div class="table-wrap"><table><tbody>
    {records.longestLossStreak.map((r) => <tr><td><strong>{r.length}</strong></td><td><MemberLink id={r.userId} /></td></tr>)}
  </tbody></table></div>

  <h2>Best season records</h2>
  <div class="table-wrap"><table><tbody>
    {records.bestSeasons.map((r) => <tr><td><strong>{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</strong></td>
      <td><MemberLink id={r.userId} /></td><td class="muted">{r.season}</td><td>{r.pf.toFixed(2)} PF</td></tr>)}
  </tbody></table></div>

  <h2>Worst season records</h2>
  <div class="table-wrap"><table><tbody>
    {records.worstSeasons.map((r) => <tr><td><strong>{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</strong></td>
      <td><MemberLink id={r.userId} /></td><td class="muted">{r.season}</td><td>{r.pf.toFixed(2)} PF</td></tr>)}
  </tbody></table></div>

  <h2>Highest season points-for</h2>
  <div class="table-wrap"><table><tbody>
    {records.highestSeasonPf.map((r) => <tr><td><strong>{r.pf.toFixed(2)}</strong></td>
      <td><MemberLink id={r.userId} /></td><td class="muted">{r.season}</td></tr>)}
  </tbody></table></div>
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; `dist/records/index.html` shows all sections with real values.

- [ ] **Step 3: Commit**

```bash
git add src/pages/records.astro
git commit -m "feat: record book page"
```

---

### Task 17: Season pages with draft boards

**Files:**
- Create: `src/pages/season/[year].astro`

- [ ] **Step 1: Create `src/pages/season/[year].astro`**

```astro
---
import Base from '../../layouts/Base.astro';
import MemberLink from '../../components/MemberLink.astro';
import seasons from '../../../data/computed/seasons.json';
import members from '../../../data/computed/members.json';

export function getStaticPaths() {
  return seasons.map((s) => ({ params: { year: s.season }, props: { s } }));
}
const { s } = Astro.props;
const name = (id) => members[id]?.name ?? id;
const weeks = s.notStarted ? [] : [...new Set(s.games.map((g) => g.week))].sort((a, b) => a - b);
const rounds = s.notStarted ? [] : [...new Set(s.draft.map((p) => p.round))].sort((a, b) => a - b);
---
<Base title={`${s.season} Season — 12 Guys 1 Cup`}>
  <h1>{s.season} — {s.name}</h1>
  {s.notStarted ? (
    <p class="badge">This season hasn't started yet.</p>
  ) : (
    <>
      <p>
        🏆 <strong class="gold"><MemberLink id={s.champion} /></strong>
        &nbsp;· 📈 PF champ: <MemberLink id={s.pfChamp} />
        &nbsp;· 💩 Last place: <span class="red"><MemberLink id={s.lastPlace} /></span>
      </p>

      <h2>Final Standings</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Team</th><th>Member</th><th>W</th><th>L</th><th>T</th>
          <th>PF</th><th>PA</th><th>Playoff W-L</th></tr></thead>
        <tbody>
          {s.standings.map((t) => (
            <tr>
              <td>{t.place}</td><td>{t.teamName}</td><td><MemberLink id={t.userId} /></td>
              <td>{t.wins}</td><td>{t.losses}</td><td>{t.ties}</td>
              <td>{t.pf.toFixed(2)}</td><td>{t.pa.toFixed(2)}</td>
              <td>{t.playoffWins + t.playoffLosses > 0 ? `${t.playoffWins}-${t.playoffLosses}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <h2>Weekly Results</h2>
      {weeks.map((w) => (
        <details class="card" style="margin-bottom:0.5rem">
          <summary>Week {w}{s.games.some((g) => g.week === w && g.type === 'playoff') ? ' · playoffs' : ''}</summary>
          <div class="table-wrap"><table><tbody>
            {s.games.filter((g) => g.week === w).map((g) => (
              <tr>
                <td class={g.a.points > g.b.points ? 'gold' : ''}>{name(g.a.userId)} {g.a.points}</td>
                <td class={g.b.points > g.a.points ? 'gold' : ''}>{name(g.b.userId)} {g.b.points}</td>
                <td class="muted">{g.type}</td>
              </tr>
            ))}
          </tbody></table></div>
        </details>
      ))}

      <h2>Draft Board</h2>
      {rounds.map((r) => (
        <details class="card" style="margin-bottom:0.5rem" open={r === 1}>
          <summary>Round {r}</summary>
          <div class="table-wrap"><table><tbody>
            {s.draft.filter((p) => p.round === r).map((p) => (
              <tr><td class="muted">{p.pickNo}</td><td>{p.player} <span class="badge">{p.position}</span></td>
                <td><MemberLink id={p.userId} /></td></tr>
            ))}
          </tbody></table></div>
        </details>
      ))}
    </>
  )}
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; `dist/season/2021/index.html` … `dist/season/2026/index.html` exist; 2026 shows "hasn't started"; 2025 shows standings, weeks, and a full draft board.

- [ ] **Step 3: Commit**

```bash
git add src/pages/season
git commit -m "feat: per-season pages with standings, weekly results, draft board"
```

---

### Task 18: Trades page

**Files:**
- Create: `src/pages/trades.astro`

- [ ] **Step 1: Create `src/pages/trades.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import trades from '../../data/computed/trades.json';
const bySeason = {};
for (const t of trades) (bySeason[t.season] ??= []).push(t);
const seasonKeys = Object.keys(bySeason).sort((a, b) => b.localeCompare(a));
---
<Base title="Trade History — 12 Guys 1 Cup">
  <h1>Trade History</h1>
  <p class="muted">{trades.length} completed trades all-time.</p>
  {seasonKeys.map((season) => (
    <section>
      <h2>{season} <span class="badge">{bySeason[season].length} trades</span></h2>
      {bySeason[season].map((t) => (
        <div class="card" style="margin-bottom:0.5rem">
          <div class="muted">Week {t.week}</div>
          {t.parties.map((userId) => (
            <div>
              <MemberLink id={userId} /> received:
              {[...t.assets[userId].players, ...t.assets[userId].picks].join(', ') || 'nothing'}
            </div>
          ))}
        </div>
      ))}
    </section>
  ))}
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; `dist/trades/index.html` groups real trades by season with player names.

- [ ] **Step 3: Commit**

```bash
git add src/pages/trades.astro
git commit -m "feat: trade history page"
```

---

### Task 19: Punishments page

**Files:**
- Create: `src/pages/punishments.astro`

- [ ] **Step 1: Create `src/pages/punishments.astro`**

Entries come from hand-edited `data/punishments.json` (`[{ "season": "2024", "title": "...", "description": "...", "media": ["https://…"] }]`). The victim is derived from that season's computed last place.

```astro
---
import Base from '../layouts/Base.astro';
import MemberLink from '../components/MemberLink.astro';
import punishments from '../../data/punishments.json';
import seasons from '../../data/computed/seasons.json';
const played = seasons.filter((s) => !s.notStarted).sort((a, b) => b.season.localeCompare(a.season));
const entry = (season) => punishments.find((p) => p.season === season);
---
<Base title="Punishments — 12 Guys 1 Cup">
  <h1>Punishments</h1>
  <p class="muted">What last place costs you in this league.</p>
  {played.map((s) => {
    const p = entry(s.season);
    return (
      <div class="card" style="margin-bottom:0.75rem">
        <h2 style="margin-top:0">{s.season}</h2>
        <div>💩 Victim: <span class="red"><MemberLink id={s.lastPlace} /></span></div>
        {p ? (
          <>
            <div><strong>{p.title}</strong></div>
            <p>{p.description}</p>
            {(p.media ?? []).map((url) => <div><a href={url}>Evidence →</a></div>)}
          </>
        ) : (
          <p class="muted">No punishment recorded yet — commissioner, edit <code>data/punishments.json</code>.</p>
        )}
      </div>
    );
  })}
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; `dist/punishments/index.html` lists each played season with its last-place victim and the "no punishment recorded" note.

- [ ] **Step 3: Commit**

```bash
git add src/pages/punishments.astro
git commit -m "feat: punishments page driven by hand-edited data"
```

---

### Task 20: Member pages

**Files:**
- Create: `src/pages/member/[id].astro`

- [ ] **Step 1: Create `src/pages/member/[id].astro`**

```astro
---
import Base from '../../layouts/Base.astro';
import members from '../../../data/computed/members.json';
import alltime from '../../../data/computed/alltime.json';
import seasons from '../../../data/computed/seasons.json';
import trades from '../../../data/computed/trades.json';

export function getStaticPaths() {
  return Object.keys(members).map((id) => ({ params: { id } }));
}
const { id } = Astro.params;
const m = members[id];
const career = alltime.find((c) => c.userId === id);
const name = (uid) => members[uid]?.name ?? uid;
const myTrades = trades.filter((t) => t.parties.includes(id));
const rows = seasons
  .filter((s) => !s.notStarted && s.standings.some((t) => t.userId === id))
  .map((s) => ({ s, t: s.standings.find((t) => t.userId === id) }))
  .sort((a, b) => b.s.season.localeCompare(a.s.season));
const honors = rows.flatMap(({ s }) => [
  s.champion === id && `🏆 ${s.season} Champion`,
  s.pfChamp === id && `📈 ${s.season} PF Champ`,
  s.lastPlace === id && `💩 ${s.season} Last Place`,
]).filter(Boolean);
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
---
<Base title={`${m.name} — 12 Guys 1 Cup`}>
  <h1>
    {m.avatar && <img src={`https://sleepercdn.com/avatars/thumbs/${m.avatar}`} alt="" width="36" height="36" style="border-radius:50%;vertical-align:middle" />}
    {m.name}
  </h1>
  {career && (
    <p>
      Career: <strong>{career.wins}-{career.losses}{career.ties ? `-${career.ties}` : ''}</strong>
      &nbsp;· {career.pf.toFixed(2)} PF · playoffs {career.playoffWins}-{career.playoffLosses}
      &nbsp;· {career.seasons} seasons
    </p>
  )}
  {honors.length > 0 && <p>{honors.map((h) => <span class="badge" style="margin-right:0.3rem">{h}</span>)}</p>}

  <h2>Season by Season</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Season</th><th>Team Name</th><th>Finish</th><th>W</th><th>L</th><th>PF</th><th>PA</th></tr></thead>
    <tbody>
      {rows.map(({ s, t }) => (
        <tr>
          <td><a href={`${base}/season/${s.season}/`}>{s.season}</a></td>
          <td>{t.teamName}</td>
          <td>{t.place}{s.champion === id ? ' 🏆' : s.lastPlace === id ? ' 💩' : ''}</td>
          <td>{t.wins}</td><td>{t.losses}</td>
          <td>{t.pf.toFixed(2)}</td><td>{t.pa.toFixed(2)}</td>
        </tr>
      ))}
    </tbody>
  </table></div>

  <h2>Trades ({myTrades.length})</h2>
  {myTrades.map((t) => (
    <div class="card" style="margin-bottom:0.5rem">
      <div class="muted">{t.season} · week {t.week} · with {t.parties.filter((p) => p !== id).map(name).join(', ')}</div>
      <div>Received: {[...t.assets[id].players, ...t.assets[id].picks].join(', ') || 'nothing'}</div>
    </div>
  ))}
</Base>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success; one page per member under `dist/member/<user_id>/index.html`, including departed members.

- [ ] **Step 3: Commit**

```bash
git add src/pages/member
git commit -m "feat: member profile pages"
```

---

### Task 21: CI/CD, README, publish

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/workflows/refresh-data.yml`, `README.md`

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy site
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create `.github/workflows/refresh-data.yml`**

```yaml
name: Refresh data
on:
  workflow_dispatch:
  schedule:
    - cron: '0 12 * * 2'   # Tuesdays 12:00 UTC; no-ops when nothing changed
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run fetch
      - run: npm run compute
      - run: npm test
      - name: Commit refreshed data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data
          git diff --cached --quiet || { git commit -m "data: weekly sleeper refresh"; git push; }
```

- [ ] **Step 3: Create `README.md`**

```markdown
# 12 Guys 1 Cup — League History

Static site for the 12 Guys 1 Cup Sleeper league: champions, all-time standings,
head-to-head, record book, season pages, drafts, trades, punishments.

Live: https://henryphamphp.github.io/12guys1cup/

## How it works

1. `npm run fetch` — snapshots the Sleeper API into `data/raw/` (all seasons).
2. `npm run compute` — computes stats into `data/computed/`.
3. `npm run build` — Astro renders the static site from the computed JSON.

Data refreshes automatically every Tuesday via GitHub Actions (`Refresh data`
workflow), or on demand from the Actions tab. Every push to `main` redeploys.

## Commissioner notes

- **Punishments:** edit `data/punishments.json`:
  `[{ "season": "2024", "title": "Waffle House 24hrs", "description": "…", "media": ["https://…"] }]`
- **Identity overrides:** if an account ever changes hands, add to
  `data/overrides.json`: `{ "2024": { "<roster_id or user_id>": "<real user_id>" } }`
  then rerun `npm run compute`. This keeps each real person's records separate.

## Dev

npm run dev — local dev server · npm test — unit + real-data validation
```

- [ ] **Step 4: Full verification**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add .github README.md
git commit -m "ci: pages deploy + weekly data refresh workflows, readme"
```

- [ ] **Step 6: Publish (requires user go-ahead)**

Creating the public GitHub repo and enabling Pages is outward-facing — confirm with the user first, then:

```bash
gh repo create 12guys1cup --public --source . --push
gh api -X POST repos/henryphamphp/12guys1cup/pages -f build_type=workflow
```

Expected: repo exists, `Deploy site` action runs, site live at `https://henryphamphp.github.io/12guys1cup/`. If `gh` is not authenticated, ask the user to run `gh auth login` or create the repo manually and push.

---

## Self-review notes

- Spec coverage: every page in the spec's site map has a task (13–20); no-double-counting → Task 5; regular/playoff separation → Tasks 7–10 tests; three honors incl. per-season PF champ → Task 7; punishments → Task 19; snapshots → Tasks 3–4; overrides → Task 5; error handling (retry, hard-fail, unknown-user validation) → Tasks 2, 3, 12; real-data spot check → Task 12; deploy + weekly refresh → Task 21.
- Known simplification: playoff rounds are assumed one week per round (`playoff_round_type` 0, matches this league). If a cross-validation or bracket lookup fails for an old season, check that season's `playoff_round_type` before anything else.
- 2021–2022 had 14 teams; nothing in the code assumes 12.
```
