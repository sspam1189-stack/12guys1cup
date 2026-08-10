const START_RATING = 1500;
const K = 24;
const CHAMPION_BONUS = 20;
const RUNNER_UP_BONUS = 10;
const THIRD_PLACE_BONUS = 5;
const SHIT_BOWL_FINALIST_PENALTY = -5;
const LAST_PLACE_PENALTY = -15;

const round1 = (n) => Math.round(n * 10) / 10;

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

function gameScore(pointsFor, pointsAgainst) {
  if (pointsFor > pointsAgainst) return 1;
  if (pointsFor < pointsAgainst) return 0;
  return 0.5;
}

function marginMultiplier(pointsFor, pointsAgainst) {
  const margin = Math.abs(pointsFor - pointsAgainst);
  return Math.min(1.8, 1 + Math.log1p(margin) / 10);
}

function getRating(ratings, userId) {
  return ratings[userId] ?? START_RATING;
}

function getRow(rows, userId) {
  return (rows[userId] ??= {
    userId,
    rating: START_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    lastWeekChange: 0,
    postseasonAdjustment: 0,
    peakRating: START_RATING,
  });
}

function applyPostseasonAdjustments(seasonSummaries, rows) {
  for (const s of seasonSummaries.filter((season) => !season.notStarted)) {
    if (s.champion) getRow(rows, s.champion).postseasonAdjustment += CHAMPION_BONUS;
    if (s.runnerUp) getRow(rows, s.runnerUp).postseasonAdjustment += RUNNER_UP_BONUS;
    if (s.third) getRow(rows, s.third).postseasonAdjustment += THIRD_PLACE_BONUS;

    const finalShitBowl = (s.games ?? [])
      .filter((g) => g.type === 'shit bowl')
      .sort((a, b) => b.week - a.week)[0];
    if (finalShitBowl) {
      const lastUserId = s.lastPlace;
      const aPenalty = finalShitBowl.a.userId === lastUserId ? LAST_PLACE_PENALTY : SHIT_BOWL_FINALIST_PENALTY;
      const bPenalty = finalShitBowl.b.userId === lastUserId ? LAST_PLACE_PENALTY : SHIT_BOWL_FINALIST_PENALTY;
      getRow(rows, finalShitBowl.a.userId).postseasonAdjustment += aPenalty;
      getRow(rows, finalShitBowl.b.userId).postseasonAdjustment += bPenalty;
    }
  }
}

export function buildPowerRankings(seasonSummaries) {
  const ratings = {};
  const rows = {};
  const games = seasonSummaries
    .filter((s) => !s.notStarted)
    .flatMap((s) => (s.games ?? []).filter((g) => g.type === 'regular'))
    .sort((a, b) => a.season.localeCompare(b.season) || a.week - b.week);

  for (const g of games) {
    const a = getRow(rows, g.a.userId);
    const b = getRow(rows, g.b.userId);
    const ratingA = getRating(ratings, a.userId);
    const ratingB = getRating(ratings, b.userId);
    const scoreA = gameScore(g.a.points, g.b.points);
    const scoreB = 1 - scoreA;
    const multiplier = marginMultiplier(g.a.points, g.b.points);
    const changeA = K * multiplier * (scoreA - expectedScore(ratingA, ratingB));
    const changeB = K * multiplier * (scoreB - expectedScore(ratingB, ratingA));

    ratings[a.userId] = ratingA + changeA;
    ratings[b.userId] = ratingB + changeB;

    a.games++;
    b.games++;
    if (scoreA === 1) {
      a.wins++;
      b.losses++;
    } else if (scoreA === 0) {
      a.losses++;
      b.wins++;
    } else {
      a.ties++;
      b.ties++;
    }
    a.lastWeekChange = changeA;
    b.lastWeekChange = changeB;
    a.peakRating = Math.max(a.peakRating, ratings[a.userId]);
    b.peakRating = Math.max(b.peakRating, ratings[b.userId]);
  }

  applyPostseasonAdjustments(seasonSummaries, rows);

  return Object.values(rows)
    .map((row) => {
      const baseRating = ratings[row.userId] ?? START_RATING;
      return {
        ...row,
        baseRating: round1(baseRating),
        rating: round1(baseRating + row.postseasonAdjustment),
        postseasonAdjustment: round1(row.postseasonAdjustment),
        lastWeekChange: round1(row.lastWeekChange),
        peakRating: round1(Math.max(row.peakRating, baseRating + row.postseasonAdjustment)),
      };
    })
    .sort((a, b) => b.rating - a.rating);
}
