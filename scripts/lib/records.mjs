const TOP_N = 5;

// One row per team per game: { userId, points, oppUserId, oppPoints, margin, won, season, week }
function performances(games) {
  return games.flatMap((g) => [
    { userId: g.a.userId, points: g.a.points, oppUserId: g.b.userId, oppPoints: g.b.points,
      margin: g.a.points - g.b.points, won: g.a.points > g.b.points, season: g.season, week: g.week },
    { userId: g.b.userId, points: g.b.points, oppUserId: g.a.userId, oppPoints: g.a.points,
      margin: g.b.points - g.a.points, won: g.b.points > g.a.points, season: g.season, week: g.week },
  ]);
}

function streaks(games, target) {
  const chron = [...games].sort((a, b) => a.season.localeCompare(b.season) || a.week - b.week);
  const seqs = {};
  for (const p of performances(chron)) {
    (seqs[p.userId] ??= []).push(p.margin === 0 ? 'T' : p.won ? 'W' : 'L');
  }
  return Object.entries(seqs)
    .map(([userId, seq]) => {
      let cur = 0, best = 0;
      for (const r of seq) { cur = r === target ? cur + 1 : 0; best = Math.max(best, cur); }
      return { userId, length: best };
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, TOP_N);
}

const top = (arr, cmp) => [...arr].sort(cmp).slice(0, TOP_N);

export function buildRecords(seasonSummaries) {
  const started = seasonSummaries.filter((s) => !s.notStarted);
  const reg = started.flatMap((s) => s.games.filter((g) => g.type === 'regular'));
  const po = started.flatMap((s) => s.games.filter((g) => g.type === 'playoff'));
  const rp = performances(reg);
  const seasonRows = started.flatMap((s) =>
    s.standings.map((t) => ({ season: s.season, userId: t.userId, wins: t.wins,
      losses: t.losses, ties: t.ties, pf: t.pf })));

  return {
    highestGame: top(rp, (a, b) => b.points - a.points),
    lowestGame: top(rp, (a, b) => a.points - b.points),
    biggestBlowout: top(rp.filter((p) => p.won), (a, b) => b.margin - a.margin),
    closestGame: top(rp.filter((p) => p.won), (a, b) => a.margin - b.margin),
    mostPointsInLoss: top(rp.filter((p) => !p.won && p.margin !== 0), (a, b) => b.points - a.points),
    fewestPointsInWin: top(rp.filter((p) => p.won), (a, b) => a.points - b.points),
    longestWinStreak: streaks(reg, 'W'),
    longestLossStreak: streaks(reg, 'L'),
    bestSeasons: top(seasonRows, (a, b) => b.wins - a.wins || b.pf - a.pf),
    worstSeasons: top(seasonRows, (a, b) => a.wins - b.wins || a.pf - b.pf),
    highestSeasonPf: top(seasonRows, (a, b) => b.pf - a.pf),
    playoffHighestGame: top(performances(po), (a, b) => b.points - a.points),
  };
}
