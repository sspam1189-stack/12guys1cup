// Turns a player's Vegas season O/U lines into the fantasy points those lines
// are worth under a league's scoring settings. The O/U line on a season total
// is, in effect, the market's median projection for that stat — so the sum is
// "what Vegas thinks this player scores" in league points.

// Season market -> the sleeper scoring key its line multiplies into.
export const MARKET_SCORING = {
  passing_yards: 'pass_yd',
  passing_tds: 'pass_td',
  interceptions: 'pass_int',
  rushing_yards: 'rush_yd',
  rushing_tds: 'rush_td',
  receiving_yards: 'rec_yd',
  receiving_tds: 'rec_td',
  receptions: 'rec',
};

// Books sometimes hang one combined rush+receive number on a player instead
// of splits. A combo never adds to the splits when both exist; when exactly
// one split exists the other falls out by subtraction; with no splits at all
// the lump is scored whole, at the rushing rate.
const COMBO_PARTS = {
  rushing_receiving_yards: ['rushing_yards', 'receiving_yards'],
  rushing_receiving_tds: ['rushing_tds', 'receiving_tds'],
};
const COMBO_RATE = { rushing_receiving_yards: 'rush_yd', rushing_receiving_tds: 'rush_td' };

// The markets a position needs before its implied total means anything.
// A player missing one of these is understated, not projected low.
// Interceptions are left out for QBs: no book posts a season INT O/U, and a
// core market nobody can have would flag every quarterback.
export const CORE_MARKETS = {
  QB: ['passing_yards', 'passing_tds', 'rushing_yards', 'rushing_tds'],
  RB: ['rushing_yards', 'rushing_tds', 'receptions', 'receiving_yards', 'receiving_tds'],
  WR: ['receptions', 'receiving_yards', 'receiving_tds'],
  TE: ['receptions', 'receiving_yards', 'receiving_tds'],
};

// markets: a player's entry from player-season-props.json ({market: {line}}).
// Returns { points, lines, derived, missing } where lines is the effective
// per-market number that was scored, derived names the lines produced by
// combo subtraction, and missing lists core markets with no posted line.
export function impliedPoints(markets, scoring, position = null) {
  const lines = {};
  for (const market of Object.keys(MARKET_SCORING)) {
    const line = markets?.[market]?.line;
    if (line != null) lines[market] = line;
  }

  const derived = [];
  for (const [combo, parts] of Object.entries(COMBO_PARTS)) {
    const line = markets?.[combo]?.line;
    if (line == null) continue;
    const posted = parts.filter((p) => lines[p] != null);
    if (posted.length === parts.length) continue; // the splits tell the whole story
    if (posted.length === 1) {
      const rest = line - lines[posted[0]];
      const missingPart = parts.find((p) => lines[p] == null);
      // A combo below its own posted split is a stale or crossed market; a
      // negative remainder would subtract points, so it is dropped instead.
      if (rest > 0) {
        lines[missingPart] = rest;
        derived.push(missingPart);
      }
    } else {
      lines[combo] = line;
    }
  }

  let points = 0;
  for (const [market, line] of Object.entries(lines)) {
    points += line * (scoring[MARKET_SCORING[market] ?? COMBO_RATE[market]] ?? 0);
  }

  const covered = (market) =>
    lines[market] != null ||
    Object.entries(COMBO_PARTS).some(([combo, parts]) => lines[combo] != null && parts.includes(market));
  const missing = (CORE_MARKETS[position] ?? []).filter((m) => !covered(m));

  return { points, lines, derived, missing };
}
