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

// A posted line is only the market's median when the juice is balanced. When
// a book prices one side heavily (a suspended market keeps its last number and
// corrects through price alone), the odds say where the real median sits:
// normalize the two-way prices into P(over), then find the mean a plausible
// season distribution needs for that tail. Yardage-scale stats are treated as
// normal with a stat-typical spread; TD-scale counts as Poisson. Both give the
// mean, which is what expected points wants.
const POISSON_MARKETS = new Set([
  'rushing_tds',
  'receiving_tds',
  'rushing_receiving_tds',
  'interceptions',
]);
// Season-total spread as a fraction of the mean, per stat. Rough shares of
// variance observed in season outcomes; only the tail mapping uses them.
const SPREAD = {
  passing_yards: 0.15,
  passing_tds: 0.2,
  rushing_yards: 0.35,
  receiving_yards: 0.35,
  receptions: 0.3,
  rushing_receiving_yards: 0.3,
};

const winProb = (american) =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100);

// Φ⁻¹ (Acklam's approximation) — plenty for juice-sized probabilities.
function invnorm(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -invnorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// One book's posted line + two-way prices -> the mean those prices imply.
function bookMean(marketName, line, pOverRaw) {
  // Distribution error grows in the far tail; cap how far a price can drag.
  const pOver = Math.min(0.95, Math.max(0.05, pOverRaw));
  if (POISSON_MARKETS.has(marketName)) {
    // Over an x.5 count line means "at least ceil(x.5)". Bisect the λ whose
    // upper tail matches the de-vigged price.
    const n = Math.ceil(line);
    const tail = (lam) => {
      let term = Math.exp(-lam);
      let cum = term;
      for (let k = 1; k < n; k++) {
        term *= lam / k;
        cum += term;
      }
      return 1 - cum;
    };
    let lo = 0.01;
    let hi = 80;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tail(mid) < pOver) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const spread = SPREAD[marketName] ?? 0.3;
  const z = invnorm(1 - pOver); // line sits z spreads above the mean
  const mean = line / (1 + z * spread);
  // Guardrail on the same modelling error: never move a line past ~±45%.
  return Math.min(line * 1.45, Math.max(line * 0.55, mean));
}

// The de-vigged mean for a market entry ({line, books}), or null when no book
// posted two-way prices (FantasyPros backfill, single-sided odds).
export function deviggedLine(marketName, market) {
  const means = [];
  for (const b of Object.values(market?.books ?? {})) {
    if (b?.line == null || b.over == null || b.under == null) continue;
    const po = winProb(b.over);
    const pu = winProb(b.under);
    means.push(bookMean(marketName, b.line, po / (po + pu)));
  }
  return means.length ? median(means) : null;
}

// markets: a player's entry from player-season-props.json ({market: {line}}).
// Returns { points, lines, derived, missing } where lines is the effective
// per-market number that was scored, derived names the lines produced by
// combo subtraction, and missing lists core markets with no posted line.
// With devig: true, each line is replaced by the mean its books' juice implies
// (posted lines pass through untouched where no two-way prices exist).
export function impliedPoints(markets, scoring, position = null, { devig = false } = {}) {
  const lines = {};
  for (const market of Object.keys(MARKET_SCORING)) {
    const entry = markets?.[market];
    if (entry?.line == null) continue;
    lines[market] = (devig ? deviggedLine(market, entry) : null) ?? entry.line;
  }

  const derived = [];
  for (const [combo, parts] of Object.entries(COMBO_PARTS)) {
    const entry = markets?.[combo];
    if (entry?.line == null) continue;
    const line = (devig ? deviggedLine(combo, entry) : null) ?? entry.line;
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
