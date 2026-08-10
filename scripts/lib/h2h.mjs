export function buildH2h(allGames) {
  const cells = {};
  for (const g of allGames) {
    if (g.type !== 'regular') continue;
    const [x, y] = g.a.userId < g.b.userId ? [g.a, g.b] : [g.b, g.a];
    const key = `${x.userId}|${y.userId}`;
    const c = (cells[key] ??= {
      a: x.userId, b: y.userId,
      regular: { aWins: 0, bWins: 0, ties: 0 },
      games: [],
    });
    if (x.points > y.points) c.regular.aWins++;
    else if (y.points > x.points) c.regular.bWins++;
    else c.regular.ties++;
    c.games.push(g);
  }
  return cells;
}
