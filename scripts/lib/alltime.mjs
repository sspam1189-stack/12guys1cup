const round2 = (n) => Math.round(n * 100) / 100;

const legacyLastPlaceCounts = {
  // 2020 punishment victim.
  '467208097522249728': 1,
  // 2019 punishment victim.
  '596094153587216384': 1,
};

export function winPct(c) {
  const games = c.wins + c.losses + c.ties;
  return games ? (c.wins + c.ties / 2) / games : 0;
}

export function buildAlltime(seasonSummaries) {
  const careers = {};
  for (const s of seasonSummaries) {
    if (s.notStarted) continue;
    for (const t of s.standings) {
      const c = (careers[t.userId] ??= {
        userId: t.userId, seasons: 0, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
        playoffWins: 0, playoffLosses: 0, championships: 0, runnerUps: 0,
        thirds: 0, pfTitles: 0, playoffAppearances: 0, lastPlaces: 0, finishes: {},
      });
      c.seasons++;
      c.wins += t.wins; c.losses += t.losses; c.ties += t.ties;
      c.pf = round2(c.pf + t.pf); c.pa = round2(c.pa + t.pa);
      c.playoffWins += t.playoffWins; c.playoffLosses += t.playoffLosses;
      c.finishes[s.season] = t.place;
      if (s.champion === t.userId) c.championships++;
      if (s.runnerUp === t.userId) c.runnerUps++;
      if (s.third === t.userId) c.thirds++;
      if (s.pfChamp === t.userId) c.pfTitles++;
      if (s.lastPlace === t.userId) c.lastPlaces++;
      if (t.playoffWins + t.playoffLosses > 0) c.playoffAppearances++;
    }
  }
  for (const [userId, count] of Object.entries(legacyLastPlaceCounts)) {
    if (careers[userId]) careers[userId].lastPlaces += count;
  }
  for (const c of Object.values(careers)) {
    const finishes = Object.values(c.finishes);
    c.avgRegularSeasonRank = finishes.length
      ? round2(finishes.reduce((sum, place) => sum + place, 0) / finishes.length)
      : null;
    c.avgPf = c.seasons ? round2(c.pf / c.seasons) : 0;
    c.avgPa = c.seasons ? round2(c.pa / c.seasons) : 0;
  }
  return Object.values(careers).sort((a, b) => winPct(b) - winPct(a));
}
