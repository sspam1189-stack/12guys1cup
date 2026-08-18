// Monte Carlo mock draft for the upcoming season.
//
// The draft order is not set until draft night, so every simulation reshuffles
// the other eleven managers around your slot. Each of them picks the way they
// actually pick: their positional mix per draft, how far ahead of ADP they open
// at each position, and the round they habitually take a kicker or defense.
//
//   node scripts/mock-draft.mjs --slot 1 [--sims 400]
import { readdir, readFile } from 'node:fs/promises';

const RAW = new URL('../data/raw/', import.meta.url);
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
const at = (season, file) => new URL(`${season}/${file}.json`, RAW);

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const MY_SLOT = arg('--slot', 1);
// --order takes the other managers' display names in slot order, for when the
// commissioner has posted the board and you are choosing where to slot in.
const orderFlag = process.argv.indexOf('--order');
const FIXED_ORDER = orderFlag === -1 ? null : process.argv[orderFlag + 1].split(',').map((n) => n.trim());
const SIMS = arg('--sims', 400);
const MIN_PCT = arg('--min', 25);
const TOP = arg('--top', 8);
const ONLY = arg('--only', 0); // with --compare, score just this one slot
// --exclude-teams DAL,NYG,WAS drops those NFL teams from your board only —
// everyone else still drafts them, so they still come off the board.
const exFlag = process.argv.indexOf('--exclude-teams');
const EXCLUDED = new Set(
  exFlag === -1 ? [] : process.argv[exFlag + 1].split(',').map((t) => t.trim().toUpperCase()),
);
const SEED = arg('--seed', 0);
const QB_ROUND = arg('--qb-round', 8);
const TE_ROUND = arg('--te-round', 8);
const BOARDS = arg('--boards', 0); // print this many complete mock drafts
const CONSENSUS = arg('--consensus', 0); // run N drafts, print the modal board
const ADP_CEILING = 250;
const SKILL = ['QB', 'RB', 'WR', 'TE'];
// Sleeper's kicker and defense ADP is on its own scale, so those two are drafted
// off each manager's habitual round instead of off the market.
const LIMITS = { QB: 3, RB: 8, WR: 8, TE: 3, K: 2, DEF: 2 };

// Deterministic PRNG so a rerun with the same flags gives the same board.
let seed = (0x9e3779b9 + SEED * 2654435761) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

const seasons = (await readdir(RAW)).filter((d) => /^\d{4}$/.test(d)).sort();
const current = seasons.at(-1);
const history = [];
for (const season of seasons) {
  const picks = await readJson(at(season, 'draft_picks'));
  if (picks.length) history.push({ season, picks });
}
const recent = history.slice(-3);

const board = Object.entries(await readJson(new URL(`adp/${current}.json`, RAW)))
  .map(([playerId, p]) => ({ playerId, ...p }))
  .filter((p) => p.adp < ADP_CEILING && SKILL.includes(p.position))
  .sort((a, b) => a.adp - b.adp);

const users = await readJson(at(current, 'users'));
const league = await readJson(at(current, 'draft'));
const TEAMS = league.settings.teams;
const ROUNDS = league.settings.rounds;

const position = (pick) => pick.metadata?.position ?? '?';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Opening reach uses a median, not a mean: one freak pick (a quarterback taken
// 66 picks ahead of his ADP) otherwise rewrites a manager's whole profile.
const median = (xs) => {
  if (!xs.length) return 0;
  const v = xs.slice().sort((a, b) => a - b);
  const i = v.length >> 1;
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
};

// Build each manager's tendency profile from their recent boards.
const tendencies = new Map();
for (const user of users) {
  const drafts = recent
    .map(({ season, picks }) => ({
      season,
      picks: picks.filter((p) => p.picked_by === user.user_id).sort((a, b) => a.pick_no - b.pick_no),
    }))
    .filter((d) => d.picks.length);
  if (!drafts.length) continue;

  const adpFor = new Map();
  for (const { season } of drafts) {
    adpFor.set(season, await readJson(new URL(`adp/${season}.json`, RAW)).catch(() => ({})));
  }
  const target = {};
  for (const pos of [...SKILL, 'K', 'DEF']) {
    target[pos] = mean(drafts.map((d) => d.picks.filter((p) => position(p) === pos).length));
  }
  const openingReach = {};
  for (const pos of SKILL) {
    const samples = [];
    for (const { season, picks } of drafts) {
      const first = picks.find((p) => position(p) === pos);
      const adp = first && (await adpFor.get(season))?.[first.player_id]?.adp;
      if (adp != null && adp < ADP_CEILING) samples.push(adp - first.pick_no);
    }
    openingReach[pos] = samples.length ? median(samples) : 0;
  }
  const habitualRound = {};
  for (const pos of ['K', 'DEF']) {
    const rounds = drafts
      .map((d) => d.picks.find((p) => position(p) === pos)?.round)
      .filter(Boolean);
    habitualRound[pos] = rounds.length ? mean(rounds) : ROUNDS;
  }
  tendencies.set(user.user_id, {
    name: user.display_name,
    target,
    openingReach,
    habitualRound,
  });
}

// What a pick is actually worth. ADP is not linear in points — the gap between
// the first player and the twelfth dwarfs the gap between the hundredth and the
// hundred-and-eleventh — so the value curve is measured off the last three
// seasons: every drafted player's ADP against the points he went on to score.
const valueSamples = [];
for (const { season, picks } of recent) {
  const adpTable = await readJson(new URL(`adp/${season}.json`, RAW)).catch(() => ({}));
  const totals = new Map();
  const matchups = await readJson(at(season, 'matchups'));
  for (const [week, rows] of Object.entries(matchups)) {
    if (Number(week) > 17) continue;
    for (const row of rows) {
      for (const [playerId, pts] of Object.entries(row.players_points ?? {})) {
        totals.set(playerId, (totals.get(playerId) ?? 0) + (pts ?? 0));
      }
    }
  }
  for (const pick of picks) {
    const adp = adpTable[pick.player_id]?.adp;
    if (adp == null || adp >= ADP_CEILING) continue;
    if (!SKILL.includes(position(pick))) continue;
    valueSamples.push([adp, totals.get(pick.player_id) ?? 0]);
  }
}
valueSamples.sort((a, b) => a[0] - b[0]);
const WINDOW = 25;
const curveAdp = [];
const curvePts = [];
for (let i = 0; i < valueSamples.length; i++) {
  const slice = valueSamples.slice(Math.max(0, i - WINDOW), i + WINDOW + 1);
  curveAdp.push(valueSamples[i][0]);
  curvePts.push(mean(slice.map((x) => x[1])));
}
const expectedPoints = (adp) => {
  if (!curveAdp.length) return 0;
  let lo = 0;
  let hi = curveAdp.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (curveAdp[mid] < adp) lo = mid + 1;
    else hi = mid;
  }
  return curvePts[lo];
};

const opponents = [...tendencies.keys()];
const byName = new Map([...tendencies].map(([id, t]) => [t.name.toLowerCase(), id]));
const fixedIds = FIXED_ORDER?.map((name) => {
  const id = byName.get(name.toLowerCase());
  if (!id) throw new Error(`Unknown manager "${name}". Known: ${[...byName.keys()].join(', ')}`);
  return id;
});
if (fixedIds && fixedIds.length !== TEAMS - 1) {
  throw new Error(`--order needs ${TEAMS - 1} names, got ${fixedIds.length}`);
}

// How you draft, per the plan: one quarterback and one tight end, neither of
// them early, and the rest of the board spent on running backs and receivers.
const MY_PLAN = { QB: 1, RB: 5, WR: 6, TE: 1 };
const EARLIEST = { TE: TE_ROUND, QB: QB_ROUND };
function myChoice(available, mine, round) {
  const count = (pos) => mine.filter((p) => p.position === pos).length;
  // The last two rounds go to kicker and defense, which the board doesn't hold.
  if (round > ROUNDS - 2) return null;
  const roundsLeft = ROUNDS - 2 - round;
  let best = null;
  for (const p of board) {
    if (!available.has(p.playerId)) continue;
    if (EXCLUDED.has((p.team ?? '').toUpperCase())) continue;
    if (count(p.position) >= MY_PLAN[p.position]) continue;
    if (round < (EARLIEST[p.position] ?? 1)) continue;
    // Don't let a scarce single slot go unfilled by chasing depth to the end.
    const mustFillNow = ['QB', 'TE'].filter((pos) => count(pos) < MY_PLAN[pos]).length;
    if (mustFillNow > roundsLeft && !['QB', 'TE'].includes(p.position)) continue;
    best = p;
    break;
  }
  return best ?? board.find((p) => available.has(p.playerId)) ?? null;
}

function simulate(mySlot) {
  let shuffled;
  if (fixedIds) {
    shuffled = fixedIds;
  } else {
    shuffled = opponents.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  // Everyone except me, spread across the remaining slots.
  const bySlot = [];
  let k = 0;
  for (let slot = 1; slot <= TEAMS; slot++) {
    bySlot[slot] = slot === mySlot ? 'ME' : shuffled[k++];
  }

  const available = new Set(board.map((p) => p.playerId));
  const rosters = new Map(bySlot.slice(1).map((id) => [id, []]));
  const availableAtMyPick = [];
  const mine = [];
  const picksLog = [];

  for (let round = 1; round <= ROUNDS; round++) {
    for (let i = 1; i <= TEAMS; i++) {
      const slot = round % 2 === 1 ? i : TEAMS + 1 - i;
      const id = bySlot[slot];
      if (id === 'ME') {
        availableAtMyPick.push(board.filter((p) => available.has(p.playerId)).slice(0, 40));
        const take = myChoice(available, mine, round);
        if (take) {
          available.delete(take.playerId);
          mine.push({ ...take, round });
          picksLog.push({ round, slot, who: 'YOU', ...take });
        }
        continue;
      }
      const t = tendencies.get(id);
      const have = rosters.get(id);
      const log = picksLog;
      const count = (pos) => have.filter((p) => p === pos).length;

      // Kicker and defense come off habit, not off the market.
      const habitual = ['K', 'DEF'].find(
        (pos) => count(pos) < 1 && round >= Math.round(t.habitualRound[pos]),
      );
      if (habitual) {
        have.push(habitual);
        log.push({ round, slot, who: t.name, name: habitual, position: habitual, team: '' });
        continue;
      }

      let best = null;
      let bestScore = Infinity;
      for (const p of board) {
        if (!available.has(p.playerId)) continue;
        if (count(p.position) >= LIMITS[p.position]) continue;
        const short = t.target[p.position] - count(p.position);
        if (short <= 0) continue;
        const opening = count(p.position) === 0 ? t.openingReach[p.position] : 0;
        // Lower score = taken sooner. Reach pulls a player up the board.
        // Uncertainty grows down the board: nobody is unsure about the 1.01,
        // and everybody is guessing by round 12. Flat noise would make the top
        // of round 1 look like a lottery.
        const jitter = gauss() * Math.max(1.5, p.adp * 0.15);
        const score = p.adp - opening - Math.min(short, 2) * 3 + jitter;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) best = board.find((p) => available.has(p.playerId));
      if (best) {
        available.delete(best.playerId);
        have.push(best.position);
        log.push({ round, slot, who: t.name, ...best });
      }
    }
  }
  return { availableAtMyPick, mine, picksLog, bySlot };
}

// --compare: which slot to pick when the commissioner lets you choose. Every
// slot has the same sum of pick numbers in a snake, so the roster with the
// lowest total ADP is the one the slot actually bought you.
if (process.argv.includes('--compare')) {
  console.log(`Slot comparison — ${SIMS} sims each, ${current} half-PPR ADP, your 1 QB / 1 TE plan\n`);
  console.log('Slot   projected starter pts   typical 1st pick');
  const results = [];
  for (let slot = 1; slot <= TEAMS; slot++) {
    if (ONLY && slot !== ONLY) continue;
    const starters = [];
    const openers = new Map();
    for (let s = 0; s < SIMS; s++) {
      const { mine } = simulate(slot);
      // Starting nine: a quarterback, two backs, three receivers, a tight end,
      // and the best back or receiver left over in the flex.
      const byPos = (pos) =>
        mine.filter((p) => p.position === pos).sort((a, b) => a.adp - b.adp);
      const rb = byPos('RB');
      const wr = byPos('WR');
      const lineup = [
        ...byPos('QB').slice(0, 1),
        ...rb.slice(0, 2),
        ...wr.slice(0, 3),
        ...byPos('TE').slice(0, 1),
        ...[...rb.slice(2), ...wr.slice(3)].sort((a, b) => a.adp - b.adp).slice(0, 1),
      ];
      starters.push(lineup.reduce((a, p) => a + expectedPoints(p.adp), 0));
      const first = mine[0];
      if (first) openers.set(first.name, (openers.get(first.name) ?? 0) + 1);
    }
    const top = [...openers].sort((a, b) => b[1] - a[1])[0];
    results.push({ slot, starter: mean(starters), opener: top?.[0] ?? '—' });
  }
  const best = Math.max(...results.map((r) => r.starter));
  for (const r of results) {
    const flag = r.starter === best ? '  <-- best' : '';
    console.log(
      `${String(r.slot).padStart(2)}     ${r.starter.toFixed(0).padStart(19)}   ${r.opener}${flag}`,
    );
  }
  process.exit(0);
}

if (CONSENSUS) {
  // Aggregate many drafts into the single most likely board.
  const tally = new Map(); // overall pick -> Map(label -> count)
  const owner = new Map();
  for (let i = 0; i < CONSENSUS; i++) {
    for (const p of simulate(MY_SLOT).picksLog) {
      const overall = (p.round - 1) * TEAMS + (p.round % 2 ? p.slot : TEAMS + 1 - p.slot);
      owner.set(overall, p.who);
      if (!tally.has(overall)) tally.set(overall, new Map());
      const label = `${p.position}|${p.name}|${p.team ?? ''}`;
      const t = tally.get(overall);
      t.set(label, (t.get(label) ?? 0) + 1);
    }
  }
  // Each pick's tally is a marginal: a player who goes 6th half the time and
  // 7th the other half is the mode at both. Walk the picks in order and give
  // each one its most frequent player who is still on the board, so the output
  // is a draft that could actually happen rather than twelve separate polls.
  // Off by default: the marginal answers "who goes here", which is what you
  // plan against. --legal answers "what could one draft look like" and is
  // deduplicated, at the cost of frequencies that no longer mean much.
  const LEGAL = process.argv.includes('--legal');
  const claimed = new Set();
  const chosen = new Map();
  for (let overall = 1; overall <= ROUNDS * TEAMS; overall++) {
    const t = tally.get(overall);
    if (!t) continue;
    const ranked = [...t].sort((a, b) => b[1] - a[1]);
    const pick = LEGAL ? (ranked.find(([label]) => !claimed.has(label)) ?? ranked[0]) : ranked[0];
    claimed.add(pick[0]);
    chosen.set(overall, { label: pick[0], n: pick[1], ranked });
  }
  console.log(`Consensus board over ${CONSENSUS} simulated drafts — you at slot ${MY_SLOT}`);
  console.log(
    LEGAL
      ? 'One plausible draft: each player appears once, so the % is only indicative.\n'
      : 'Per-pick distribution: % is how often that player went at that pick. A player\n' +
        'can lead at two consecutive picks — he went 6th in some drafts and 7th in others.\n',
  );
  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`--- Round ${round} ---`);
    for (let i = 1; i <= TEAMS; i++) {
      const overall = (round - 1) * TEAMS + i;
      const t = tally.get(overall);
      if (!t) continue;
      const { label, n, ranked } = chosen.get(overall);
      const [pos, name, team] = label.split('|');
      const who = owner.get(overall);
      const mark = who === 'YOU' ? '>>' : '  ';
      const pct = Math.round((n / CONSENSUS) * 100);
      const alt = who === 'YOU'
        ? '   alt: ' + ranked.slice(1, 4).map(([l, c]) => `${l.split('|')[1]} ${Math.round((c / CONSENSUS) * 100)}%`).join(', ')
        : '';
      console.log(`${mark} ${String(overall).padStart(3)}  ${who.padEnd(14)} ${pos.padEnd(3)} ${(name + (team ? ' (' + team + ')' : '')).padEnd(26)} ${String(pct).padStart(3)}%${alt}`);
    }
  }
  process.exit(0);
}

if (BOARDS) {
  for (let b = 0; b < BOARDS; b++) {
    const { picksLog, mine, bySlot } = simulate(MY_SLOT);
    console.log(`\n${'='.repeat(64)}\nMOCK ${b + 1} — you at slot ${MY_SLOT}\n${'='.repeat(64)}`);
    for (const round of [1, 2, 3]) {
      console.log(`\nRound ${round}`);
      for (const p of picksLog.filter((x) => x.round === round)) {
        const overall = (round - 1) * TEAMS + (round % 2 ? p.slot : TEAMS + 1 - p.slot);
        const mark = p.who === 'YOU' ? '>>' : '  ';
        console.log(`${mark} ${String(overall).padStart(3)}  ${p.who.padEnd(14)} ${p.position.padEnd(3)} ${p.name}${p.team ? ' (' + p.team + ')' : ''}`);
      }
    }
    console.log('\nYOUR ROSTER');
    for (const p of mine) {
      console.log(`   R${String(p.round).padStart(2)}  ${p.position.padEnd(3)} ${p.name.padEnd(24)} ADP ${p.adp.toFixed(1)}${p.team ? '  ' + p.team : ''}`);
    }
  }
  process.exit(0);
}

const survival = Array.from({ length: ROUNDS }, () => new Map());
for (let s = 0; s < SIMS; s++) {
  simulate(MY_SLOT).availableAtMyPick.forEach((pool, round) => {
    for (const p of pool) {
      const row = survival[round];
      row.set(p.playerId, (row.get(p.playerId) ?? 0) + 1);
    }
  });
}

const meta = new Map(board.map((p) => [p.playerId, p]));
const myPicks = [];
for (let round = 1; round <= ROUNDS; round++) {
  const i = round % 2 === 1 ? MY_SLOT : TEAMS + 1 - MY_SLOT;
  myPicks.push((round - 1) * TEAMS + i);
}

console.log(`Mock board — slot ${MY_SLOT} of ${TEAMS}, ${SIMS} simulations, ${current} half-PPR ADP`);
console.log(`Your picks: ${myPicks.join(', ')}\n`);
for (let round = 0; round < ROUNDS; round++) {
  const rows = [...survival[round]]
    .map(([playerId, n]) => ({ ...meta.get(playerId), pct: Math.round((n / SIMS) * 100) }))
    .filter((r) => !EXCLUDED.has((r.team ?? '').toUpperCase()))
    .filter((r) => r.pct >= MIN_PCT)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, TOP);
  console.log(`R${round + 1} (pick ${myPicks[round]})`);
  for (const r of rows) {
    console.log(`   ${String(r.pct).padStart(3)}%  ${r.position.padEnd(3)} ${r.name.padEnd(24)} ADP ${r.adp.toFixed(1)}`);
  }
  console.log('');
}
