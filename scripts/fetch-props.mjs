// Snapshots every player prop a sportsbook will show us into
// data/raw/props/<season>.json.
//
// Season-long player props are the closest thing to a market-priced projection:
// a receiving-yards line has money behind it, injury risk already inside it, and
// no fantasy site's house view attached. ADP says what a player costs; this says
// what he is worth.
//
// Nothing here is a documented API. DraftKings' own front end calls these paths,
// and the category and subcategory ids change every season, so the script
// discovers them instead of hardcoding: walk the event group, walk every
// subcategory under it, and keep any offer that names a player. Unrecognised
// markets are kept under their own label rather than dropped — a line we cannot
// classify today is still a line.
//
// Local egress is blocked in the Claude Code sandbox, so this runs in
// .github/workflows/refresh-data.yml, where the runner has open network.
import { mkdir, writeFile } from 'node:fs/promises';

const RAW = new URL('../data/raw/', import.meta.url);
const OUT = new URL('props/', RAW);
const SEASON = process.env.PROPS_SEASON ?? String(new Date().getUTCFullYear());
const DK = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5';
// DraftKings groups every NFL market under one event group. Extra ids can be
// added from the workflow without touching this file, for the seasons when the
// book files season-long props somewhere of its own.
const DK_EVENT_GROUPS = (process.env.DK_EVENT_GROUPS ?? '88808').split(',').map((s) => s.trim());
const PAUSE_MS = 250;

// Subcategory labels are prose, not identifiers, and they drift year to year
// ("Passing Yards", "Pass Yards", "Total Passing Yards"). Match loosely on the
// two words that carry the meaning.
const TD = /touchdown|\btds?\b/i;
// Derivative markets wearing the same words as a season total. "Longest
// Reception" is not receptions and "First Touchdown Scorer" is not touchdowns;
// classifying either would quietly poison a projection.
const DERIVATIVE = /longest|shortest|\bfirst\b|\blast\b|\bhalf\b|quarter|\bdrive\b|scorer/i;
const MARKETS = [
  // Combined yardage first: it says "rushing" and "receiving" too, and would
  // otherwise be filed as one of them.
  ['scrimmage_yds', /scrimmage|rush(ing)?\s*\+|rush(ing)?\s+and\s+receiv/i, null],
  ['pass_yds', /pass/i, /yard/i],
  ['pass_tds', /pass/i, TD],
  ['pass_att', /pass/i, /attempt/i],
  ['pass_cmp', /completion/i, null],
  ['int', /interception/i, null],
  ['rush_yds', /rush/i, /yard/i],
  ['rush_tds', /rush/i, TD],
  ['rush_att', /rush/i, /attempt|carr/i],
  ['rec_yds', /receiv/i, /yard/i],
  ['rec_tds', /receiv/i, TD],
  ['rec', /reception|\bcatches\b/i, null],
  ['any_td', /anytime/i, TD],
];

export const canonicalMarket = (label = '') => {
  // Anytime touchdown reads as a scorer market but is a genuine season total,
  // so it is the one exception to the derivative filter.
  if (DERIVATIVE.test(label) && !/anytime/i.test(label)) return null;
  for (const [key, a, b] of MARKETS) if (a.test(label) && (b === null || b.test(label))) return key;
  return null;
};

// American odds to the probability they imply, vig included.
export const impliedProbability = (american) => {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
};

// Both sides of a two-way market add up to more than 1 — that surplus is the
// book's cut. Normalising it away leaves the price the book actually believes.
export const devig = (over, under) => {
  const a = impliedProbability(over);
  const b = impliedProbability(under);
  if (a === null || b === null || a + b === 0) return null;
  return Number((a / (a + b)).toFixed(4));
};

async function fetchJson(url, { retries = 3, delayMs = 800 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          // The season-long boards are rendered client-side; without a browser
          // user agent these paths answer 403.
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
          accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every subcategory the event group exposes, flattened out of the two levels
// DraftKings nests them under.
export function subcategoriesOf(payload) {
  const categories = payload?.eventGroup?.offerCategories ?? [];
  return categories.flatMap((category) =>
    (category.offerSubcategoryDescriptors ?? []).map((sub) => ({
      categoryId: category.offerCategoryId,
      categoryName: category.name ?? '',
      subcategoryId: sub.subcategoryId,
      subcategoryName: sub.name ?? '',
    })),
  );
}

// An offer is a market on one player: two outcomes, each with a price, and on
// yardage markets a line. Anything without a named participant is a team or
// game market and is not what we came for.
export function harvestDraftKings(payload, { categoryName = '', subcategoryName = '' } = {}) {
  const descriptors = payload?.eventGroup?.offerCategories?.flatMap(
    (c) => c.offerSubcategoryDescriptors ?? [],
  ) ?? [];
  const offers = descriptors.flatMap((d) => (d.offerSubcategory?.offers ?? []).flat());
  const label = subcategoryName || categoryName;
  const market = canonicalMarket(label);

  const rows = [];
  for (const offer of offers) {
    const outcomes = offer?.outcomes ?? [];
    const named = outcomes.filter((o) => o?.participant);
    if (!named.length) continue;

    // Two-way markets (Over/Under on one player) versus one-way markets like
    // anytime touchdown or an award, where each outcome is a different player.
    const sides = new Map();
    for (const o of named) {
      if (!sides.has(o.participant)) sides.set(o.participant, []);
      sides.get(o.participant).push(o);
    }

    for (const [player, group] of sides) {
      const over = group.find((o) => /over/i.test(o.label ?? ''));
      const under = group.find((o) => /under/i.test(o.label ?? ''));
      const line = group.find((o) => o.line != null)?.line ?? null;
      rows.push({
        player,
        market: market ?? label ?? 'unknown',
        label,
        line: line == null ? null : Number(line),
        over: over ? Number(over.oddsAmerican) : group.length === 1 ? Number(group[0].oddsAmerican) : null,
        under: under ? Number(under.oddsAmerican) : null,
        classified: market !== null,
      });
    }
  }
  return rows;
}

// One row per player per market, keeping the tightest price we have seen when
// two subcategories cover the same ground.
export function collate(rows) {
  const players = {};
  for (const row of rows) {
    if (!row.player) continue;
    const player = (players[row.player] ??= { markets: {} });
    const existing = player.markets[row.market];
    const pOver = devig(row.over, row.under);
    const candidate = {
      line: row.line,
      over: row.over,
      under: row.under,
      pOver,
      label: row.label,
      book: 'draftkings',
    };
    // A two-sided price beats a one-sided one; otherwise first write wins.
    if (!existing || (existing.under == null && candidate.under != null)) player.markets[row.market] = candidate;
  }
  return players;
}

async function scrapeDraftKings() {
  const rows = [];
  const seen = [];
  for (const groupId of DK_EVENT_GROUPS) {
    let root;
    try {
      root = await fetchJson(`${DK}/eventgroups/${groupId}?format=json`);
    } catch (err) {
      console.error(`draftkings ${groupId}: ${err.message ?? err}`);
      continue;
    }

    const subs = subcategoriesOf(root);
    console.log(`draftkings ${groupId}: ${subs.length} subcategories`);
    for (const sub of subs) {
      const url = `${DK}/eventgroups/${groupId}/categories/${sub.categoryId}/subcategories/${sub.subcategoryId}?format=json`;
      try {
        const payload = await fetchJson(url, { retries: 1 });
        const found = harvestDraftKings(payload, sub);
        if (found.length) seen.push(`${sub.categoryName} / ${sub.subcategoryName}: ${found.length}`);
        rows.push(...found);
      } catch (err) {
        console.error(`  ${sub.categoryName} / ${sub.subcategoryName}: ${err.message ?? err}`);
      }
      await sleep(PAUSE_MS);
    }
  }
  return { rows, seen };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(OUT, { recursive: true });
  const { rows, seen } = await scrapeDraftKings();
  const players = collate(rows);
  const names = Object.keys(players);

  const byMarket = {};
  for (const p of Object.values(players)) for (const m of Object.keys(p.markets)) byMarket[m] = (byMarket[m] ?? 0) + 1;

  await writeFile(
    new URL(`${SEASON}.json`, OUT),
    JSON.stringify({ season: SEASON, fetched: new Date().toISOString(), players }, null, 1),
  );

  console.log(`\nsubcategories with player offers:\n  ${seen.join('\n  ') || '(none)'}`);
  console.log(`\n${names.length} players, ${Object.keys(byMarket).length} markets`);
  for (const [market, count] of Object.entries(byMarket).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${market.padEnd(16)} ${count}`);
  }
  const sample = names.slice(0, 3).map((n) => `${n}: ${JSON.stringify(players[n].markets)}`);
  console.log(`\nsample:\n  ${sample.join('\n  ') || '(none)'}`);

  if (!names.length) {
    console.error('\nNo player props returned — the endpoint or its shape has changed.');
    process.exit(1);
  }
}
