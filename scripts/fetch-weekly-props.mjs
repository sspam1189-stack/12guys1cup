/**
 * Weekly player props, the game-level counterpart to fetch-vegas-props.mjs.
 *
 * The season script pulls futures: one O/U per player for the whole year. This
 * pulls the same idea a week at a time, which is a different shape of request —
 * weekly props hang off a game, not off the season, so the walk is
 *
 *   events for the week  ->  each game's id  ->  each market on that game
 *
 * rather than one call per market. Passing `season` to the offers endpoint
 * silently returns nothing for game-period markets, so it is deliberately
 * absent below.
 *
 * Touchdowns are the one stat with no weekly O/U. Books post anytime-TD
 * instead, and the feed carries only the "yes" side — one offer per game with a
 * selection per player — so there is no second price to de-vig against and the
 * implied probability still has the hold baked in. Rather than invent a vig
 * constant, the probability is recorded as-is and clearly marked, and expected
 * touchdowns come from the weekly projection. That is the same rule the season
 * pipeline follows: the market sets a stat only where the market actually
 * prices one.
 *
 *   node scripts/fetch-weekly-props.mjs            current week
 *   node scripts/fetch-weekly-props.mjs --week 3   a specific week
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../data/raw/vegas');
const BP_KEY = 'CHi8Hy5CEE4khd46XNYL23dCFX96oUdw6qOt1Dnh';

// Game-period markets that carry a fantasy-scoring stat. `touchdown_scored`
// is a probability rather than a total and is converted below.
const MARKETS = {
  103: 'passing_yards',
  102: 'passing_tds',
  101: 'interceptions',
  107: 'rushing_yards',
  105: 'receiving_yards',
  104: 'receptions',
  406: 'rushing_receiving_yards',
  78: 'touchdown_scored', // anytime TD: one offer per game, selection per player
};

const BP_BRANDS = {
  0: 'consensus', 12: 'draftkings', 10: 'fanduel', 19: 'betmgm',
  13: 'caesars', 18: 'betrivers', 2: 'pinnacle', 24: 'bet365',
};
// Same fixed chain the season pipeline walks, so one book sets the number every
// pull instead of a cross-book median that drifts as books open and close.
const ORDER = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'betrivers', 'pinnacle', 'bet365'];

const normalize = (s) =>
  s.toLowerCase().replace(/[.'`\-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/g, '').trim();

const impliedP = (odds) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));

async function fetchJson(url, init, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};

const state = await fetchJson('https://api.sleeper.app/v1/state/nfl');
const season = Number(arg('--season') ?? state.season);
const week = Number(arg('--week') ?? state.week);

const events = await fetchJson(
  `https://api.bettingpros.com/v3/events?sport=NFL&week=${week}&season=${season}`,
  { headers: { 'x-api-key': BP_KEY } },
);
const eventIds = (events.events ?? []).map((e) => e.id);
if (!eventIds.length) {
  console.error(`no events for ${season} week ${week} — nothing to pull`);
  process.exit(1);
}
console.log(`${season} week ${week}: ${eventIds.length} games`);

const players = {};
let cells = 0;

for (const eventId of eventIds) {
  for (const [id, market] of Object.entries(MARKETS)) {
    let offers = [];
    try {
      for (let page = 1, pages = 1; page <= pages; page++) {
        const d = await fetchJson(
          `https://api.bettingpros.com/v3/offers?sport=NFL&market_id=${id}&event_id=${eventId}&limit=10&page=${page}`,
          { headers: { 'x-api-key': BP_KEY } },
        );
        pages = d._pagination?.total_pages ?? 1;
        offers.push(...(d.offers ?? []));
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (err) {
      console.error(`  event ${eventId} ${market}: ${err.message ?? err}`);
      continue;
    }

    // Anytime TD is one offer per game whose selections each name a player,
    // so it is walked selection-first rather than offer-first.
    if (market === 'touchdown_scored') {
      for (const offer of offers) {
        const byPid = new Map((offer.participants ?? []).map((p) => [String(p.pid ?? p.id), p]));
        for (const sel of offer.selections ?? []) {
          const name = sel.label ?? byPid.get(String(sel.participant))?.name;
          if (!name) continue;
          // The team itself rides along as a participant on the same offer
          // (it carries the team-to-score price); skip it by id.
          if (String(sel.participant) === String(offer.team_id)
              || String(sel.participant) === String(offer.participants?.[0]?.pid)) continue;
          const entry = (players[normalize(name)] ??= {
            name, team: null, position: null, opponent: null, markets: {},
          });
          const books = {};
          for (const book of sel.books ?? []) {
            const brand = BP_BRANDS[book.id];
            if (!brand) continue;
            const mains = (book.lines ?? []).filter((l) => l.main && l.active);
            const line = mains.find((l) => !l.is_off) ?? mains[0];
            if (!line) continue;
            books[brand] = { line: 1, over: line.cost, ...(line.is_off ? { off: true } : {}) };
          }
          if (!Object.keys(books).length) continue;
          entry.markets.anytime_td = { line: 1, books };
          cells++;
        }
      }
      continue;
    }

    for (const offer of offers) {
      const part = offer.participants?.[0];
      if (!part?.name) continue;
      const key = normalize(part.name);
      const entry = (players[key] ??= {
        name: part.name,
        team: part.player?.team ?? null,
        position: part.player?.position ?? null,
        opponent: null,
        markets: {},
      });
      entry.position ??= part.player?.position ?? null;
      entry.team ??= part.player?.team ?? null;

      const books = {};
      for (const sel of offer.selections ?? []) {
        // Totals come as over/under; anytime TD comes as yes/no.
        const side =
          sel.selection === 'over' || sel.selection === 'yes' ? 'over'
          : sel.selection === 'under' || sel.selection === 'no' ? 'under'
          : null;
        if (!side) continue;
        for (const book of sel.books ?? []) {
          const brand = BP_BRANDS[book.id];
          if (!brand) continue;
          const mains = (book.lines ?? []).filter((l) => l.main && l.active);
          const line = mains.find((l) => !l.is_off) ?? mains[0];
          if (!line) continue;
          const b = (books[brand] ??= {});
          b.line = line.line ?? b.line ?? null;
          b[side] = line.cost;
          if (line.is_off) b.off = true;
        }
      }
      if (!Object.keys(books).length) continue;
      entry.markets[market] = { line: null, books };
      cells++;
    }
  }
}

// Resolve each market to a single number by the book chain, exactly as the
// season pipeline does: first live book in priority order, then any live book,
// then consensus, and only then a last-posted fallback flagged as stale.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const live = (b) => b && b.line != null && !b.off;

for (const entry of Object.values(players)) {
  for (const m of Object.values(entry.markets)) {
    const first = ORDER.map((k) => m.books[k]).find(live);
    const anyBook = Object.entries(m.books).find(([k, b]) => k !== 'consensus' && live(b));
    m.line =
      (first ? first.line : null) ??
      (anyBook ? anyBook[1].line : null) ??
      (live(m.books.consensus) ? m.books.consensus.line : null) ??
      (() => {
        const last = Object.values(m.books).map((b) => b.line).filter((v) => v != null);
        return last.length ? median(last) : null;
      })();
    if (Object.values(m.books).every((b) => b.line == null || b.off)) m.stale = true;

    // Two-way prices from the same book that set the line, for de-vigging.
    const src = first ?? (anyBook ? anyBook[1] : null) ?? m.books.consensus;
    if (src?.over != null) m.over = src.over;
    if (src?.under != null) m.under = src.under;
  }

  // Anytime TD is a one-sided price, so this probability still contains the
  // book's hold and reads a few points high. Recorded for reference and for
  // ranking players against each other -- the vig is roughly common across
  // selections, so the ordering survives even though the level does not.
  // Expected touchdowns are taken from the weekly projection instead.
  const td = entry.markets.anytime_td;
  if (td?.over != null) {
    const p = impliedP(td.over);
    if (p > 0 && p < 0.999) td.p_anytime_with_vig = Math.round(p * 1000) / 1000;
  }
}

await mkdir(OUT_DIR, { recursive: true });
const outFile = resolve(OUT_DIR, String(season), `week-${week}-props.json`);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify({ season, week, fetched_at: new Date().toISOString(), games: eventIds.length, players }, null, 1),
);

const counts = {};
for (const e of Object.values(players)) {
  for (const [m, d] of Object.entries(e.markets)) {
    if (d.line != null) counts[m] = (counts[m] ?? 0) + 1;
  }
}
console.log(`${Object.keys(players).length} players, ${cells} market cells -> ${outFile}`);
for (const [m, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${n}`);
}
console.log(`  anytime-TD prices: ${Object.values(players).filter((e) => e.markets.anytime_td?.p_anytime_with_vig != null).length}`);
