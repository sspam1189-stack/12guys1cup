// Vegas-implied points for the top of the draft board — every season O/U line
// a player carries, scored under this league's settings, laid against his ADP.
// The O/U line is the market's median projection, so the total is what the
// betting market thinks each pick is worth in league points. Prints markdown
// to stdout:
//   node scripts/implied-points.mjs > docs/implied-points.md
import { readdir, readFile } from 'node:fs/promises';
import { impliedPoints } from './lib/implied.mjs';

const RAW = new URL('../data/raw/', import.meta.url);
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

const TOP = 100;
const GAMES = 17;
// Sleeper's "nobody drafted him" sentinel.
const UNDRAFTED = 999;

// Newest season that has both a Vegas snapshot and an ADP snapshot.
const vegasSeasons = (await readdir(new URL('vegas/', RAW))).filter((d) => /^\d{4}$/.test(d)).sort();
let season = null;
let adp = null;
for (const s of vegasSeasons.reverse()) {
  try {
    adp = await readJson(new URL(`adp/${s}.json`, RAW));
    season = s;
    break;
  } catch {
    // vegas snapshot without an adp sibling — keep looking
  }
}
if (!season) {
  console.error('no season has both a vegas and an adp snapshot');
  process.exit(1);
}

const props = await readJson(new URL(`vegas/${season}/player-season-props.json`, RAW));
const settings = await readJson(new URL('../data/computed/settings.json', import.meta.url));
if (settings.season !== season) {
  console.error(`warning: scoring settings are from ${settings.season}, lines are from ${season}`);
}
const scoring = settings.scoring;

// Props carry sleeper ids from the fetch-time join; name matching is only a
// fallback for entries that join missed.
const normalize = (name) =>
  name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
    .replace(/[^a-z]/g, '');
const bySleeper = new Map();
const byName = new Map();
for (const entry of Object.values(props.players)) {
  if (entry.sleeper_id) bySleeper.set(entry.sleeper_id, entry);
  byName.set(normalize(entry.name), entry);
}

const board = Object.entries(adp)
  .map(([id, p]) => ({ id, ...p }))
  .filter((p) => p.adp < UNDRAFTED)
  .sort((a, b) => a.adp - b.adp)
  .slice(0, TOP)
  .map((p, i) => {
    const entry = bySleeper.get(p.id) ?? byName.get(normalize(p.name));
    const result = entry ? impliedPoints(entry.markets, scoring, p.position, { devig: true }) : null;
    const posted = entry ? impliedPoints(entry.markets, scoring, p.position) : null;
    // FantasyPros-backfilled cells are analyst projections, not market lines —
    // worth a flag so nobody reads them as Vegas.
    const projected =
      entry != null &&
      Object.keys(result.lines).some(
        (m) => !result.derived.includes(m) && entry.markets[m]?.source === 'fantasypros',
      );
    return {
      rank: i + 1,
      name: p.name,
      position: p.position,
      team: p.team || entry?.team || '',
      adp: p.adp,
      points: result && Object.keys(result.lines).length ? result.points : null,
      juice: result && posted && Object.keys(result.lines).length ? result.points - posted.points : null,
      lines: result?.lines ?? {},
      missing: result?.missing ?? [],
      projected,
    };
  });

// Positional ranks: by ADP they follow board order; by implied points they are
// re-ranked within this top-100 pool.
const posCount = {};
for (const p of board) p.adpPosRank = posCount[p.position] = (posCount[p.position] ?? 0) + 1;
const ptsCount = {};
for (const p of [...board].filter((p) => p.points != null).sort((a, b) => b.points - a.points))
  p.ptsPosRank = ptsCount[p.position] = (ptsCount[p.position] ?? 0) + 1;

const fmt = (n) => (n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const rate = (key) => +(scoring[key] ?? 0).toFixed(2);

const out = [];
out.push(`# Vegas-Implied Points — Top ${TOP} ADP`);
out.push('');
out.push(
  `*${season} season · O/U lines snapshotted ${props.fetched} · ADP is Sleeper half-PPR as of the last data refresh*`,
);
out.push('');
out.push(
  'Each season over/under approximates the market\'s median projection for that stat — but only',
  'when the juice is balanced, so every line here is de-vigged first: the two-way prices are',
  'normalized into a probability and the line is shifted to the mean that tail implies (normal',
  'for yardage-scale stats, Poisson for TD counts, median across books). A stale suspended',
  'number priced -4900 to the under stops counting at face value. Scored under league settings —',
  `${rate('pass_yd')}/pass yd, ${rate('pass_td')} per pass TD, ${rate('rush_yd')}/rush yd,`,
  `${rate('rec_yd')}/rec yd, ${rate('rush_td')} per rush/rec TD, ${rate('rec')} per reception — the lines become`,
  'the points total Vegas is quoting on every player at the top of the draft board. The Juice',
  'column is the shift the odds forced versus scoring the posted lines as-is: a big negative',
  'number marks a stale or under-juiced market, a positive one a line the books fear going over.',
);
out.push('');
out.push('What the totals leave out:');
out.push('');
out.push(
  '- No book posts season markets for interceptions, fumbles, or 2-pt conversions, and the',
  '  weekly yardage bonuses cannot be derived from a season total. QBs run slightly hot (no',
  '  INT penalty); big-game players run slightly cold.',
);
out.push(`- Per-game divides by the full ${GAMES}-game season — no missed-time discount.`);
out.push(
  '- † — a core market for the position has no posted line, so the total is understated;',
  '  the gaps are listed below the table.',
);
out.push(
  '- ° — includes FantasyPros consensus projections where no book hangs a line (thin RB',
  '  receiving markets), analyst numbers rather than Vegas.',
);
out.push('');
out.push(
  '| # | Player | Pos | Team | ADP | Pass yds | Pass TD | Rush yds | Rush TD | Rec | Rec yds | Rec TD | Implied | /gm | Juice | Pos: ADP → pts |',
);
out.push('|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|');
for (const p of board) {
  const flags = `${p.missing.length ? '†' : ''}${p.projected ? '°' : ''}`;
  // A lump rush+receive line with no splits (rare) renders in the rush column.
  const rushYds =
    p.lines.rushing_yards ?? (p.lines.rushing_receiving_yards != null ? `${fmt(p.lines.rushing_receiving_yards)} (+rec)` : null);
  const rushTds =
    p.lines.rushing_tds ?? (p.lines.rushing_receiving_tds != null ? `${fmt(p.lines.rushing_receiving_tds)} (+rec)` : null);
  const cells = [
    p.rank,
    `${p.name}${flags}`,
    p.position,
    p.team,
    p.adp,
    fmt(p.lines.passing_yards),
    fmt(p.lines.passing_tds),
    typeof rushYds === 'string' ? rushYds : fmt(rushYds),
    typeof rushTds === 'string' ? rushTds : fmt(rushTds),
    fmt(p.lines.receptions),
    fmt(p.lines.receiving_yards),
    fmt(p.lines.receiving_tds),
    p.points == null ? '—' : p.points.toFixed(1),
    p.points == null ? '—' : (p.points / GAMES).toFixed(1),
    p.juice == null || Math.abs(p.juice) < 0.05 ? '' : (p.juice > 0 ? '+' : '') + p.juice.toFixed(1),
    p.points == null ? '—' : `${p.position}${p.adpPosRank} → ${p.position}${p.ptsPosRank}`,
  ];
  out.push(`| ${cells.join(' | ')} |`);
}

// Where the market's points disagree with the market's draft position, within
// position so a 4-pt-TD QB total is never "value" over an RB1.
const gap = (p) => p.adpPosRank - p.ptsPosRank;
const priced = board.filter((p) => p.points != null && p.ptsPosRank != null);
const bargains = priced.filter((p) => gap(p) >= 3).sort((a, b) => gap(b) - gap(a)).slice(0, 8);
// Understated (†) totals would show up here for the wrong reason.
const rich = priced
  .filter((p) => !p.missing.length && gap(p) <= -3)
  .sort((a, b) => gap(a) - gap(b))
  .slice(0, 8);

out.push('');
out.push('## Where the lines disagree with the room');
out.push('');
out.push('### Priced below their lines');
out.push('');
for (const p of bargains)
  out.push(
    `- **${p.name}** — ${p.position}${p.adpPosRank} by ADP (${p.adp}), ${p.position}${p.ptsPosRank} by implied points (${p.points.toFixed(1)})`,
  );
out.push('');
out.push('### Priced above their lines');
out.push('');
for (const p of rich)
  out.push(
    `- **${p.name}** — ${p.position}${p.adpPosRank} by ADP (${p.adp}), ${p.position}${p.ptsPosRank} by implied points (${p.points.toFixed(1)})`,
  );

const gaps = board.filter((p) => p.missing.length);
if (gaps.length) {
  out.push('');
  out.push('### Missing lines (†)');
  out.push('');
  for (const p of gaps)
    out.push(`- **${p.name}** — no ${p.missing.map((m) => m.replace(/_/g, ' ')).join(', ')} line`);
}
out.push('');

console.log(out.join('\n'));
