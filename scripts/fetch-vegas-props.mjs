// Snapshots Vegas season-long player props into data/raw/vegas/<season>/.
//
// Sportsbook sites (DraftKings, FanDuel) sit behind bot protection, so this
// reads Action Network instead — an aggregator whose web app is served by an
// open JSON API and carries the books' own lines. The category list is
// scraped from the futures page's embedded __NEXT_DATA__, then each category
// is pulled from api.actionnetwork.com. Undocumented and unversioned: if the
// shape moves, this script says so loudly rather than writing empty files.
//
// Two kinds of output:
//   <slug>.json               one raw API response per market (all books)
//   player-season-props.json  normalized per-player over/under lines — the
//                             O/U line on a season total is, in effect,
//                             Vegas's median projection for that stat.
import { mkdir, writeFile } from 'node:fs/promises';

const PAGE = 'https://www.actionnetwork.com/nfl/futures';
const API = 'https://api.actionnetwork.com/web/v1/leagues/1/futures/';
const RAW = new URL('../data/raw/', import.meta.url);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Action Network lists every state-level skin separately (DK NJ, DK PA, …)
// with identical lines. One representative per brand is plenty.
const BRANDS = {
  15: 'consensus',
  68: 'draftkings',
  69: 'fanduel',
  75: 'betmgm',
  123: 'caesars',
  71: 'betrivers',
};

async function fetchJson(url, { retries = 3, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
    }
  }
}

// --- discover categories from the futures page ---
const html = await (await fetch(PAGE, { headers: { 'user-agent': UA } })).text();
const next = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
if (!next) {
  console.error('futures page no longer embeds __NEXT_DATA__ — scraper needs updating');
  process.exit(1);
}
const categories = JSON.parse(next[1]).props?.pageProps?.futureCategories ?? [];
if (!categories.length) {
  console.error('no future categories found in page data — shape has changed');
  process.exit(1);
}

// "nfl_futures_special_fixture_11052_2027_nfl_regular_season_total_passing_yards"
// -> "regular_season_total_passing_yards"
const slugOf = (type) =>
  type
    .replace(/^nfl_futures_special_fixture_\d+_\d+_nfl_/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// --- pull every market ---
const markets = [];
for (const cat of categories) {
  let data;
  try {
    data = await fetchJson(API + encodeURIComponent(cat.type));
  } catch (err) {
    console.error(`${slugOf(cat.type)}: request failed — ${err.message ?? err}`);
    continue;
  }
  markets.push({ slug: slugOf(cat.type), data });
  await new Promise((r) => setTimeout(r, 250));
}
if (!markets.length) {
  console.error('every category request failed — endpoint has changed or is blocking');
  process.exit(1);
}

const season = markets.find((m) => m.data.rules?.season)?.data.rules.season ?? 'unknown';
const OUT = new URL(`vegas/${season}/`, RAW);
await mkdir(OUT, { recursive: true });
for (const { slug, data } of markets) {
  // Every state-level skin of a book carries identical lines (DK NJ = DK PA);
  // keeping one per brand cuts the snapshot from ~44MB to a few MB.
  const trimmed = { ...data, books: (data.books ?? []).filter((b) => BRANDS[b.book_id]) };
  await writeFile(new URL(`${slug}.json`, OUT), JSON.stringify(trimmed, null, 1));
}

// --- normalize the per-player over/under totals ---
// Sleeper ids let the rest of the pipeline join these against rosters/ADP.
// The repo's trimmed players.json only holds league-history players, so the
// join reads Sleeper's full dump live instead (matching only — not stored).
// Same-name ties break on team, then position from the AN url_slug
// ("matthew-stafford-1594-qb" -> QB).
let sleeperByName = new Map();
try {
  const players = await fetchJson('https://api.sleeper.app/v1/players/nfl');
  for (const [id, p] of Object.entries(players)) {
    if (!p?.full_name) continue;
    const key = normalize(p.full_name);
    if (!sleeperByName.has(key)) sleeperByName.set(key, []);
    sleeperByName.get(key).push({
      id,
      position: p.position ?? null,
      team: p.team ?? null,
      active: p.status === 'Active',
    });
  }
} catch (err) {
  console.error(`sleeper players fetch failed (${err.message ?? err}) — writing props without sleeper ids`);
}

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
    .replace(/[^a-z]/g, '');
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const byPlayer = {};
for (const { slug, data } of markets) {
  if (data.line_type !== 'total' || !data.players?.length) continue;
  const optionType = Object.fromEntries(
    Object.entries(data.rules?.options ?? {}).map(([id, o]) => [id, o.option_type]),
  );
  const teamAbbr = Object.fromEntries((data.teams ?? []).map((t) => [t.id, t.abbr]));
  const playerById = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const market = slug.replace(/^regular_season_total_/, '');

  // book -> player -> {line, over, under}
  for (const book of data.books ?? []) {
    const brand = BRANDS[book.book_id];
    if (!brand) continue;
    for (const odd of book.odds ?? []) {
      const player = playerById[odd.player_id];
      if (!player) continue;
      const key = String(odd.player_id);
      const entry = (byPlayer[key] ??= {
        name: player.full_name,
        team: teamAbbr[player.team_id] ?? null,
        position: player.url_slug?.match(/-([a-z]+)$/)?.[1]?.toUpperCase() ?? null,
        sleeper_id: null,
        markets: {},
      });
      const lines = ((entry.markets[market] ??= { line: null, books: {} }).books[brand] ??= {});
      // Some books publish odds with a null line on one side; keep the real one.
      lines.line = odd.value ?? lines.line ?? null;
      const side = optionType[odd.option_type_id];
      if (side === 'Over') lines.over = odd.money;
      else if (side === 'Under') lines.under = odd.money;
    }
  }
}

let matched = 0;
for (const entry of Object.values(byPlayer)) {
  for (const m of Object.values(entry.markets)) {
    m.line =
      m.books.consensus?.line ??
      median(Object.values(m.books).map((b) => b.line).filter((v) => v != null));
  }
  const candidates = sleeperByName.get(normalize(entry.name)) ?? [];
  const narrowed =
    candidates.length > 1
      ? [
          candidates.filter((c) => entry.team && c.team === entry.team),
          candidates.filter((c) => entry.position && c.position === entry.position),
          candidates.filter((c) => c.active),
        ].find((g) => g.length === 1) ?? []
      : candidates;
  const pick = narrowed.length === 1 ? narrowed[0] : null;
  if (pick) {
    entry.sleeper_id = pick.id;
    entry.position ??= pick.position;
    matched++;
  }
}

await writeFile(
  new URL('player-season-props.json', OUT),
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), players: byPlayer }, null, 1),
);

const players = Object.keys(byPlayer).length;
const marketCounts = {};
for (const e of Object.values(byPlayer))
  for (const m of Object.keys(e.markets)) marketCounts[m] = (marketCounts[m] ?? 0) + 1;
console.log(`${markets.length}/${categories.length} markets saved to data/raw/vegas/${season}/`);
console.log(`${players} players with season O/U lines (${matched} matched to sleeper ids):`);
for (const [m, n] of Object.entries(marketCounts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${m}: ${n}`);
if (!players) {
  console.error('no per-player totals found — market shapes have changed');
  process.exit(1);
}
