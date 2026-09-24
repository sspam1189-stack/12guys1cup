import { pairWeek } from './matchups.mjs';
import { loadOwnerMap } from './identity.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export function summarizeSeason(raw, overrides = {}, players = {}) {
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
      wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, maxPf: 0, weekly: [],
      playoffWins: 0, playoffLosses: 0, place: null,
    });
  }

  const game = (week, type, ta, pa, tb, pb) => ({
    season, week, type,
    a: { userId: ta.userId, points: pa },
    b: { userId: tb.userId, points: pb },
  });
  const games = [];
  const bracketGame = (week, round, match, type, ta, pa, tb, pb, advancesRosterId) => ({
    season, week, round, match: match.m, placement: match.p ?? null, type, kind: 'game',
    advancesUserId: teams.get(advancesRosterId)?.userId ?? null,
    a: { userId: ta.userId, points: pa },
    b: { userId: tb.userId, points: pb },
  });
  const bracketBye = (week, round, match, side, type, rosterId) => ({
    season, week, round, match: `${match.m}-${side}`, placement: null, type, kind: 'bye',
    advancesUserId: teams.get(rosterId)?.userId ?? null,
    a: { userId: teams.get(rosterId)?.userId ?? null, points: null },
    b: { userId: null, points: null },
  });
  const bracketByes = (matches, type) => {
    const seen = new Set();
    const byes = [];
    for (const match of matches) {
      if (match.r <= 1) continue;
      for (const side of ['t1', 't2']) {
        const fromKey = `${side}_from`;
        const rosterId = match[side];
        if (typeof rosterId !== 'number' || match[fromKey] != null || !teams.has(rosterId)) continue;
        const round = match.r - 1;
        const key = `${type}-${round}-${rosterId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byes.push(bracketBye(pws + round - 1, round, match, side, type, rosterId));
      }
    }
    return byes;
  };

  const bracketPair = (match) => {
    if (typeof match.t1 !== 'number' || typeof match.t2 !== 'number') return null;
    const week = pws + match.r - 1;
    const wanted = [match.t1, match.t2].sort().join();
    return pairWeek(matchups[week]).find(
      ({ a, b }) => [a.roster_id, b.roster_id].sort().join() === wanted,
    ) ?? null;
  };

  const scoreOutcome = (match) => {
    const pair = bracketPair(match);
    if (!pair) return null;
    const better = pair.a.points >= pair.b.points ? pair.a : pair.b;
    const worse = pair.a.points >= pair.b.points ? pair.b : pair.a;
    return { betterRosterId: better.roster_id, worseRosterId: worse.roster_id };
  };

  // Max PF: what the roster would have scored with perfect hindsight. Fixed
  // slots take the best player at their position, then each flex takes the best
  // eligible player left. Greedy is optimal for this shape -- demoting a starter
  // to free him for a flex only lets the flex pick up the player you demoted --
  // and it answers the question the column is really asking, which is how much
  // was left on the bench.
  const FLEX_ELIGIBLE = {
    FLEX: ['RB', 'WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    IDP_FLEX: ['DL', 'LB', 'DB'],
  };
  // Mid-week, some games have been played and others have not, so the entries
  // carry partial scores. Counting those as a result gives every team a phantom
  // extra game at a fraction of its real total. Sleeper's `leg` is the week
  // currently being played, so a week is settled only once the league is past
  // it -- or once the season itself is over.
  const leg = league.settings.leg ?? 1;
  // `leg` is the safe signal but a slow one: Sleeper had not advanced it by the
  // Tuesday refresh after week 2, so a finished week sat out of the standings
  // until the next run two days later. Every team plays every week, so a week
  // where all twelve entries have scored is over whatever `leg` still says.
  const allScored = (week) => {
    const entries = matchups[week] ?? [];
    return entries.length > 0 && entries.every((e) => (e.points ?? 0) > 0);
  };
  // A week the league has not reached yet is never settled, whatever scores
  // happen to be sitting in it.
  const settled = (week) =>
    league.status === 'complete' || week < leg || (week === leg && allScored(week));

  const slots = (league.roster_positions ?? []).filter((s) => s !== 'BN' && s !== 'IR');
  const bestEleven = (entry) => {
    const pool = Object.entries(entry.players_points ?? {})
      .map(([pid, pts]) => ({ pid, pts: pts ?? 0, pos: players[pid]?.position ?? '' }))
      .sort((a, b) => b.pts - a.pts);
    const used = new Set();
    const picked = [];
    const take = (eligible) => {
      const pick = pool.find((p) => !used.has(p.pid) && eligible.includes(p.pos));
      if (!pick) return;
      used.add(pick.pid);
      picked.push(pick);
    };
    for (const slot of slots) if (!FLEX_ELIGIBLE[slot]) take([slot]);
    for (const slot of slots) if (FLEX_ELIGIBLE[slot]) take(FLEX_ELIGIBLE[slot]);
    return picked;
  };
  const bestLineup = (entry) => bestEleven(entry).reduce((a, b) => a + b.pts, 0);

  // Regular season: weeks 1 .. playoff_week_start - 1.
  for (let week = 1; week < pws; week++) {
    if (!settled(week)) continue;
    for (const entry of matchups[week] ?? []) {
      const t = teams.get(entry.roster_id);
      // Only weeks that were actually played; an unplayed week has no points
      // anywhere and would otherwise add a 0 that reads as a real result.
      if (!t || !Object.keys(entry.players_points ?? {}).length) continue;
      if (!entry.points && !Object.values(entry.players_points).some((v) => v)) continue;
      const max = bestLineup(entry);
      t.maxPf += max;
      t.weekly.push({ week, pf: round2(entry.points), maxPf: round2(max) });
    }
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
  for (const t of teams.values()) {
    t.pf = round2(t.pf);
    t.pa = round2(t.pa);
    t.maxPf = round2(t.maxPf);
  }

  // Playoffs: winners-bracket games only. Round r plays in week pws + r - 1.
  // Every playoff win counts, but only a team's first playoff loss counts.
  const playoffLostRosters = new Set();
  const winnerMatches = [...(raw.winners_bracket ?? [])].sort((a, b) => a.r - b.r || a.m - b.m);
  const playoffBracket = bracketByes(winnerMatches, 'playoff');
  for (const match of winnerMatches) {
    if (typeof match.t1 !== 'number' || typeof match.t2 !== 'number' || match.w == null) continue;
    const week = pws + match.r - 1;
    const pair = bracketPair(match);
    if (!pair) continue;
    const ta = teams.get(pair.a.roster_id);
    const tb = teams.get(pair.b.roster_id);
    if (pair.a.points > pair.b.points) {
      ta.playoffWins++;
      if (!playoffLostRosters.has(tb.rosterId)) {
        tb.playoffLosses++;
        playoffLostRosters.add(tb.rosterId);
      }
    } else {
      tb.playoffWins++;
      if (!playoffLostRosters.has(ta.rosterId)) {
        ta.playoffLosses++;
        playoffLostRosters.add(ta.rosterId);
      }
    }
    games.push(game(week, 'playoff', ta, pair.a.points, tb, pair.b.points));
    playoffBracket.push(bracketGame(week, match.r, match, 'playoff', ta, pair.a.points, tb, pair.b.points, pair.a.points > pair.b.points ? pair.a.roster_id : pair.b.roster_id));
  }

  // Shit Bowl / losers-bracket games are shown in weekly results, but do not
  // count toward playoff W-L.
  const loserMatches = [...(raw.losers_bracket ?? [])].sort((a, b) => a.r - b.r || a.m - b.m);
  const shitBowlBracket = bracketByes(loserMatches, 'shit bowl');
  for (const match of loserMatches) {
    if (typeof match.t1 !== 'number' || typeof match.t2 !== 'number' || match.w == null) continue;
    const week = pws + match.r - 1;
    const pair = bracketPair(match);
    if (!pair) continue;
    const ta = teams.get(pair.a.roster_id);
    const tb = teams.get(pair.b.roster_id);
    games.push(game(week, 'shit bowl', ta, pair.a.points, tb, pair.b.points));
    shitBowlBracket.push(bracketGame(week, match.r, match, 'shit bowl', ta, pair.a.points, tb, pair.b.points, pair.a.points < pair.b.points ? pair.a.roster_id : pair.b.roster_id));
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
  const decided = league.status === 'complete';
  const final = (raw.winners_bracket ?? []).find((m) => m.p === 1 && m.w != null);
  const champion = decided && final ? teams.get(final.w)?.userId ?? null : null;
  const runnerUp = decided && final ? teams.get(final.l)?.userId ?? null : null;
  const thirdMatch = (raw.winners_bracket ?? []).find((m) => m.p === 3 && m.w != null);
  const third = decided && thirdMatch ? teams.get(thirdMatch.w)?.userId ?? null : null;
  const lastPlaceMatches = (raw.losers_bracket ?? []).filter((m) => m.p === 1);
  const lastMatch = lastPlaceMatches.sort((a, b) => b.r - a.r || b.m - a.m)[0];
  const lastPlaceRosterId = lastMatch
    ? (scoreOutcome(lastMatch)?.worseRosterId ?? lastMatch.w)
    : null;
  // Honors are end-of-season awards, so they only exist once the season is over.
  // A league flips to in_season the moment the draft ends and stays there until
  // the final is played, so mid-season these would be standings dressed up as
  // trophies -- a week-3 points leader shown as "PF champ", or whoever happens
  // to sit last shown as the shit-bowl loser. Withhold all of them until the
  // league reports complete.
  const inProgress = league.status !== 'complete';
  const lastPlace = inProgress
    ? null
    : lastPlaceRosterId
      ? teams.get(lastPlaceRosterId)?.userId ?? null
      : [...teams.values()].sort((a, b) => b.place - a.place)[0]?.userId ?? null;
  const pfChamp = inProgress
    ? null
    : [...teams.values()].sort((a, b) => b.pf - a.pf)[0]?.userId ?? null;

  const draft = (raw.draft_picks ?? []).map((p) => ({
    round: p.round, pickNo: p.pick_no, slot: p.draft_slot,
    userId: p.picked_by || ownerMap.get(p.roster_id) || null,
    player: `${p.metadata?.first_name ?? ''} ${p.metadata?.last_name ?? ''}`.trim(),
    position: p.metadata?.position ?? '',
  }));
  // A recap per played week: who won, who scored, and the two facts a box score
  // hides -- who wasted a big week through their lineup, and who could not have
  // done anything differently. Lineup efficiency is actual over the best legal
  // lineup, which is why max PF is computed above.
  const nameOf = (pid) => players[pid]?.name ?? pid;
  const posOf = (pid) => players[pid]?.position ?? '';
  const recaps = [];
  for (let week = 1; week < pws; week++) {
    if (!settled(week)) continue;
    const entries = matchups[week] ?? [];
    const played = entries.filter((e) => Object.values(e.players_points ?? {}).some((v) => v));
    if (played.length < 2) continue;

    const results = [];
    for (const { a, b } of pairWeek(entries)) {
      if (!a.points && !b.points) continue;
      const ta = teams.get(a.roster_id);
      const tb = teams.get(b.roster_id);
      if (!ta || !tb) continue;
      const aWon = a.points >= b.points;
      const [w, l] = aWon ? [[ta, a], [tb, b]] : [[tb, b], [ta, a]];
      results.push({
        winner: { userId: w[0].userId, teamName: w[0].teamName, points: round2(w[1].points) },
        loser: { userId: l[0].userId, teamName: l[0].teamName, points: round2(l[1].points) },
        margin: round2(Math.abs(a.points - b.points)),
      });
    }
    if (!results.length) continue;
    results.sort((x, y) => y.winner.points - x.winner.points);

    const starters = [];
    const benched = [];
    const eff = [];
    for (const e of played) {
      const t = teams.get(e.roster_id);
      if (!t) continue;
      const lineup = new Set(e.starters ?? []);
      for (const [pid, pts] of Object.entries(e.players_points ?? {})) {
        const row = { pid, name: nameOf(pid), pos: posOf(pid), points: round2(pts ?? 0), userId: t.userId, teamName: t.teamName };
        (lineup.has(pid) ? starters : benched).push(row);
      }
      const max = bestEleven(e).reduce((acc, p) => acc + p.pts, 0);
      if (max > 0) {
        eff.push({ userId: t.userId, teamName: t.teamName, points: round2(e.points), max: round2(max), pct: round2((e.points / max) * 100) });
      }
    }
    starters.sort((a, b) => b.points - a.points);
    benched.sort((a, b) => b.points - a.points);
    eff.sort((a, b) => b.pct - a.pct);

    // A bench mistake only counts when starting the player would have changed
    // the result -- otherwise it is trivia, not a mistake.
    const lostBy = {};
    for (const r of results) lostBy[r.loser.userId] = r.margin;
    const costly = benched.find((b) => lostBy[b.userId] != null && b.points > lostBy[b.userId]);

    recaps.push({
      week,
      results,
      topStarters: starters.slice(0, 5),
      mostEfficient: eff[0] ?? null,
      leastEfficient: eff[eff.length - 1] ?? null,
      benchMistake: costly ? { ...costly, lostBy: lostBy[costly.userId] } : null,
      high: results[0] ? results[0].winner : null,
      low: [...results].sort((a, b) => a.loser.points - b.loser.points)[0]?.loser ?? null,
      blowout: [...results].sort((a, b) => b.margin - a.margin)[0] ?? null,
      nailbiter: [...results].sort((a, b) => a.margin - b.margin)[0] ?? null,
    });
  }
  recaps.reverse();   // newest first, which is how the page reads it

  // This week's head-to-head slate, for a season still being played. Scores are
  // whatever Sleeper has so far -- zeros before kickoff, live totals during the
  // week -- so the page shows the pairings either way rather than waiting for
  // final results to land in `games`.
  const currentWeek = league.settings.leg ?? null;
  const thisWeek =
    inProgress && currentWeek
      ? pairWeek(matchups[currentWeek]).map(({ a, b }) => {
          const ta = teams.get(a.roster_id);
          const tb = teams.get(b.roster_id);
          return {
            week: currentWeek,
            type: currentWeek >= pws ? 'playoff' : 'regular',
            a: { userId: ta?.userId ?? null, teamName: ta?.teamName ?? null, points: a.points ?? 0 },
            b: { userId: tb?.userId ?? null, teamName: tb?.teamName ?? null, points: b.points ?? 0 },
          };
        })
      : [];

  const placeByUserId = Object.fromEntries([...teams.values()].map((t) => [t.userId, t.place]));
  const bracketSort = (a, b) =>
    a.round - b.round
    || (a.round === 1 ? (a.kind === 'bye' ? 0 : 1) - (b.kind === 'bye' ? 0 : 1) : 0)
    || (placeByUserId[a.a.userId] ?? 999) - (placeByUserId[b.a.userId] ?? 999)
    || String(a.match).localeCompare(String(b.match));

  return {
    season, name: league.name, playoffWeekStart: pws, inProgress,
    currentWeek, thisWeek, recaps,
    standings: [...teams.values()].sort((a, b) => a.place - b.place),
    champion, runnerUp, third, pfChamp, lastPlace, games,
    playoffBracket: playoffBracket.sort(bracketSort),
    shitBowlBracket: shitBowlBracket.sort(bracketSort),
    draft,
  };
}
