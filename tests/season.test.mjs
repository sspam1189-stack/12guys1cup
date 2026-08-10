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

  it('counts every playoff win but only the first playoff loss per team', () => {
    const playoffSeason = summarizeSeason({
      ...season,
      matchups: {
        ...season.matchups,
        4: [
          { matchup_id: 1, roster_id: 1, points: 105 },
          { matchup_id: 1, roster_id: 4, points: 88 },
          { matchup_id: 2, roster_id: 2, points: 99 },
          { matchup_id: 2, roster_id: 3, points: 91 },
        ],
        5: [
          { matchup_id: 1, roster_id: 1, points: 110 },
          { matchup_id: 1, roster_id: 2, points: 103 },
          { matchup_id: 2, roster_id: 3, points: 97 },
          { matchup_id: 2, roster_id: 4, points: 82 },
        ],
      },
      winners_bracket: [
        { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
        { r: 1, m: 2, t1: 2, t2: 3, w: 2, l: 3 },
        { r: 2, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
        { r: 2, m: 2, t1: 3, t2: 4, w: 3, l: 4, p: 3 },
      ],
    });
    const playoffTeam = (userId) => playoffSeason.standings.find((t) => t.userId === userId);

    expect(playoffTeam('u1')).toMatchObject({ playoffWins: 2, playoffLosses: 0 });
    expect(playoffTeam('u2')).toMatchObject({ playoffWins: 1, playoffLosses: 1 });
    expect(playoffTeam('u3')).toMatchObject({ playoffWins: 1, playoffLosses: 1 });
    expect(playoffTeam('u4')).toMatchObject({ playoffWins: 0, playoffLosses: 1 });
  });

  it('awards honors: champion, runner-up, PF champ, last place', () => {
    expect(summary.champion).toBe('u1');
    expect(summary.runnerUp).toBe('u2');
    expect(summary.pfChamp).toBe('u1');
    expect(summary.lastPlace).toBe('u3'); // Shit Bowl loser is last place
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

  it('uses the Shit Bowl score loser for last place when losers-bracket metadata is reversed', () => {
    const sleeperStyle = summarizeSeason({
      ...season,
      losers_bracket: [{ ...season.losers_bracket[0], w: 3, l: 4 }],
    });

    expect(sleeperStyle.lastPlace).toBe('u3');
  });

  it('emits games: regular, playoff, and Shit Bowl display rows', () => {
    expect(summary.games.filter((g) => g.type === 'regular')).toHaveLength(6);
    expect(summary.games.filter((g) => g.type === 'playoff')).toHaveLength(1);
    expect(summary.games.filter((g) => g.type === 'shit bowl')).toHaveLength(1);
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
