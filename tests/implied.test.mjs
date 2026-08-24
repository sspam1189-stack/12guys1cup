import { describe, it, expect } from 'vitest';
import { impliedPoints } from '../scripts/lib/implied.mjs';

// Half-PPR league shape, in round numbers so expectations stay readable.
const scoring = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec_yd: 0.1,
  rec_td: 6,
  rec: 0.5,
};
const line = (n) => ({ line: n });

describe('impliedPoints', () => {
  it('scores every posted market under league scoring', () => {
    const { points, missing } = impliedPoints(
      {
        passing_yards: line(4000),
        passing_tds: line(30),
        rushing_yards: line(300),
        rushing_tds: line(2.5),
      },
      scoring,
      'QB',
    );
    expect(points).toBeCloseTo(160 + 120 + 30 + 15);
    expect(missing).toEqual([]);
  });

  it('counts an interception line against the total when one exists', () => {
    const { points } = impliedPoints(
      { passing_yards: line(4000), interceptions: line(10) },
      scoring,
      'QB',
    );
    expect(points).toBeCloseTo(160 - 20);
  });

  it('ignores markets with no scoring meaning', () => {
    const { points, lines } = impliedPoints({ sacks: line(40), receptions: line(50) }, scoring, null);
    expect(points).toBeCloseTo(25);
    expect(lines).toEqual({ receptions: 50 });
  });

  it('ignores a combo market when both splits are posted', () => {
    const { points } = impliedPoints(
      {
        rushing_yards: line(1000),
        receiving_yards: line(400),
        rushing_receiving_yards: line(1400),
      },
      scoring,
      null,
    );
    expect(points).toBeCloseTo(140);
  });

  it('derives the missing split from a combo by subtraction', () => {
    const { points, lines, derived, missing } = impliedPoints(
      { rushing_yards: line(1000), rushing_receiving_yards: line(1500), receptions: line(40), receiving_tds: line(3) },
      scoring,
      'RB',
    );
    expect(lines.receiving_yards).toBe(500);
    expect(derived).toEqual(['receiving_yards']);
    expect(points).toBeCloseTo(100 + 50 + 20 + 18);
    // covered by the combo, so not a coverage gap — only the TD split remains
    expect(missing).toEqual(['rushing_tds']);
  });

  it('drops a combo remainder that would go negative', () => {
    const { points, lines } = impliedPoints(
      { rushing_yards: line(1000), rushing_receiving_yards: line(800) },
      scoring,
      null,
    );
    expect(lines.receiving_yards).toBeUndefined();
    expect(points).toBeCloseTo(100);
  });

  it('scores a splitless combo whole at the rushing rate', () => {
    const { points, lines, missing } = impliedPoints(
      { rushing_receiving_yards: line(1500), rushing_receiving_tds: line(10) },
      scoring,
      'RB',
    );
    expect(lines.rushing_receiving_yards).toBe(1500);
    expect(points).toBeCloseTo(150 + 60);
    // both yardage and TD splits are covered by the combos
    expect(missing).toEqual(['receptions']);
  });

  it('lists core markets a position has no line for', () => {
    const { missing } = impliedPoints({ receiving_yards: line(700) }, scoring, 'TE');
    expect(missing).toEqual(['receptions', 'receiving_tds']);
  });

  it('has no coverage expectations for unknown positions', () => {
    const { points, missing } = impliedPoints({}, scoring, 'K');
    expect(points).toBe(0);
    expect(missing).toEqual([]);
  });
});
