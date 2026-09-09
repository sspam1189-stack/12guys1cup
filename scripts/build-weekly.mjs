/**
 * Weekly projected points per roster, for the current-week matchup cards.
 *
 * Same composition rule as the season pipeline: a posted market wins, and any
 * stat no book prices falls back to the week's projection. Both sides are stat
 * lines scored at identical rates, so mixing them is unit-safe.
 *
 * What differs weekly:
 *   - touchdowns have no O/U, only a one-sided anytime price, so they always
 *     come from the projection (see fetch-weekly-props.mjs)
 *   - interceptions DO have a weekly market, unlike the season, so a
 *     quarterback's biggest negative is market-priced here
 *   - spreads are far wider relative to the mean than season totals, so the
 *     de-vig uses weekly dispersion rather than season dispersion
 *
 *   node scripts/build-weekly.mjs             current week
 *   node scripts/build-weekly.mjs --week 3
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };

const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
const season = Number(arg('--season') ?? state.season);
const week = Number(arg('--week') ?? state.week);

/* ---- league scoring ---- */
const league = JSON.parse(readFileSync(resolve(REPO, `data/raw/${season}/league.json`), 'utf8'));
// Every scoring key the league defines, used as-is. Taking the whole map rather
// than a hand-picked list means kickers and defenses score off their real
// settings (field-goal distance buckets, points-allowed tiers) instead of
// needing a second code path, and any scoring change the commissioner makes
// flows through without editing this file.
const RATE = Object.fromEntries(
  Object.entries(league.scoring_settings ?? {}).filter(([, v]) => typeof v === 'number'),
);

/* ---- weekly projections (snapshot alongside the season file) ---- */
const projPath = resolve(REPO, `data/raw/projections/${season}-week-${week}.json`);
let projRows;
{
  const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`
    + ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `&position[]=${p}`).join('');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    projRows = await res.json();
    mkdirSync(dirname(projPath), { recursive: true });
    writeFileSync(projPath, JSON.stringify(projRows));
  } catch (err) {
    if (!existsSync(projPath)) throw new Error(`weekly projections unavailable: ${err.message ?? err}`);
    console.error(`weekly projections fetch failed (${err.message ?? err}) — using the last snapshot`);
    projRows = JSON.parse(readFileSync(projPath, 'utf8'));
  }
}
projRows = Array.isArray(projRows) ? projRows : Object.values(projRows);

/* ---- weekly market lines ---- */
const propPath = resolve(REPO, `data/raw/vegas/${season}/week-${week}-props.json`);
const props = existsSync(propPath) ? JSON.parse(readFileSync(propPath, 'utf8')) : { players: {} };
if (!existsSync(propPath)) {
  console.error(`no weekly props for week ${week} — projections only (run fetch-weekly-props.mjs)`);
}

// Weekly O/U -> the scoring key its line feeds.
const MARKET_STAT = {
  passing_yards: 'pass_yd', passing_tds: 'pass_td', interceptions: 'pass_int',
  rushing_yards: 'rush_yd', receiving_yards: 'rec_yd', receptions: 'rec',
};
// A single game is a small sample, so the spread around a weekly line is a much
// larger share of the mean than a season total's. These are only used to locate
// the median when a book prices one side hard; balanced juice is unaffected.
const WEEK_SPREAD = {
  pass_yd: 0.28, rec_yd: 0.62, rush_yd: 0.58, rec: 0.45,
};
const POISSON = new Set(['pass_td', 'pass_int']);
const impliedP = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

// Normal-tail inverse, Acklam's rational approximation. Good to ~1e-9, which is
// far tighter than the odds themselves.
function probit(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

// The posted number is the median only when the juice is balanced. When it is
// not, the two-way prices say where the real median sits.
function devig(stat, line, over, under) {
  if (line == null) return null;
  if (over == null || under == null) return line;
  const po = impliedP(over), pu = impliedP(under);
  const p = po / (po + pu);                    // true P(over)
  if (Math.abs(p - 0.5) < 0.02) return line;   // balanced: the line is the median
  if (POISSON.has(stat)) {
    // Match a Poisson mean to P(X > line) for a half-point line.
    let lo = 0.01, hi = Math.max(4, line * 4);
    const tail = (lam) => {
      const k = Math.floor(line);
      let cum = 0, term = Math.exp(-lam);
      for (let i = 0; i <= k; i++) { cum += term; term *= lam / (i + 1); }
      return 1 - cum;
    };
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tail(mid) < p) lo = mid; else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 100) / 100;
  }
  const sd = (WEEK_SPREAD[stat] ?? 0.5) * Math.max(line, 1);
  return Math.round((line + probit(1 - p) * sd) * 100) / 100;
}

const norm = (s) => s.toLowerCase().replace(/[.'`\-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/g, '').trim();
const live = (b) => b && b.line != null && !b.off;

/* market stat lines, keyed by normalized name */
const mkt = {};
for (const e of Object.values(props.players ?? {})) {
  const out = {};
  for (const [market, stat] of Object.entries(MARKET_STAT)) {
    const m = e.markets?.[market];
    // A market nobody is quoting any more is not a market; fall through to the
    // projection rather than ride a number no book stands behind.
    if (!m || m.line == null || !Object.values(m.books ?? {}).some(live)) continue;
    const v = devig(stat, m.line, m.over, m.under);
    if (v != null) out[stat] = v;
  }
  // A lump rush+rec number fills whichever split is missing.
  const combo = e.markets?.rushing_receiving_yards;
  if (combo?.line != null && Object.values(combo.books ?? {}).some(live)) {
    const total = devig('rush_yd', combo.line, combo.over, combo.under) ?? combo.line;
    const has = ['rush_yd', 'rec_yd'].filter((k) => out[k] != null);
    if (has.length === 1) {
      const rest = total - out[has[0]];
      if (rest > 0) out[has[0] === 'rush_yd' ? 'rec_yd' : 'rush_yd'] = Math.round(rest * 100) / 100;
    }
  }
  if (Object.keys(out).length) {
    mkt[norm(e.name)] = { line: out, atd: e.markets?.anytime_td?.p_anytime_with_vig ?? null };
  }
}

/* projection stat lines, keyed by sleeper id and by name. These rows are also
   the id -> name source: data/raw/players.json is only the traded-player map,
   not a full dictionary, and every rostered player appears here. */
const projById = {}, projByName = {};
for (const row of projRows) {
  const p = row.player;
  if (!p) continue;
  const line = {};
  for (const k of Object.keys(RATE)) if (row.stats?.[k] != null) line[k] = row.stats[k];
  const name = (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim();
  const rec = {
    line, name: name || null,
    team: p.team ?? row.team ?? null,
    pos: p.position ?? null,
    opp: row.opponent ?? null,
  };
  if (row.player_id) projById[String(row.player_id)] = rec;
  if (name) projByName[norm(name)] = rec;
}

const score = (line) => {
  let pts = 0;
  for (const [k, v] of Object.entries(line)) pts += v * (RATE[k] ?? 0);
  return Math.round(pts * 100) / 100;
};

/* compose a player's week: market first, projection for the rest */
function weekFor(sleeperId, fallbackName) {
  const pr = projById[String(sleeperId)]
    ?? (fallbackName ? projByName[norm(fallbackName)] : null);
  const name = pr?.name ?? fallbackName ?? null;
  const mk = name ? mkt[norm(name)] : null;
  if (!pr && !mk) return null;
  const line = { ...(pr?.line ?? {}) };
  let priced = 0, total = 0;
  for (const [k, v] of Object.entries(mk?.line ?? {})) line[k] = v;
  for (const [k, v] of Object.entries(line)) {
    const w = Math.abs(v * (RATE[k] ?? 0));
    total += w;
    if (mk?.line?.[k] != null) priced += w;
  }
  return {
    pts: score(line),
    mkt: total > 0 ? Math.round((priced / total) * 100) / 100 : 0,
    atd: mk?.atd ?? null,
    name,
    team: pr?.team ?? null,
    pos: pr?.pos ?? null,
    opp: pr?.opp ?? null,
  };
}

/* ---- roster lineups for the week ---- */
const matchups = JSON.parse(readFileSync(resolve(REPO, `data/raw/${season}/matchups.json`), 'utf8'));
const rosters = JSON.parse(readFileSync(resolve(REPO, `data/raw/${season}/rosters.json`), 'utf8'));
const ownerOf = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id]));

const entries = matchups[week] ?? matchups[String(week)] ?? [];
const byRoster = {};
for (const e of entries) {
  const lineup = [];
  for (const id of e.starters ?? []) {
    if (!id || id === '0') continue;
    const w = weekFor(id, null);
    lineup.push({
      id, name: w?.name ?? id,
      pos: w?.pos ?? null,
      team: w?.team ?? null,
      opp: w?.opp ?? null,
      proj: w?.pts ?? 0,
      mkt: w?.mkt ?? 0,
      atd: w?.atd ?? null,
    });
  }
  byRoster[e.roster_id] = {
    rosterId: e.roster_id,
    userId: ownerOf[e.roster_id] ?? null,
    matchupId: e.matchup_id ?? null,
    proj: Math.round(lineup.reduce((a, b) => a + b.proj, 0) * 100) / 100,
    lineup,
  };
}

/* pair into matchups */
const pairs = new Map();
for (const r of Object.values(byRoster)) {
  if (r.matchupId == null) continue;
  if (!pairs.has(r.matchupId)) pairs.set(r.matchupId, []);
  pairs.get(r.matchupId).push(r);
}
const games = [...pairs.values()]
  .filter((l) => l.length === 2)
  .map(([a, b]) => ({ matchupId: a.matchupId, a, b }));

const out = {
  season, week,
  builtAt: new Date().toISOString(),
  marketPlayers: Object.keys(mkt).length,
  games,
};
mkdirSync(resolve(REPO, 'data/computed'), { recursive: true });
writeFileSync(resolve(REPO, 'data/computed/week.json'), JSON.stringify(out, null, 1));

console.log(`week ${week}: ${games.length} matchups, ${Object.keys(mkt).length} market-priced players`);
for (const g of games) {
  const edge = (g.a.proj - g.b.proj).toFixed(1);
  console.log(`  ${String(g.a.proj).padStart(7)}  vs ${String(g.b.proj).padStart(7)}   (${edge > 0 ? '+' : ''}${edge})`);
}
