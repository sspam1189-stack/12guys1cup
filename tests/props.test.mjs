import { describe, it, expect } from 'vitest';
import {
  canonicalMarket,
  impliedProbability,
  devig,
  subcategoriesOf,
  harvestDraftKings,
  collate,
} from '../scripts/fetch-props.mjs';

// Shaped like the payload DraftKings' own front end receives: categories hold
// subcategory descriptors, descriptors hold offers, offers hold outcomes, and
// the array of offers is itself nested one level deeper than you would expect.
const payload = {
  eventGroup: {
    offerCategories: [
      {
        offerCategoryId: 1001,
        name: 'Season Long Player Props',
        offerSubcategoryDescriptors: [
          {
            subcategoryId: 12,
            name: 'Receiving Yards',
            offerSubcategory: {
              offers: [
                [
                  {
                    label: "Ja'Marr Chase Receiving Yards",
                    outcomes: [
                      { label: 'Over', oddsAmerican: -115, line: 1275.5, participant: "Ja'Marr Chase" },
                      { label: 'Under', oddsAmerican: -105, line: 1275.5, participant: "Ja'Marr Chase" },
                    ],
                  },
                  {
                    label: 'Team Total Receiving Yards',
                    outcomes: [{ label: 'Over', oddsAmerican: -110, line: 4200.5 }],
                  },
                ],
              ],
            },
          },
        ],
      },
    ],
  },
};

describe('canonicalMarket', () => {
  it('reads the label rather than an id, since the ids change every season', () => {
    expect(canonicalMarket('Receiving Yards')).toBe('rec_yds');
    expect(canonicalMarket('Total Passing Yards')).toBe('pass_yds');
    expect(canonicalMarket('Rushing Touchdowns')).toBe('rush_tds');
    expect(canonicalMarket('Receptions')).toBe('rec');
  });

  it('separates yards from touchdowns at the same position', () => {
    expect(canonicalMarket('Receiving TDs')).toBe('rec_tds');
    expect(canonicalMarket('Receiving Yards')).toBe('rec_yds');
  });

  it('returns null for a market it does not know, so the caller can keep the label', () => {
    expect(canonicalMarket('Longest Field Goal')).toBeNull();
  });
});

describe('impliedProbability', () => {
  it('converts both signs of American odds', () => {
    expect(impliedProbability(100)).toBeCloseTo(0.5, 4);
    expect(impliedProbability(-110)).toBeCloseTo(0.5238, 4);
    expect(impliedProbability(150)).toBeCloseTo(0.4, 4);
  });

  it('rejects a missing or nonsense price instead of returning a number', () => {
    expect(impliedProbability(null)).toBeNull();
    expect(impliedProbability(0)).toBeNull();
    expect(impliedProbability('even')).toBeNull();
  });
});

describe('devig', () => {
  it('strips the hold so the two sides sum to one', () => {
    // -110 both ways is a 4.5% hold; fair is a coin flip.
    expect(devig(-110, -110)).toBeCloseTo(0.5, 4);
  });

  it('leans toward the shorter price', () => {
    expect(devig(-150, 130)).toBeGreaterThan(0.5);
  });

  it('needs both sides — a one-way market has no vig to remove', () => {
    expect(devig(-110, null)).toBeNull();
  });
});

describe('harvestDraftKings', () => {
  const rows = harvestDraftKings(payload, {
    categoryName: 'Season Long Player Props',
    subcategoryName: 'Receiving Yards',
  });

  it('pairs the over and under of one player into a single row', () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      player: "Ja'Marr Chase",
      market: 'rec_yds',
      line: 1275.5,
      over: -115,
      under: -105,
      classified: true,
    });
  });

  it('drops team and game markets, which have no named participant', () => {
    expect(rows.some((r) => /Team Total/.test(r.label ?? ''))).toBe(false);
  });

  it('keeps an unclassified market under its own label rather than discarding it', () => {
    const odd = harvestDraftKings(payload, { subcategoryName: 'Longest Reception' });
    expect(odd[0]).toMatchObject({ market: 'Longest Reception', classified: false });
  });
});

describe('subcategoriesOf', () => {
  it('flattens the two levels of nesting into something walkable', () => {
    expect(subcategoriesOf(payload)).toEqual([
      { categoryId: 1001, categoryName: 'Season Long Player Props', subcategoryId: 12, subcategoryName: 'Receiving Yards' },
    ]);
  });

  it('survives a payload with no categories at all', () => {
    expect(subcategoriesOf({})).toEqual([]);
  });
});

describe('collate', () => {
  it('keys by player and market, and de-vigs on the way in', () => {
    const players = collate([
      { player: 'Bijan Robinson', market: 'rush_yds', label: 'Rushing Yards', line: 1225.5, over: -110, under: -110 },
    ]);
    expect(players['Bijan Robinson'].markets.rush_yds).toMatchObject({ line: 1225.5, pOver: 0.5 });
  });

  it('prefers a two-sided price over a one-sided one for the same market', () => {
    const players = collate([
      { player: 'Bijan Robinson', market: 'rush_yds', line: 1225.5, over: -110, under: null },
      { player: 'Bijan Robinson', market: 'rush_yds', line: 1225.5, over: -115, under: -105 },
    ]);
    expect(players['Bijan Robinson'].markets.rush_yds.under).toBe(-105);
  });

  it('keeps every market a player has rather than collapsing to one', () => {
    const players = collate([
      { player: 'Ashton Jeanty', market: 'rush_yds', line: 1100.5, over: -110, under: -110 },
      { player: 'Ashton Jeanty', market: 'rec', line: 38.5, over: -120, under: 100 },
    ]);
    expect(Object.keys(players['Ashton Jeanty'].markets).sort()).toEqual(['rec', 'rush_yds']);
  });
});
