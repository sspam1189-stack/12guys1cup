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
// --never "manager:Player Name;manager:Player Name" encodes what you know that
// the boards do not: a manager who will not draft a particular player.
const neverFlag = process.argv.indexOf('--never');
const NEVER = new Map();
if (neverFlag !== -1) {
  for (const entry of process.argv[neverFlag + 1].split(';')) {
    const [who, player] = entry.split(':').map((x) => x.trim());
    if (!who || !player) continue;
    const key = who.toLowerCase();
    if (!NEVER.has(key)) NEVER.set(key, new Set());
    NEVER.get(key).add(player.toLowerCase());
  }
}
// --prefer "manager:Player Name" is the soft counterpart to --never: someone
// who rates a player well above where the market has him. A pull, not a rule.
const PREFER_PULL = 12;
const preferFlag = process.argv.indexOf('--prefer');
const PREFER = new Map();
if (preferFlag !== -1) {
  for (const entry of process.argv[preferFlag + 1].split(';')) {
    const [who, player, weight] = entry.split(':').map((x) => x.trim());
    if (!who || !player) continue;
    const key = who.toLowerCase();
    if (!PREFER.has(key)) PREFER.set(key, new Map());
    // Third field is how many picks of pull, so "likely" and "certain" differ.
    PREFER.get(key).set(player.toLowerCase(), Number(weight) || PREFER_PULL);
  }
}
// --rank "manager:Player A>Player B" says one manager has A above B on his own
// board. Only their order relative to each other changes: A is slotted just
// ahead of B's market price, so both still compete normally with everyone else.
const rankFlag = process.argv.indexOf('--rank');
const RANKS = new Map();
if (rankFlag !== -1) {
  for (const entry of process.argv[rankFlag + 1].split(';')) {
    const [who, pair] = entry.split(':').map((x) => x.trim());
    const [aboveName, belowName] = (pair ?? '').split('>').map((x) => x.trim());
    if (!who || !aboveName || !belowName) continue;
    const key = who.toLowerCase();
    if (!RANKS.has(key)) RANKS.set(key, []);
    RANKS.get(key).push([aboveName.toLowerCase(), belowName.toLowerCase()]);
  }
}
// --only "TE=George Kittle,Isaiah Likely" restricts your own board at a position
// to a named shortlist. Named players override --exclude-teams: if you asked for
// him by name, you want him whatever jersey he is in.
const onlyFlag = process.argv.indexOf('--only-players');
const ONLY_AT = new Map();
const NAMED = new Set();
if (onlyFlag !== -1) {
  for (const entry of process.argv[onlyFlag + 1].split(';')) {
    const [pos, list] = entry.split('=').map((x) => x.trim());
    if (!pos || !list) continue;
    const names = new Set(list.split(',').map((n) => n.trim().toLowerCase()));
    ONLY_AT.set(pos.toUpperCase(), names);
    for (const n of names) NAMED.add(n);
  }
}
// --my-rank "A>B>C" is your own board order for a group of players: whenever
// more than one is available you take them in this order, regardless of ADP.
const myRankFlag = process.argv.indexOf('--my-rank');
// Semicolons separate independent groups — one for backs, one for receivers.
const MY_RANK = myRankFlag === -1
  ? []
  : process.argv[myRankFlag + 1]
      .split(';')
      .map((group) => group.split('>').map((n) => n.trim().toLowerCase()))
      .filter((g) => g.length > 1);
// --avoid "Player, Player" removes players from your board only. Everyone else
// still drafts them, so they still come off the board at the usual time.
const avoidFlag = process.argv.indexOf('--avoid');
const AVOID = new Set(
  avoidFlag === -1 ? [] : process.argv[avoidFlag + 1].split(',').map((n) => n.trim().toLowerCase()),
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
  // How many of a position he takes in a typical draft. A mean of 1.33 was being
  // read as "still needs a second quarterback"; the median says one.
  const target = {};
  for (const pos of [...SKILL, 'K', 'DEF']) {
    target[pos] = median(drafts.map((d) => d.picks.filter((p) => position(p) === pos).length));
  }
  // Reach on a manager's very first pick is really a measure of his seat: the
  // best player left at pick 12 almost always has an ADP under 12, so a late
  // drafter looks like a bargain hunter no matter what he does. Drop that pick.
  const openingReach = {};
  for (const pos of SKILL) {
    const samples = [];
    for (const { season, picks } of drafts) {
      const first = picks.find((p) => position(p) === pos);
      if (!first || first.pick_no === picks[0].pick_no) continue;
      const adp = (await adpFor.get(season))?.[first.player_id]?.adp;
      if (adp != null && adp < ADP_CEILING) samples.push(adp - first.pick_no);
    }
    openingReach[pos] = samples.length ? median(samples) : 0;
  }

  // What they actually open with, which the reach numbers cannot tell you.
  // Uses every season on record, not just the recent window — which position a
  // manager reaches for first is a stable habit and three samples is too few.
  const openingCounts = {};
  let openingTotal = 0;
  for (const { picks } of history) {
    const own = picks.filter((p) => p.picked_by === user.user_id);
    if (!own.length) continue;
    const first = own.reduce((a, b) => (a.pick_no <= b.pick_no ? a : b));
    const pos = position(first);
    openingCounts[pos] = (openingCounts[pos] ?? 0) + 1;
    openingTotal += 1;
  }
  // When each position comes, not just how many. A manager who takes two backs
  // inside his first three picks and a manager who takes his second at pick 5
  // both finish with "some running backs"; only the schedule separates them.
  const schedule = {};
  for (const pos of SKILL) {
    const depth = Math.max(...drafts.map((d) => d.picks.filter((p) => position(p) === pos).length));
    schedule[pos] = [];
    for (let n = 0; n < depth; n++) {
      const at = drafts
        .map((d) => {
          const idx = d.picks
            .map((p, i) => (position(p) === pos ? i + 1 : null))
            .filter((x) => x != null);
          return idx[n] ?? null;
        })
        .filter((x) => x != null);
      schedule[pos].push(at.length ? median(at) : Infinity);
    }
  }

  let stackable = 0;
  let stacked = 0;
  for (const { picks } of drafts) {
    const qbTeams = picks.filter((p) => position(p) === 'QB').map((p) => p.metadata?.team);
    if (!qbTeams.length) continue;
    stackable += 1;
    if (picks.some((p) => ['WR', 'TE'].includes(position(p)) && qbTeams.includes(p.metadata?.team))) {
      stacked += 1;
    }
  }
  const stackRate = stackable ? stacked / stackable : 0;

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
    schedule,
    stackRate,
    openingCounts,
    openingTotal,
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

// Resolve each manager's re-rankings into an effective price for the players
// involved, once, rather than searching the board on every pick.
const adjustedAdp = new Map();
for (const [key, pairs] of RANKS) {
  const table = new Map();
  for (const [aboveName, belowName] of pairs) {
    const above = board.find((p) => p.name.toLowerCase() === aboveName);
    const below = board.find((p) => p.name.toLowerCase() === belowName);
    if (!above || !below) {
      console.error(`--rank: could not find ${!above ? aboveName : belowName} on the board`);
      continue;
    }
    table.set(above.playerId, Math.min(above.adp, below.adp - 0.5));
  }
  adjustedAdp.set(key, table);
}

// Price your ranked group as a tight sequence starting at the best ADP among
// them, so your order holds inside the group without moving it up the board.
const myPrice = new Map();
for (const group of MY_RANK) {
  const found = group.map((n) => board.find((p) => p.name.toLowerCase() === n)).filter(Boolean);
  if (!found.length) continue;
  const anchor = Math.min(...found.map((p) => p.adp));
  found.forEach((p, i) => myPrice.set(p.playerId, anchor + i * 0.01));
  const missing = group.filter((n) => !board.some((p) => p.name.toLowerCase() === n));
  if (missing.length) console.error(`--my-rank: not on the board — ${missing.join(', ')}`);
}

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

  // A position you have restricted to a couple of names does not behave like a
  // position: waiting for one of them to be the best player left is how you end
  // the draft without a tight end. Once the shortlist is down to its last man,
  // take him.
  for (const [pos, names] of ONLY_AT) {
    if (count(pos) >= MY_PLAN[pos]) continue;
    if (round < (EARLIEST[pos] ?? 1)) continue;
    const left = board.filter(
      (p) => available.has(p.playerId) && names.has(p.name.toLowerCase()) && !AVOID.has(p.name.toLowerCase()),
    );
    if (left.length && left.length <= 1) return left[0];
  }

  let best = null;
  let bestPrice = Infinity;
  for (const p of board) {
    if (!available.has(p.playerId)) continue;
    if (AVOID.has(p.name.toLowerCase())) continue;
    if (EXCLUDED.has((p.team ?? '').toUpperCase()) && !NAMED.has(p.name.toLowerCase())) continue;
    const shortlist = ONLY_AT.get(p.position);
    if (shortlist && !shortlist.has(p.name.toLowerCase())) continue;
    if (count(p.position) >= MY_PLAN[p.position]) continue;
    if (round < (EARLIEST[p.position] ?? 1)) continue;
    // Don't let a scarce single slot go unfilled by chasing depth to the end.
    const mustFillNow = ['QB', 'TE'].filter((pos) => count(pos) < MY_PLAN[pos]).length;
    if (mustFillNow > roundsLeft && !['QB', 'TE'].includes(p.position)) continue;
    const price = myPrice.get(p.playerId) ?? p.adp;
    if (price < bestPrice) {
      bestPrice = price;
      best = p;
    }
    // The board is ADP-ordered, so once we are past everything your ranking
    // could reprice, the first survivor is the answer.
    if (!myPrice.size) break;
    if (p.adp > bestPrice + 40) break;
  }
  if (best) return best;
  // Nothing passed the round gates — relax those, but never the plan itself.
  return (
    board.find(
      (p) =>
        available.has(p.playerId) &&
        !AVOID.has(p.name.toLowerCase()) &&
        (!EXCLUDED.has((p.team ?? '').toUpperCase()) || NAMED.has(p.name.toLowerCase())) &&
        !(ONLY_AT.get(p.position) && !ONLY_AT.get(p.position).has(p.name.toLowerCase())) &&
        count(p.position) < MY_PLAN[p.position],
    ) ?? null
  );
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
  const rosters = new Map(bySlot.slice(1).map((id) => [id, []])); // {position, team} per pick
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
      const count = (pos) => have.filter((p) => p.position === pos).length;
      const teamsAt = (...positions) =>
        have.filter((p) => positions.includes(p.position)).map((p) => p.team);

      // Kicker and defense come off habit, not off the market.
      const habitual = ['K', 'DEF'].find(
        (pos) => count(pos) < 1 && round >= Math.round(t.habitualRound[pos]),
      );
      if (habitual) {
        have.push({ position: habitual, team: '' });
        log.push({ round, slot, who: t.name, name: habitual, position: habitual, team: '' });
        continue;
      }

      // First pick of the draft: lean toward the position they habitually open
      // with. A bias, not a rule — nobody passes a clearly better player to
      // honour a habit, but a 4-of-5 running back opener does start there.
      const OPENING_PULL = 9; // picks of pull at a 100% habit
      const openingBias =
        !have.length && t.openingTotal
          ? (pos) => ((t.openingCounts[pos] ?? 0) / t.openingTotal) * OPENING_PULL
          : null;
      let best = null;
      let bestScore = Infinity;
      const refuses = NEVER.get(t.name.toLowerCase());
      const favours = PREFER.get(t.name.toLowerCase());
      const reranked = adjustedAdp.get(t.name.toLowerCase());
      for (const p of board) {
        if (!available.has(p.playerId)) continue;
        if (refuses?.has(p.name.toLowerCase())) continue;

        if (count(p.position) >= LIMITS[p.position]) continue;
        const short = t.target[p.position] - count(p.position);
        if (short <= 0) continue;
        // How overdue this position is on their own schedule, in picks.
        const dueAt = t.schedule[p.position]?.[count(p.position)] ?? Infinity;
        const timing = Number.isFinite(dueAt)
          ? Math.max(-6, Math.min(6, 6 - (dueAt - (have.length + 1)) * 1.5))
          : -6;
        const opening = count(p.position) === 0 ? t.openingReach[p.position] : 0;
        // Lower score = taken sooner. Reach pulls a player up the board.
        // Uncertainty grows down the board: nobody is unsure about the 1.01,
        // and everybody is guessing by round 12. Flat noise would make the top
        // of round 1 look like a lottery.
        const jitter = gauss() * Math.max(1.5, p.adp * 0.15);
        // Managers who habitually pair a quarterback with one of his receivers
        // reach for the other half once they own one.
        let stack = 0;
        {
          const mates =
            p.position === 'QB'
              ? teamsAt('WR', 'TE')
              : ['WR', 'TE'].includes(p.position)
                ? teamsAt('QB')
                : [];
          // Measured against the ~30% of stacks that happen by coincidence in any
          // draft, so a habitual stacker is pulled toward the pair and a manager
          // who never stacks is pushed off it.
          if (p.team && mates.includes(p.team)) stack = (t.stackRate - 0.3) * 26;
        }
        const favoured = favours?.get(p.name.toLowerCase()) ?? 0;
        const price = reranked?.get(p.playerId) ?? p.adp;
        const score =
          price - opening - timing - favoured - stack - (openingBias?.(p.position) ?? 0) + jitter;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) best = board.find((p) => available.has(p.playerId));
      if (best) {
        available.delete(best.playerId);
        have.push({ position: best.position, team: best.team ?? '' });
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
  const seat = new Map(); // overall pick -> the manager's draft seat, not its index in the round
  const allDrafts = [];
  for (let i = 0; i < CONSENSUS; i++) {
    const log = simulate(MY_SLOT).picksLog;
    allDrafts.push(log);
    for (const p of log) {
      const overall = (p.round - 1) * TEAMS + (p.round % 2 ? p.slot : TEAMS + 1 - p.slot);
      owner.set(overall, p.who);
      seat.set(overall, p.slot);
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
  // A per-cell marginal is not a draft: summed down a column it can hand a
  // manager four tight ends, and a manager who took a back in every simulation
  // can show a receiver. So display the single run that best matches the
  // consensus — every column is then a roster that really happened, and the
  // percentages beside it still come from all the runs.
  const score = (log) =>
    log.reduce((sum, p) => {
      const overall = (p.round - 1) * TEAMS + (p.round % 2 ? p.slot : TEAMS + 1 - p.slot);
      return sum + (tally.get(overall)?.get(`${p.position}|${p.name}|${p.team ?? ''}`) ?? 0);
    }, 0);
  const best = allDrafts.reduce((a, b) => (score(a) >= score(b) ? a : b));
  const chosen = new Map();
  for (const p of best) {
    const overall = (p.round - 1) * TEAMS + (p.round % 2 ? p.slot : TEAMS + 1 - p.slot);
    const label = `${p.position}|${p.name}|${p.team ?? ''}`;
    const ranked = [...(tally.get(overall) ?? new Map())].sort((x, y) => y[1] - x[1]);
    chosen.set(overall, { label, n: tally.get(overall)?.get(label) ?? 0, ranked });
  }
  const claimed = new Set();
  // Assign in order of confidence, not draft order. Going front-to-back lets an
  // early coin-flip pick claim a player a later high-confidence pick needed,
  // which is how a 60%-certain slot ends up showing a 2% name.
  if (process.argv.includes('--json')) {
    const out = [];
    for (let overall = 1; overall <= ROUNDS * TEAMS; overall++) {
      const c = chosen.get(overall);
      if (!c) continue;
      const [position, name, team] = c.label.split('|');
      out.push({
        overall,
        round: Math.ceil(overall / TEAMS),
        slot: seat.get(overall),
        who: owner.get(overall),
        position,
        name,
        team,
        pct: Math.round((c.n / CONSENSUS) * 100),
        alts: c.ranked.slice(1, 4).map(([l, n]) => ({
          name: l.split('|')[1],
          position: l.split('|')[0],
          pct: Math.round((n / CONSENSUS) * 100),
        })),
      });
    }
    console.log(JSON.stringify({ teams: TEAMS, rounds: ROUNDS, mySlot: MY_SLOT, sims: CONSENSUS, picks: out }));
    process.exit(0);
  }
  console.log(`Consensus board over ${CONSENSUS} simulated drafts — you at slot ${MY_SLOT}`);
  console.log('Each player appears once. % is how often he went at that pick.\n');
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

if (process.argv.includes('--audit')) {
  // Does the simulation reproduce the habits it was built from?
  const runs = SIMS;
  const tally = new Map();
  for (let i = 0; i < runs; i++) {
    const { picksLog } = simulate(MY_SLOT);
    const by = new Map();
    for (const p of picksLog) {
      if (!by.has(p.who)) by.set(p.who, []);
      by.get(p.who).push(p);
    }
    for (const [who, picks] of by) {
      if (!tally.has(who)) tally.set(who, { qb: [], te: [], rb: [], wr: [], stacked: 0, hadQb: 0 });
      const t = tally.get(who);
      const n = (pos) => picks.filter((x) => x.position === pos).length;
      t.qb.push(n('QB')); t.te.push(n('TE')); t.rb.push(n('RB')); t.wr.push(n('WR'));
      const qbTeams = picks.filter((x) => x.position === 'QB').map((x) => x.team);
      if (qbTeams.length) {
        t.hadQb += 1;
        if (picks.some((x) => ['WR', 'TE'].includes(x.position) && qbTeams.includes(x.team))) t.stacked += 1;
      }
    }
  }
  console.log(`Audit over ${runs} drafts — average roster, and how often a QB got stacked\n`);
  console.log('manager          QB   TE   RB   WR   stack rate');
  for (const [who, t] of tally) {
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    const sr = t.hadQb ? Math.round((t.stacked / t.hadQb) * 100) + '%' : '—';
    console.log(`${who.padEnd(15)} ${avg(t.qb).padStart(4)} ${avg(t.te).padStart(4)} ${avg(t.rb).padStart(4)} ${avg(t.wr).padStart(4)}   ${sr}`);
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
    .filter((r) => !EXCLUDED.has((r.team ?? '').toUpperCase()) || NAMED.has(r.name.toLowerCase()))
    .filter((r) => r.pct >= MIN_PCT)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, TOP);
  console.log(`R${round + 1} (pick ${myPicks[round]})`);
  for (const r of rows) {
    console.log(`   ${String(r.pct).padStart(3)}%  ${r.position.padEnd(3)} ${r.name.padEnd(24)} ADP ${r.adp.toFixed(1)}`);
  }
  console.log('');
}
