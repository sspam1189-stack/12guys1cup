/**
 * In-season power rankings.
 *
 * A record is a bad description of a team in September: six of twelve rosters
 * are 1-0, and one of them won by 40 while starting its worst possible lineup.
 * So the ranking blends three things a record hides:
 *
 *   form      points per game -- what the team has actually produced
 *   ceiling   max PF per game -- what its roster produced regardless of who
 *             was started, which strips out lineup luck
 *   roster    the season projection of its current starters, priced off Vegas
 *             where a market exists -- what it still has in hand
 *
 * Early on almost nothing has been played, so the roster term carries the
 * ranking; as games accumulate the observed terms take over. The crossover is
 * deliberate rather than a constant: weight on results is games/(games+4), so
 * it is half observed by week 4 and three-quarters by week 12.
 *
 *   node scripts/build-power-rankings.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REPO = resolve(process.cwd());
const J = (p) => JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
const { deviggedLine } = await import(pathToFileURL(resolve(REPO, 'scripts/lib/implied.mjs')).href);

const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
const season = String(state.season);

const league = J(`data/raw/${season}/league.json`);
const rosters = J(`data/raw/${season}/rosters.json`);
const users = J(`data/raw/${season}/users.json`);
const seasons = J('data/computed/seasons.json');
const summary = (Array.isArray(seasons) ? seasons : Object.values(seasons)).find((s) => s.season === season);
if (!summary || summary.notStarted) {
  console.error(`no played games for ${season} yet — nothing to rank`);
  process.exit(0);
}

/* ---- roster strength, from the season-long market ---- */
const props = J(`data/raw/vegas/${season}/player-season-props.json`);
const proj = J(`data/raw/projections/${season}.json`);
const RATE = { py: 0.04, pt: 4, ry: 0.1, rt: 6, rey: 0.1, ret: 6, rec: 0.5, int: -2, fum: -1, p2: 2, r2: 2, c2: 2 };
const KEY = { passing_yards: 'py', passing_tds: 'pt', rushing_yards: 'ry', rushing_tds: 'rt', receiving_yards: 'rey', receiving_tds: 'ret', receptions: 'rec' };
const COMBO = { rushing_receiving_yards: ['ry', 'rey'], rushing_receiving_tds: ['rt', 'ret'] };
const STAT = { pass_yd: 'py', pass_td: 'pt', rush_yd: 'ry', rush_td: 'rt', rec_yd: 'rey', rec_td: 'ret', rec: 'rec', pass_int: 'int', fum_lost: 'fum', pass_2pt: 'p2', rush_2pt: 'r2', rec_2pt: 'c2' };
const norm = (s) => s.toLowerCase().replace(/[.'`\-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/g, '').trim();
const liveMkt = (m) => m?.line != null && Object.values(m.books ?? {}).some((b) => b && b.line != null && !b.off);

const veg = {};
for (const e of Object.values(props.players)) {
  const L = {};
  for (const [m, k] of Object.entries(KEY)) {
    const mk = e.markets?.[m];
    if (!liveMkt(mk)) continue;
    L[k] = deviggedLine(m, mk) ?? mk.line;
  }
  for (const [m, parts] of Object.entries(COMBO)) {
    const mk = e.markets?.[m];
    if (!liveMkt(mk)) continue;
    const line = deviggedLine(m, mk) ?? mk.line;
    const have = parts.filter((p) => L[p] != null);
    if (have.length === 1) {
      const rest = line - L[have[0]];
      if (rest > 0) L[parts.find((p) => L[p] == null)] = rest;
    }
  }
  if (Object.keys(L).length) veg[norm(e.name)] = L;
}
const info = {};
for (const row of proj) {
  const p = row.player;
  if (!p) continue;
  const n = norm(`${p.first_name ?? ''} ${p.last_name ?? ''}`);
  if (!n) continue;
  const L = {};
  for (const [k, short] of Object.entries(STAT)) if (row.stats?.[k] != null) L[short] = row.stats[k];
  info[String(row.player_id)] = { n, pos: p.position, line: L, status: p.injury_status ?? p.status ?? null };
}
const ptsOf = (id) => {
  const rec = info[id];
  if (!rec) return null;
  const v = veg[rec.n] ?? {};
  let t = 0;
  for (const k of Object.keys(RATE)) {
    const x = v[k] ?? rec.line[k];
    if (x != null) t += x * RATE[k];
  }
  return { pts: t, pos: rec.pos, status: rec.status };
};

const NEED = { QB: 1, RB: 2, WR: 3, TE: 1 };
const BASE = { QB: 282, RB: 149.2, WR: 137.4, TE: 112.7 };
const rosterStrength = (ids) => {
  const pool = (ids ?? []).map(ptsOf).filter(Boolean)
    .filter((p) => BASE[p.pos] != null && !['Out', 'IR', 'PUP'].includes(p.status ?? ''))
    .sort((a, b) => b.pts - a.pts);
  const used = new Set();
  let total = 0;
  for (const [pos, k] of Object.entries(NEED)) {
    let c = 0;
    for (const p of pool) { if (used.has(p) || p.pos !== pos || c >= k) continue; used.add(p); total += p.pts; c++; }
  }
  const flex = pool.find((p) => !used.has(p) && ['RB', 'WR', 'TE'].includes(p.pos));
  if (flex) total += flex.pts;
  return total;
};

/* ---- assemble ---- */
const nm = Object.fromEntries(users.map((u) => [u.user_id, u.display_name]));
const standing = Object.fromEntries(summary.standings.map((t) => [t.userId, t]));
const rows = [];
for (const r of rosters) {
  const t = standing[r.owner_id];
  if (!t) continue;
  const games = t.wins + t.losses + t.ties;
  rows.push({
    userId: r.owner_id,
    manager: nm[r.owner_id] ?? String(r.roster_id),
    teamName: t.teamName,
    wins: t.wins, losses: t.losses, ties: t.ties, games,
    pf: t.pf, pa: t.pa, maxPf: t.maxPf,
    ppg: games ? t.pf / games : 0,
    maxPpg: games ? t.maxPf / games : 0,
    eff: t.maxPf ? (t.pf / t.maxPf) * 100 : null,
    roster: rosterStrength(r.players),
  });
}

const z = (vals) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
  return (x) => (x - m) / sd;
};
const zForm = z(rows.map((r) => r.ppg));
const zCeil = z(rows.map((r) => r.maxPpg));
const zRost = z(rows.map((r) => r.roster));

const games = Math.max(...rows.map((r) => r.games));
const wResults = games / (games + 4);
for (const r of rows) {
  // Ceiling outweighs form: the same roster that scored 116 while benching 58
  // points is the better description of the team than the 116 is.
  const observed = 0.4 * zForm(r.ppg) + 0.6 * zCeil(r.maxPpg);
  r.score = wResults * observed + (1 - wResults) * zRost(r.roster);
  r.parts = {
    form: +zForm(r.ppg).toFixed(2),
    ceiling: +zCeil(r.maxPpg).toFixed(2),
    roster: +zRost(r.roster).toFixed(2),
  };
}
rows.sort((a, b) => b.score - a.score);
rows.forEach((r, i) => { r.rank = i + 1; });

/* movement against the previous published ranking */
let prev = {};
try { prev = Object.fromEntries((J('data/computed/rankings.json').teams ?? []).map((t) => [t.userId, t.rank])); } catch { /* first run */ }
for (const r of rows) r.move = prev[r.userId] != null ? prev[r.userId] - r.rank : null;

const out = {
  season,
  week: summary.currentWeek ?? null,
  throughWeek: games,
  builtAt: new Date().toISOString(),
  weight: { results: +wResults.toFixed(2), roster: +(1 - wResults).toFixed(2) },
  teams: rows.map((r) => ({
    rank: r.rank, move: r.move, userId: r.userId, manager: r.manager, teamName: r.teamName,
    wins: r.wins, losses: r.losses, ties: r.ties,
    pf: +r.pf.toFixed(2), pa: +r.pa.toFixed(2), maxPf: +r.maxPf.toFixed(2),
    ppg: +r.ppg.toFixed(1), maxPpg: +r.maxPpg.toFixed(1),
    eff: r.eff == null ? null : +r.eff.toFixed(1),
    roster: +r.roster.toFixed(1),
    score: +r.score.toFixed(3),
    parts: r.parts,
  })),
};
writeFileSync(resolve(REPO, 'data/computed/rankings.json'), JSON.stringify(out, null, 1));

console.log(`${season} power rankings through week ${games} `
  + `(results ${(wResults * 100).toFixed(0)}% / roster ${((1 - wResults) * 100).toFixed(0)}%)\n`);
console.log(' #  move  manager         rec    ppg   maxPpg   eff    roster   score');
for (const r of out.teams) {
  const mv = r.move == null ? '  -' : r.move > 0 ? `+${r.move}` : r.move < 0 ? `${r.move}` : ' =';
  console.log(
    String(r.rank).padStart(2) + '  ' + mv.padStart(4) + '  ' + r.manager.padEnd(15)
    + `${r.wins}-${r.losses}`.padEnd(6) + String(r.ppg).padStart(6) + String(r.maxPpg).padStart(8)
    + (r.eff == null ? '    -' : String(r.eff) + '%').padStart(8) + String(r.roster).padStart(9)
    + String(r.score).padStart(8),
  );
}
