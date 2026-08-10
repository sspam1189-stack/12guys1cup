import { pairWeek } from './matchups.mjs';
import { loadOwnerMap } from './identity.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export function summarizeSeason(raw, overrides = {}) {
  const { league, users, rosters, matchups } = raw;
  const season = league.season;
  if (league.status === 'pre_draft' || league.status === 'drafting') {
    return { season, name: league.name, notStarted: true };
  }

  const ownerMap = loadOwnerMap(rosters, overrides);
  const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const pws = league.settings.playoff_week_start;

  const teams = new Map();
  for (const [rosterId, userId] of ownerMap) {
    const u = usersById[userId];
    teams.set(rosterId, {
      userId, rosterId,
      teamName: u?.metadata?.team_name || u?.display_name || 'Unnamed',
      wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
      playoffWins: 0, playoffLosses: 0, place: null,
    });
  }

  const game = (week, type, ta, pa, tb, pb) => ({
    season, week, type,
    a: { userId: ta.userId, points: pa },
    b: { userId: tb.userId, points: pb },
  });
  const games = [];

  // Regular season: weeks 1 .. playoff_week_start - 1.
  for (let week = 1; week < pws; week++) {
    for (const { a, b } of pairWeek(matchups[week])) {
      if (!a.points && !b.points) continue; // unplayed (in-progress season)
      const ta = teams.get(a.roster_id);
      const tb = teams.get(b.roster_id);
      ta.pf += a.points; ta.pa += b.points;
      tb.pf += b.points; tb.pa += a.points;
      if (a.points > b.points) { ta.wins++; tb.losses++; }
      else if (b.points > a.points) { tb.wins++; ta.losses++; }
      else { ta.ties++; tb.ties++; }
      games.push(game(week, 'regular', ta, a.points, tb, b.points));
    }
  }
  for (const t of teams.values()) { t.pf = round2(t.pf); t.pa = round2(t.pa); }

  // Playoffs: winners-bracket games only. Round r plays in week pws + r - 1.
  for (const match of raw.winners_bracket ?? []) {
    if (typeof match.t1 !== 'number' || typeof match.t2 !== 'number' || match.w == null) continue;
    const week = pws + match.r - 1;
    const wanted = [match.t1, match.t2].sort().join();
    const pair = pairWeek(matchups[week]).find(
      ({ a, b }) => [a.roster_id, b.roster_id].sort().join() === wanted,
    );
    if (!pair) continue;
    const ta = teams.get(pair.a.roster_id);
    const tb = teams.get(pair.b.roster_id);
    if (pair.a.points > pair.b.points) { ta.playoffWins++; tb.playoffLosses++; }
    else { tb.playoffWins++; ta.playoffLosses++; }
    games.push(game(week, 'playoff', ta, pair.a.points, tb, pair.b.points));
  }

  // Placements. Winners bracket p:X → places X and X+1.
  // Losers bracket p:X → places playoff_teams + X and + X + 1.
  const nPlayoff = league.settings.playoff_teams;
  for (const m of raw.winners_bracket ?? []) {
    if (m.p != null && m.w != null && teams.has(m.w)) {
      teams.get(m.w).place = m.p;
      if (teams.has(m.l)) teams.get(m.l).place = m.p + 1;
    }
  }
  for (const m of raw.losers_bracket ?? []) {
    if (m.p != null && m.w != null && teams.has(m.w)) {
      teams.get(m.w).place = nPlayoff + m.p;
      if (teams.has(m.l)) teams.get(m.l).place = nPlayoff + m.p + 1;
    }
  }
  // Fallback for unplaced teams: by record, then PF, into remaining slots.
  const taken = new Set([...teams.values()].map((t) => t.place).filter((p) => p != null));
  const unplaced = [...teams.values()].filter((t) => t.place == null)
    .sort((x, y) => y.wins - x.wins || y.pf - x.pf);
  let next = 1;
  for (const t of unplaced) {
    while (taken.has(next)) next++;
    t.place = next;
    taken.add(next);
  }

  // Honors.
  const final = (raw.winners_bracket ?? []).find((m) => m.p === 1 && m.w != null);
  const champion = final ? teams.get(final.w)?.userId ?? null : null;
  const runnerUp = final ? teams.get(final.l)?.userId ?? null : null;
  const thirdMatch = (raw.winners_bracket ?? []).find((m) => m.p === 3 && m.w != null);
  const third = thirdMatch ? teams.get(thirdMatch.w)?.userId ?? null : null;
  const loserMatches = (raw.losers_bracket ?? []).filter((m) => m.p != null && m.w != null);
  const lastMatch = loserMatches.sort((a, b) => b.p - a.p)[0];
  const lastPlace = lastMatch
    ? teams.get(lastMatch.l)?.userId ?? null
    : [...teams.values()].sort((a, b) => b.place - a.place)[0]?.userId ?? null;
  const pfChamp = [...teams.values()].sort((a, b) => b.pf - a.pf)[0]?.userId ?? null;

  const draft = (raw.draft_picks ?? []).map((p) => ({
    round: p.round, pickNo: p.pick_no, slot: p.draft_slot,
    userId: p.picked_by || ownerMap.get(p.roster_id) || null,
    player: `${p.metadata?.first_name ?? ''} ${p.metadata?.last_name ?? ''}`.trim(),
    position: p.metadata?.position ?? '',
  }));

  return {
    season, name: league.name, playoffWeekStart: pws,
    standings: [...teams.values()].sort((a, b) => a.place - b.place),
    champion, runnerUp, third, pfChamp, lastPlace, games, draft,
  };
}
