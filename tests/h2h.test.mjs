import { describe, it, expect } from 'vitest';
import { buildH2h } from '../scripts/lib/h2h.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const cells = buildH2h(summarizeSeason(season).games);

describe('buildH2h', () => {
  it('accumulates regular-season records per pairing (key sorted by userId)', () => {
    expect(cells['u1|u2'].regular).toEqual({ aWins: 1, bWins: 0, ties: 0 });
    expect(cells['u2|u3'].regular).toEqual({ aWins: 1, bWins: 0, ties: 0 });
  });

  it('keeps only regular-season games per pairing', () => {
    expect(cells['u1|u2'].games).toHaveLength(1);
    expect(cells['u1|u4'].games).toHaveLength(1);
    expect(cells['u1|u2'].games.every((g) => g.type === 'regular')).toBe(true);
  });

  it('has no cell for pairs that never met', () => {
    expect(cells['u1|u9']).toBeUndefined();
  });
});
