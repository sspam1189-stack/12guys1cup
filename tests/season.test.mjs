import { describe, it, expect } from 'vitest';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const summary = summarizeSeason(season);
const team = (userId) => summary.standings.find((t) => t.userId === userId);

describe('summarizeSeason', () => {
  it('computes regular-season records and points (playoffs excluded)', () => {
    expect(team('u1')).toMatchObject({ wins: 3, losses: 0, pf: 330, pa: 200 });
    expect(team('u2')).toMatchObject({ wins: 2, losses: 1, pf: 273 });
    expect(team('u4')).toMatchObject({ wins: 0, losses: 3, pf: 205 });
  });

  it('tracks playoff wins separately (winners bracket only)', () => {
    expect(team('u1')).toMatchObject({ playoffWins: 1, playoffLosses: 0 });
    expect(team('u2')).toMatchObject({ playoffWins: 0, playoffLosses: 1 });
    expect(team('u3')).toMatchObject({ playoffWins: 0, playoffLosses: 0 }); // toilet bowl doesn't count
  });

  it('awards honors: champion, runner-up, PF champ, last place', () => {
    expect(summary.champion).toBe('u1');
    expect(summary.runnerUp).toBe('u2');
    expect(summary.pfChamp).toBe('u1');
    expect(summary.lastPlace).toBe('u3'); // lost toilet bowl despite better record than u4
  });

  it('third place comes only from a winners-bracket 3rd-place game', () => {
    // Fixture has a 2-team playoff — no 3rd-place game, so no third honor.
    expect(summary.third).toBeNull();
    const withThird = summarizeSeason({
      ...season,
      winners_bracket: [
        ...season.winners_bracket,
        { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4, p: 3 },
      ],
    });
    expect(withThird.third).toBe('u3');
  });

  it('assigns final placements from brackets', () => {
    expect(team('u1').place).toBe(1);
    expect(team('u2').place).toBe(2);
    expect(team('u4').place).toBe(3);
    expect(team('u3').place).toBe(4);
  });

  it('emits games: 6 regular + 1 playoff, no consolation', () => {
    expect(summary.games.filter((g) => g.type === 'regular')).toHaveLength(6);
    expect(summary.games.filter((g) => g.type === 'playoff')).toHaveLength(1);
  });

  it('builds the draft board', () => {
    expect(summary.draft[0]).toMatchObject({
      round: 1, pickNo: 1, userId: 'u1', player: 'Star Runner', position: 'RB',
    });
  });

  it('returns notStarted for pre-draft seasons', () => {
    const pre = summarizeSeason({
      ...season,
      league: { ...season.league, status: 'pre_draft' },
    });
    expect(pre.notStarted).toBe(true);
  });
});
