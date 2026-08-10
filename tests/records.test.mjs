import { describe, it, expect } from 'vitest';
import { buildRecords } from '../scripts/lib/records.mjs';
import { summarizeSeason } from '../scripts/lib/season.mjs';
import { season } from './fixtures/mini-league.mjs';

const records = buildRecords([summarizeSeason(season)]);

describe('buildRecords (regular season)', () => {
  it('weekly score records', () => {
    expect(records.highestGame[0]).toMatchObject({ userId: 'u1', points: 120, week: 3 });
    expect(records.lowestGame[0]).toMatchObject({ userId: 'u4', points: 50, week: 3 });
  });

  it('margin records', () => {
    expect(records.biggestBlowout[0]).toMatchObject({ userId: 'u1', margin: 70 });
    expect(records.closestGame[0]).toMatchObject({ userId: 'u2', margin: 1 });
  });

  it('hard-luck records', () => {
    expect(records.mostPointsInLoss[0]).toMatchObject({ userId: 'u2', points: 90 });
    expect(records.fewestPointsInWin[0]).toMatchObject({ userId: 'u3', points: 80 });
  });

  it('streaks', () => {
    expect(records.longestWinStreak[0]).toMatchObject({ userId: 'u1', length: 3 });
    expect(records.longestLossStreak[0]).toMatchObject({ userId: 'u4', length: 3 });
  });

  it('season records', () => {
    expect(records.bestSeasons[0]).toMatchObject({ userId: 'u1', wins: 3, losses: 0 });
    expect(records.highestSeasonPf[0]).toMatchObject({ userId: 'u1', pf: 330 });
  });

  it('playoff records stay separate', () => {
    expect(records.playoffHighestGame[0]).toMatchObject({ userId: 'u1', points: 105 });
  });
});
