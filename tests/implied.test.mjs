import { describe, it, expect } from 'vitest';
import { deviggedLine, impliedPoints } from '../scripts/lib/implied.mjs';

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

describe('deviggedLine', () => {
  const market = (line, over, under) => ({ line, books: { consensus: { line, over, under } } });

  it('leaves a balanced market at its posted line', () => {
    expect(deviggedLine('rushing_yards', market(1000, -110, -110))).toBeCloseTo(1000, 5);
  });

  it('pulls a yardage line down when the under is heavily juiced', () => {
    const mean = deviggedLine('rushing_yards', market(749.5, 355, -900));
    expect(mean).toBeLessThan(700);
    expect(mean).toBeGreaterThan(749.5 * 0.55); // guardrail floor
  });

  it('pushes a line up when the over is the priced side', () => {
    expect(deviggedLine('receiving_yards', market(1000, -300, 240))).toBeGreaterThan(1000);
  });

  it('treats TD counts as Poisson and drops an under-juiced line', () => {
    const mean = deviggedLine('rushing_tds', market(5.5, 170, -4902));
    expect(mean).toBeLessThan(5);
    expect(mean).toBeGreaterThan(2);
  });

  it('returns null without two-sided prices', () => {
    expect(deviggedLine('receptions', { line: 50, books: {} })).toBeNull();
    expect(deviggedLine('receptions', { line: 50, books: { fanduel: { line: 50, over: -110 } } })).toBeNull();
  });

  it('takes the median across books', () => {
    const m = {
      line: 1000,
      books: {
        a: { line: 1000, over: -110, under: -110 },
        b: { line: 1000, over: -110, under: -110 },
        c: { line: 1000, over: 355, under: -900 },
      },
    };
    expect(deviggedLine('rushing_yards', m)).toBeCloseTo(1000, 5);
  });
});

describe('impliedPoints with devig', () => {
  it('scores de-vigged means instead of posted lines', () => {
    const markets = {
      rushing_yards: { line: 749.5, books: { consensus: { line: 749.5, over: 355, under: -900 } } },
      rushing_tds: { line: 5.5, books: { consensus: { line: 5.5, over: 170, under: -4902 } } },
      receptions: { line: 50, books: {} }, // no prices: passes through untouched
    };
    const raw = impliedPoints(markets, scoring, 'RB');
    const devig = impliedPoints(markets, scoring, 'RB', { devig: true });
    expect(devig.points).toBeLessThan(raw.points);
    expect(devig.lines.receptions).toBe(50);
    expect(devig.lines.rushing_yards).toBeLessThan(700);
  });
});
