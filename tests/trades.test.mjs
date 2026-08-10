import { describe, it, expect } from 'vitest';
import { extractTrades } from '../scripts/lib/trades.mjs';
import { loadOwnerMap } from '../scripts/lib/identity.mjs';
import { season, players } from './fixtures/mini-league.mjs';

describe('extractTrades', () => {
  it('extracts completed trades with resolved names', () => {
    const trades = extractTrades(season, loadOwnerMap(season.rosters), players);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      season: '2030', week: 2, parties: ['u1', 'u2'],
    });
    expect(trades[0].assets.u1.players).toEqual(['John Smith (RB)']);
    expect(trades[0].assets.u1.picks).toEqual(['2031 Round 2']);
    expect(trades[0].assets.u2.players).toEqual(['Mike Jones (WR)']);
  });

  it('ignores non-trade and incomplete transactions', () => {
    const raw = {
      ...season,
      transactions: { 1: [
        { type: 'waiver', status: 'complete', roster_ids: [1] },
        { type: 'trade', status: 'failed', roster_ids: [1, 2], adds: {} },
      ] },
    };
    expect(extractTrades(raw, loadOwnerMap(season.rosters), players)).toEqual([]);
  });
});
