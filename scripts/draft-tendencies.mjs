// Draft tendency scouting report — profiles every manager in the newest season
// off their historical draft boards, so you know what the room does before you
// are on the clock. Prints markdown to stdout:
//   node scripts/draft-tendencies.mjs > docs/draft-tendencies.md
import { readdir, readFile } from 'node:fs/promises';
import { buildMembers } from './lib/identity.mjs';

const RAW = new URL('../data/raw/', import.meta.url);
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
const at = (season, file) => new URL(`${season}/${file}.json`, RAW);

const RECENT_WINDOW = 3; // seasons of history that count as "current meta"
const POS_LETTER = { QB: 'Q', RB: 'R', WR: 'W', TE: 'T', K: 'K', DEF: 'D' };
const NEVER_ROUND = 16; // stand-in round when a manager never took the position

const seasons = (await readdir(RAW)).filter((d) => /^\d{4}$/.test(d)).sort();
const current = seasons.at(-1);
const drafted = [];
for (const season of seasons) {
  const picks = await readJson(at(season, 'draft_picks'));
  if (picks.length) drafted.push(season);
}
const recent = drafted.slice(-RECENT_WINDOW);

const members = buildMembers(
  await Promise.all(
    seasons.map(async (season) => ({
      season,
      users: await readJson(at(season, 'users')),
      rosters: await readJson(at(season, 'rosters')),
    })),
  ),
);
const nameOf = (userId) => members[userId]?.name ?? userId;
const roster = (await readJson(at(current, 'users'))).map((u) => u.user_id);

// Sleeper's half-PPR ADP, where we have a snapshot for the season. 999 is its
// "nobody drafted him" sentinel, and kicker/defense ADP runs on a scale of its
// own, so both are excluded rather than allowed to invent enormous reaches.
const ADP_CEILING = 250;
const NO_ADP_POSITIONS = new Set(['K', 'DEF']);
const adpBySeason = {};
for (const season of drafted) {
  try {
    adpBySeason[season] = await readJson(new URL(`adp/${season}.json`, RAW));
  } catch {
    adpBySeason[season] = null;
  }
}
const adpOf = (season, pick) => {
  if (NO_ADP_POSITIONS.has(position(pick))) return null;
  const value = adpBySeason[season]?.[pick.player_id]?.adp;
  return value == null || value >= ADP_CEILING ? null : value;
};
// Positive = taken ahead of the market.
const reachOf = (season, pick) => {
  const adp = adpOf(season, pick);
  return adp == null ? null : adp - pick.pick_no;
};

const picksBySeason = {};
const pointsBySeason = {};
for (const season of drafted) {
  picksBySeason[season] = (await readJson(at(season, 'draft_picks')))
    .slice()
    .sort((a, b) => a.pick_no - b.pick_no);

  // Season-long fantasy points, summed over every week the player was rostered.
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
  pointsBySeason[season] = totals;
}

const position = (pick) => pick.metadata?.position ?? '?';
const nflTeam = (pick) => pick.metadata?.team || 'FA';
const playerName = (pick) =>
  `${pick.metadata?.first_name ?? ''} ${pick.metadata?.last_name ?? ''}`.trim();
// Defenses report years_exp as an empty string, which would otherwise coerce to 0.
const rookie = (pick) => /^\d+$/.test(pick.metadata?.years_exp ?? '') && Number(pick.metadata.years_exp) === 0;
const points = (season, pick) => pointsBySeason[season].get(pick.player_id) ?? 0;

// A pick is judged against the players taken at the same position around it, so
// late-round quarterbacks are not credited for simply outscoring running backs.
const residualByPick = new Map();
for (const season of drafted) {
  const byPosition = new Map();
  for (const pick of picksBySeason[season]) {
    if (!byPosition.has(position(pick))) byPosition.set(position(pick), []);
    byPosition.get(position(pick)).push(pick);
  }
  for (const group of byPosition.values()) {
    const scored = group.map((pick) => points(season, pick));
    group.forEach((pick, i) => {
      const window = scored.slice(Math.max(0, i - 2), i + 3);
      const par = window.reduce((a, b) => a + b, 0) / window.length;
      residualByPick.set(`${season}:${pick.pick_no}`, scored[i] - par);
    });
  }
}

const boards = new Map(); // userId -> season -> picks in pick order
for (const season of drafted) {
  for (const pick of picksBySeason[season]) {
    if (!boards.has(pick.picked_by)) boards.set(pick.picked_by, new Map());
    const seasonsFor = boards.get(pick.picked_by);
    if (!seasonsFor.has(season)) seasonsFor.set(season, []);
    seasonsFor.get(season).push(pick);
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const tally = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};

function profile(userId) {
  const seasonsFor = boards.get(userId) ?? new Map();
  const drafts = drafted.filter((s) => seasonsFor.has(s));
  const recentDrafts = recent.filter((s) => seasonsFor.has(s));
  const recentPicks = recentDrafts.flatMap((s) => seasonsFor.get(s));

  const firstRoundAt = (pos) =>
    mean(
      recentDrafts.map(
        (s) => seasonsFor.get(s).find((p) => position(p) === pos)?.round ?? NEVER_ROUND,
      ),
    );

  const stacks = [];
  const rbPairs = [];
  for (const season of recentDrafts) {
    const byTeam = new Map();
    for (const pick of seasonsFor.get(season)) {
      if (!byTeam.has(nflTeam(pick))) byTeam.set(nflTeam(pick), []);
      byTeam.get(nflTeam(pick)).push(position(pick));
    }
    for (const [team, positions] of byTeam) {
      const has = (p) => positions.includes(p);
      if (has('QB') && (has('WR') || has('TE'))) stacks.push(`${season} ${team}`);
      if (positions.filter((p) => p === 'RB').length >= 2) rbPairs.push(`${season} ${team}`);
    }
  }

  // Reach against the market, and specifically how early they open at each
  // position — the first quarterback tells you more than their tenth pick does.
  const reaches = recentDrafts.flatMap((s) =>
    seasonsFor.get(s).map((pick) => reachOf(s, pick)).filter((r) => r != null),
  );
  const openingSamples = Object.fromEntries(
    ['QB', 'RB', 'WR', 'TE'].map((pos) => [
      pos,
      recentDrafts
        .map((s) => {
          const first = seasonsFor.get(s).find((p) => position(p) === pos);
          return first ? reachOf(s, first) : null;
        })
        .filter((r) => r != null),
    ]),
  );
  const openingReach = Object.fromEntries(
    Object.entries(openingSamples).map(([pos, xs]) => [pos, xs.length ? mean(xs) : null]),
  );

  const graded = recentDrafts.flatMap((s) =>
    seasonsFor.get(s).map((pick) => ({
      pick,
      season: s,
      residual: residualByPick.get(`${s}:${pick.pick_no}`) ?? 0,
    })),
  );
  graded.sort((a, b) => a.residual - b.residual);
  const early = graded.filter((g) => g.pick.round <= 6);

  return {
    userId,
    name: nameOf(userId),
    drafts,
    recentDrafts,
    slots: Object.fromEntries(drafts.map((s) => [s, seasonsFor.get(s)[0].draft_slot])),
    openers: drafts.map((s) => [
      s,
      seasonsFor
        .get(s)
        .slice(0, 6)
        .map((p) => POS_LETTER[position(p)] ?? '?')
        .join(''),
    ]),
    perDraft: Object.fromEntries(
      ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((pos) => [
        pos,
        (recentPicks.filter((p) => position(p) === pos).length / (recentDrafts.length || 1)).toFixed(1),
      ]),
    ),
    firstQb: firstRoundAt('QB'),
    firstTe: firstRoundAt('TE'),
    firstK: firstRoundAt('K'),
    firstDef: firstRoundAt('DEF'),
    rookies: recentPicks.filter(rookie),
    favoriteTeams: tally(recentPicks.map(nflTeam)).slice(0, 3),
    stacks,
    rbPairs,
    reach: reaches.length ? mean(reaches) : null,
    openingSamples,
    openingReach,
    value: mean(graded.map((g) => g.residual)),
    earlyHitRate: pct(early.filter((g) => g.residual > 0).length, early.length),
    bestPick: graded.at(-1),
    worstPick: graded[0],
  };
}

const profiles = roster.map(profile).sort((a, b) => b.value - a.value);

const describe = (g) =>
  g ? `${g.season} R${g.pick.round} ${playerName(g.pick)} (${position(g.pick)})` : '—';
const out = [];
const say = (line = '') => out.push(line);

say(`# Draft tendencies — ${current} field`);
say();
say(
  `Generated from ${drafted[0]}–${drafted.at(-1)} draft boards. Rate stats cover ` +
    `${recent[0]}–${recent.at(-1)} (the ${(await readJson(at(current, 'draft'))).settings.teams}-team era).`,
);
say();

say('## League baselines');
say();
say('| Season | Round 1 | 1st QB | 1st TE | 1st K | 1st DEF |');
say('| --- | --- | --- | --- | --- | --- |');
for (const season of drafted) {
  const board = picksBySeason[season];
  const round1 = tally(board.filter((p) => p.round === 1).map(position))
    .map(([pos, n]) => `${n} ${pos}`)
    .join(', ');
  const firstOf = (pos) => board.find((p) => position(p) === pos);
  say(
    `| ${season} | ${round1} | pick ${firstOf('QB')?.pick_no ?? '—'} | pick ${
      firstOf('TE')?.pick_no ?? '—'
    } | R${firstOf('K')?.round ?? '—'} | R${firstOf('DEF')?.round ?? '—'} |`,
  );
}
say();

const signed = (n, digits = 1) => (n >= 0 ? '+' : '') + n.toFixed(digits);

const withAdp = drafted.filter((s) => adpBySeason[s]);
if (withAdp.length) {
  say('## Where the room sits against the market');
  say();
  say(
    `Half-PPR ADP from Sleeper, ${withAdp[0]}–${withAdp.at(-1)}. Positive means the room ` +
      'opens at that position ahead of ADP; negative means it waits past the market.',
  );
  say();
  say('| Position | League avg on its first pick there |');
  say('| --- | --- |');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const all = profiles.flatMap((p) => p.openingSamples[pos]);
    say(`| ${pos} | ${signed(mean(all))} picks (n=${all.length}) |`);
  }
  say();
}

say('## Manager profiles');
say();
say('| Manager | Drafts | Opening 6 (most recent) | Per draft | 1st QB | 1st TE | 1st K | Rookies | Reach | Value/pick |');
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const p of profiles) {
  const mix = `${p.perDraft.RB} RB / ${p.perDraft.WR} WR / ${p.perDraft.QB} QB / ${p.perDraft.TE} TE`;
  say(
    `| ${p.name} | ${p.drafts.length} | ${p.openers.at(-1)[1]} | ${mix} | R${p.firstQb.toFixed(
      1,
    )} | R${p.firstTe.toFixed(1)} | R${p.firstK.toFixed(1)} | ${p.rookies.length} | ${
      p.reach == null ? '—' : signed(p.reach)
    } | ${signed(p.value)} |`,
  );
}
say();
say('Opening-6 letters: R=RB, W=WR, Q=QB, T=TE. "1st X" is the average round the');
say('manager first takes that position (16 means they skipped it). Reach is picks');
say('ahead of half-PPR ADP, averaged over skill-position picks — positive means');
say('they pay above market. Value/pick is points above or below the players taken');
say('at the same position nearby.');
say();

for (const p of profiles) {
  say(`### ${p.name}`);
  say();
  say(`- Draft slots: ${p.drafts.map((s) => `${s} #${p.slots[s]}`).join(', ')}`);
  say(`- Openers: ${p.openers.map(([s, o]) => `${s} ${o}`).join(' · ')}`);
  say(
    `- Timing: QB R${p.firstQb.toFixed(1)}, TE R${p.firstTe.toFixed(1)}, K R${p.firstK.toFixed(
      1,
    )}, DEF R${p.firstDef.toFixed(1)}`,
  );
  say(
    `- Rookies taken: ${p.rookies.length}${
      p.rookies.length
        ? ` (earliest R${Math.min(...p.rookies.map((r) => r.round))} ${
            playerName(p.rookies.reduce((a, b) => (a.round <= b.round ? a : b)))
          })`
        : ''
    }`,
  );
  if (p.reach != null) {
    const opening = ['QB', 'RB', 'WR', 'TE']
      .filter((pos) => p.openingReach[pos] != null)
      .map((pos) => `${pos} ${signed(p.openingReach[pos])}`)
      .join(', ');
    say(`- Vs ADP: ${signed(p.reach)} per pick · on their first at each position — ${opening}`);
  }
  say(`- Favorite NFL teams: ${p.favoriteTeams.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
  say(`- Stacks: ${p.stacks.join(', ') || 'none'} · RB pairs: ${p.rbPairs.join(', ') || 'none'}`);
  say(
    `- Value/pick ${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}, ${p.earlyHitRate}% of R1–6 picks beat par`,
  );
  say(`- Best: ${describe(p.bestPick)} · Worst: ${describe(p.worstPick)}`);
  say();
}

console.log(out.join('\n'));
