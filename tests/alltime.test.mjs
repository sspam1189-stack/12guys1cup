import { describe, it, expect } from 'vitest';
import { buildAlltime } from '../scripts/lib/alltime.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

// Two identical seasons → doubled career stats, doubled honors.
const s1 = summarizeSeason(season);
const s2 = { ...summarizeSeason(season), season: '2031' };
const careers = buildAlltime([s1, s2, { season: '2032', notStarted: true }]);
const career = (id) => careers.find((c) => c.userId === id);

describe('buildAlltime', () => {
  it('sums careers across seasons and skips unstarted ones', () => {
    expect(career('u1')).toMatchObject({
      seasons: 2, wins: 6, losses: 0, pf: 660, championships: 2, pfTitles: 2,
      playoffAppearances: 2, lastPlaces: 0, playoffWins: 2, avgRegularSeasonRank: 1,
      avgPf: 330,
    });
    expect(career('u2')).toMatchObject({ runnerUps: 2, thirds: 0 });
    expect(career('u3')).toMatchObject({ lastPlaces: 2, playoffAppearances: 0 });
  });

  it('records year-by-year finishes', () => {
    expect(career('u4').finishes).toEqual({ 2030: 3, 2031: 3 });
    expect(career('u4').avgRegularSeasonRank).toBe(3);
  });

  it('sorts by win percentage descending', () => {
    expect(careers[0].userId).toBe('u1');
    expect(careers.at(-1).userId).toBe('u4');
  });
});
