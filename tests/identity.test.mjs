import { describe, it, expect } from 'vitest';
import { loadOwnerMap, buildMembers } from '../scripts/lib/identity.mjs';
import { season } from './fixtures/mini-league.mjs';

describe('loadOwnerMap', () => {
  it('maps roster_id to owner user_id', () => {
    const map = loadOwnerMap(season.rosters);
    expect(map.get(1)).toBe('u1');
    expect(map.get(4)).toBe('u4');
  });

  it('applies overrides by roster id and by user id', () => {
    expect(loadOwnerMap(season.rosters, { 2: 'u9' }).get(2)).toBe('u9');
    expect(loadOwnerMap(season.rosters, { u3: 'u8' }).get(3)).toBe('u8');
  });

  it('throws on ownerless roster', () => {
    expect(() => loadOwnerMap([{ roster_id: 9, owner_id: null }])).toThrow(/roster 9/i);
  });
});

describe('buildMembers', () => {
  it('collects one entry per person with team names by season', () => {
    const members = buildMembers([season], {});
    expect(Object.keys(members).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(members.u1).toMatchObject({
      name: 'Alice', seasons: ['2030'], teamNames: { 2030: 'Team A' },
    });
  });

  it('keeps an overridden person separate from the account holder', () => {
    const members = buildMembers([season], { 2030: { u3: 'u8' } });
    expect(members.u8.seasons).toEqual(['2030']);
    expect(members.u3).toBeUndefined();
  });
});
