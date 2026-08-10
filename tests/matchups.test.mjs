import { describe, it, expect } from 'vitest';
import { pairWeek } from '../scripts/lib/matchups.mjs';
import { season } from './fixtures/mini-league.mjs';

describe('pairWeek', () => {
  it('pairs entries by matchup_id', () => {
    const pairs = pairWeek(season.matchups[1]);
    expect(pairs).toHaveLength(2);
    const first = pairs.find((p) => p.a.matchup_id === 1);
    expect([first.a.roster_id, first.b.roster_id].sort()).toEqual([1, 2]);
  });

  it('skips null matchup ids and unpaired entries', () => {
    expect(pairWeek([
      { matchup_id: null, roster_id: 1, points: 10 },
      { matchup_id: 7, roster_id: 2, points: 20 },
    ])).toEqual([]);
  });

  it('returns [] for empty or missing input', () => {
    expect(pairWeek([])).toEqual([]);
    expect(pairWeek(null)).toEqual([]);
  });
});
