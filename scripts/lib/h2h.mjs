export function buildH2h(allGames) {
  const cells = {};
  for (const g of allGames) {
    const [x, y] = g.a.userId < g.b.userId ? [g.a, g.b] : [g.b, g.a];
    const key = `${x.userId}|${y.userId}`;
    const c = (cells[key] ??= {
      a: x.userId, b: y.userId,
      regular: { aWins: 0, bWins: 0, ties: 0 },
      playoff: { aWins: 0, bWins: 0, ties: 0 },
      games: [],
    });
    const bucket = g.type === 'regular' ? c.regular : c.playoff;
    if (x.points > y.points) bucket.aWins++;
    else if (y.points > x.points) bucket.bWins++;
    else bucket.ties++;
    c.games.push(g);
  }
  return cells;
}
