import { describe, it, expect } from 'vitest';
import { buildPowerRankings } from '../scripts/lib/power.mjs';

const seasons = [
  {
    season: '2030',
    champion: 'u1',
    runnerUp: 'u2',
    third: 'u3',
    lastPlace: 'u3',
    games: [
      { season: '2030', week: 1, type: 'regular', a: { userId: 'u1', points: 120 }, b: { userId: 'u2', points: 100 } },
      { season: '2030', week: 2, type: 'playoff', a: { userId: 'u2', points: 200 }, b: { userId: 'u1', points: 50 } },
      { season: '2030', week: 3, type: 'regular', a: { userId: 'u1', points: 95 }, b: { userId: 'u3', points: 95 } },
      { season: '2030', week: 4, type: 'shit bowl', a: { userId: 'u2', points: 110 }, b: { userId: 'u3', points: 70 } },
    ],
  },
  {
    season: '2031',
    notStarted: true,
    games: [
      { season: '2031', week: 1, type: 'regular', a: { userId: 'u2', points: 300 }, b: { userId: 'u1', points: 10 } },
    ],
  },
];

describe('buildPowerRankings', () => {
  it('builds Elo rankings from regular season with placement adjustments', () => {
    const rankings = buildPowerRankings(seasons);

    expect(rankings).toHaveLength(3);
    expect(rankings[0].userId).toBe('u1');
    expect(rankings.find((r) => r.userId === 'u1')).toMatchObject({ games: 2, wins: 1, ties: 1 });
    expect(rankings.find((r) => r.userId === 'u2')).toMatchObject({ games: 1, losses: 1 });
    expect(rankings.find((r) => r.userId === 'u1').postseasonAdjustment).toBe(20);
    expect(rankings.find((r) => r.userId === 'u2').postseasonAdjustment).toBe(5);
    expect(rankings.find((r) => r.userId === 'u3').postseasonAdjustment).toBe(-10);
  });
});
