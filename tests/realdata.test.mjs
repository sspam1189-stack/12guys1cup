import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { summarizeSeason } from '../scripts/lib/season.mjs';

const hasData = existsSync(new URL('../data/raw', import.meta.url));

describe.skipIf(!hasData)('real data cross-validation', async () => {
  const { loadRawSeasons } = await import('../scripts/build-stats.mjs');
  const raws = (await loadRawSeasons()).filter((r) => r.league.status === 'complete');

  it('has 5 completed seasons', () => {
    expect(raws.map((r) => r.season)).toEqual(['2021', '2022', '2023', '2024', '2025']);
  });

  it.each(raws.map((r) => [r.season, r]))(
    'season %s matches sleeper roster totals',
    (name, raw) => {
      const summary = summarizeSeason(raw);
      for (const roster of raw.rosters) {
        const t = summary.standings.find((x) => x.rosterId === roster.roster_id);
        expect(t.wins, `wins roster ${roster.roster_id}`).toBe(roster.settings.wins);
        expect(t.losses, `losses roster ${roster.roster_id}`).toBe(roster.settings.losses);
        expect(t.ties, `ties roster ${roster.roster_id}`).toBe(roster.settings.ties ?? 0);
        // Sleeper's roster fpts was accumulated live; the matchups endpoint is
        // recomputed after NFL stat corrections, so totals can drift by a few
        // points (observed max 3.0 across 2021-2025). A missed week would be
        // off by ~100, which this still catches.
        const sleeperPf = roster.settings.fpts + (roster.settings.fpts_decimal ?? 0) / 100;
        expect(Math.abs(t.pf - sleeperPf), `pf roster ${roster.roster_id}`).toBeLessThan(5);
      }
      expect(summary.champion).toBeTruthy();
      expect(summary.pfChamp).toBeTruthy();
      expect(summary.lastPlace).toBeTruthy();
    },
  );
});
