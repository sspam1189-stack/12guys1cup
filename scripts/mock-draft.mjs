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
const SIMS = arg('--sims', 400);
const ADP_CEILING = 250;
const SKILL = ['QB', 'RB', 'WR', 'TE'];
// Sleeper's kicker and defense ADP is on its own scale, so those two are drafted
// off each manager's habitual round instead of off the market.
const LIMITS = { QB: 3, RB: 8, WR: 8, TE: 3, K: 2, DEF: 2 };

// Deterministic PRNG so a rerun with the same flags gives the same board.
let seed = 0x9e3779b9;
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
    openingReach[pos] = samples.length ? mean(samples) : 0;
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

const opponents = [...tendencies.keys()];

function simulate() {
  const shuffled = opponents.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Everyone except me, spread across the remaining slots.
  const bySlot = [];
  let k = 0;
  for (let slot = 1; slot <= TEAMS; slot++) {
    bySlot[slot] = slot === MY_SLOT ? 'ME' : shuffled[k++];
  }

  const available = new Set(board.map((p) => p.playerId));
  const rosters = new Map(bySlot.slice(1).map((id) => [id, []]));
  const availableAtMyPick = [];

  for (let round = 1; round <= ROUNDS; round++) {
    for (let i = 1; i <= TEAMS; i++) {
      const slot = round % 2 === 1 ? i : TEAMS + 1 - i;
      const id = bySlot[slot];
      if (id === 'ME') {
        availableAtMyPick.push(board.filter((p) => available.has(p.playerId)).slice(0, 40));
        // I take the best remaining skill player so the board keeps moving; the
        // recommendation is read off availability, not off this placeholder.
        const take = board.find((p) => available.has(p.playerId));
        if (take) available.delete(take.playerId);
        continue;
      }
      const t = tendencies.get(id);
      const have = rosters.get(id);
      const count = (pos) => have.filter((p) => p === pos).length;

      // Kicker and defense come off habit, not off the market.
      const habitual = ['K', 'DEF'].find(
        (pos) => count(pos) < 1 && round >= Math.round(t.habitualRound[pos]),
      );
      if (habitual) {
        have.push(habitual);
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
        const score = p.adp - opening - Math.min(short, 2) * 3 + gauss() * 7;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) best = board.find((p) => available.has(p.playerId));
      if (best) {
        available.delete(best.playerId);
        have.push(best.position);
      }
    }
  }
  return availableAtMyPick;
}

const survival = Array.from({ length: ROUNDS }, () => new Map());
for (let s = 0; s < SIMS; s++) {
  simulate().forEach((pool, round) => {
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
    .filter((r) => r.pct >= 25)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 8);
  console.log(`R${round + 1} (pick ${myPicks[round]})`);
  for (const r of rows) {
    console.log(`   ${String(r.pct).padStart(3)}%  ${r.position.padEnd(3)} ${r.name.padEnd(24)} ADP ${r.adp.toFixed(1)}`);
  }
  console.log('');
}
