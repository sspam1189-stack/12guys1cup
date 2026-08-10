import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { buildMembers, loadOwnerMap } from './lib/identity.mjs';
import { summarizeSeason } from './lib/season.mjs';
import { buildAlltime } from './lib/alltime.mjs';
import { buildH2h } from './lib/h2h.mjs';
import { buildRecords } from './lib/records.mjs';
import { buildPowerRankings } from './lib/power.mjs';
import { extractTrades } from './lib/trades.mjs';

const DATA = new URL('../data/', import.meta.url);
const RAW = new URL('raw/', DATA);
const OUT = new URL('computed/', DATA);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

export async function loadRawSeasons() {
  const dirs = (await readdir(RAW)).filter((d) => /^\d{4}$/.test(d)).sort();
  const seasons = [];
  for (const season of dirs) {
    const at = (f) => new URL(`${season}/${f}.json`, RAW);
    seasons.push({
      season,
      league: await readJson(at('league')),
      users: await readJson(at('users')),
      rosters: await readJson(at('rosters')),
      matchups: await readJson(at('matchups')),
      transactions: await readJson(at('transactions')),
      winners_bracket: await readJson(at('winners_bracket')),
      losers_bracket: await readJson(at('losers_bracket')),
      draft_picks: await readJson(at('draft_picks')),
    });
  }
  return seasons;
}

const raws = await loadRawSeasons();
const overrides = await readJson(new URL('overrides.json', DATA));
const players = await readJson(new URL('players.json', RAW));

const members = buildMembers(raws, overrides);
const summaries = raws.map((raw) => summarizeSeason(raw, overrides[raw.season] ?? {}));

// Validation: every game participant must be a known member.
for (const s of summaries) {
  for (const g of s.games ?? []) {
    for (const side of [g.a, g.b]) {
      if (!members[side.userId]) {
        throw new Error(`Unknown userId ${side.userId} in ${s.season} week ${g.week}`);
      }
    }
  }
}

const allGames = summaries.filter((s) => !s.notStarted).flatMap((s) => s.games);
const trades = raws.flatMap((raw) =>
  raw.league.status === 'pre_draft' || raw.league.status === 'drafting'
    ? []
    : extractTrades(raw, loadOwnerMap(raw.rosters, overrides[raw.season] ?? {}), players));

await mkdir(OUT, { recursive: true });
const write = (name, data) =>
  writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data, null, 1));
await write('members', members);
await write('seasons', summaries);
await write('alltime', buildAlltime(summaries));
await write('power', buildPowerRankings(summaries));
await write('h2h', buildH2h(allGames));
await write('records', buildRecords(summaries));
await write('trades', trades);

// Current league configuration for the rules page (latest season).
const latest = raws[raws.length - 1];
await write('settings', {
  season: latest.season,
  name: latest.league.name,
  rosterPositions: latest.league.roster_positions,
  scoring: latest.league.scoring_settings,
  settings: latest.league.settings,
});
console.log(`Computed ${summaries.length} seasons, ${allGames.length} games, ${trades.length} trades.`);
