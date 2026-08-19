import { describe, it, expect } from 'vitest';
import { reconcile } from '../scripts/build-board.mjs';

// A pick as mock-draft.mjs --json emits it: what the representative run took,
// plus how often each name went there across every simulation.
const pick = (overall, who, position, name, pct, alts = []) => ({
  overall,
  round: Math.ceil(overall / 2),
  slot: overall % 2 === 1 ? 1 : 2,
  who,
  position,
  name,
  pct,
  positions: [{ position, pct: 100 }],
  positionPct: 100,
  alts,
});

const named = (board) => board.filter((p) => p.name !== null).map((p) => p.name);

describe('reconcile', () => {
  it('gives a player to the pick where he went most often, not the earliest one', () => {
    // Hall is a coin flip at pick 1 and the clear call at pick 2. Walking the
    // board in draft order would hand him to pick 1 and leave pick 2 scrambling.
    const { board } = reconcile([
      pick(1, 'a', 'RB', 'Breece Hall', 14, [{ name: 'Bijan Robinson', position: 'RB', pct: 12 }]),
      pick(2, 'b', 'RB', 'Breece Hall', 26, []),
    ]);
    expect(board[0].name).toBe('Bijan Robinson');
    expect(board[1].name).toBe('Breece Hall');
  });

  it('never puts the same player on the board twice', () => {
    const { board } = reconcile([
      pick(1, 'a', 'RB', "De'Von Achane", 16, [{ name: 'Saquon Barkley', position: 'RB', pct: 12 }]),
      pick(2, 'b', 'RB', 'Kenneth Walker', 8, [{ name: "De'Von Achane", position: 'RB', pct: 16 }]),
    ]);
    expect(new Set(named(board)).size).toBe(2);
  });

  it('keeps each manager to the roster shape the run gave him', () => {
    // The likeliest name at pick 2 is a second quarterback. The run had one, so
    // the cell takes the best receiver instead of doubling up.
    const { board } = reconcile([
      pick(1, 'a', 'QB', 'Josh Allen', 54, []),
      pick(2, 'a', 'WR', 'Nico Collins', 16, [{ name: 'Lamar Jackson', position: 'QB', pct: 40 }]),
    ]);
    expect(board[1].position).toBe('WR');
    expect(board[1].name).toBe('Nico Collins');
  });

  it('falls back to the best player left by ADP when every name is spoken for', () => {
    const pool = [
      { name: 'Bijan Robinson', position: 'RB', adp: 3 },
      { name: 'Kyren Williams', position: 'RB', adp: 40 },
    ];
    const { board, gaps } = reconcile(
      [
        pick(1, 'a', 'RB', 'Bijan Robinson', 60, []),
        pick(2, 'b', 'RB', 'Bijan Robinson', 20, []),
      ],
      pool,
    );
    expect(gaps).toHaveLength(0);
    expect(board[1]).toMatchObject({ name: 'Kyren Williams', fallback: true, pct: 0 });
  });

  it('reports a gap rather than inventing a name when the pool is exhausted too', () => {
    const { board, gaps } = reconcile([
      pick(1, 'a', 'RB', 'Bijan Robinson', 60, []),
      pick(2, 'b', 'RB', 'Bijan Robinson', 20, []),
    ]);
    expect(gaps).toEqual([2]);
    expect(board[1].name).toBeNull();
  });

  it('lets kickers and defenses repeat, since they are slots rather than players', () => {
    const { board } = reconcile([
      pick(1, 'a', 'K', 'K', 100, []),
      pick(2, 'b', 'K', 'K', 100, []),
    ]);
    expect(named(board)).toEqual(['K', 'K']);
  });

  it("drops whoever took the pick from that pick's list of alternates", () => {
    const { board } = reconcile([
      pick(1, 'a', 'RB', 'Breece Hall', 26, [{ name: 'Bijan Robinson', position: 'RB', pct: 12 }]),
    ]);
    expect(board[0].name).toBe('Breece Hall');
    expect(board[0].alts.map((a) => a.name)).toEqual(['Bijan Robinson']);
  });
});
