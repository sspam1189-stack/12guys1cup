import { mkdir, writeFile } from 'node:fs/promises';
import { fetchJson } from './lib/sleeper.mjs';

const CURRENT_LEAGUE_ID = '1382479927399419904';
const RAW = new URL('../data/raw/', import.meta.url);
const MAX_WEEK = 18;

async function save(season, name, data) {
  const dir = new URL(`${season}/`, RAW);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(`${name}.json`, dir), JSON.stringify(data, null, 1));
}

// Walk the league chain from current season back to the first.
const leagues = [];
for (let id = CURRENT_LEAGUE_ID; id; ) {
  const league = await fetchJson(`/league/${id}`);
  leagues.push(league);
  id = league.previous_league_id;
}

const tradedPlayerIds = new Set();

for (const league of leagues) {
  const { season, league_id: lid } = league;
  console.log(`Fetching ${season} (${lid})…`);
  await save(season, 'league', league);
  await save(season, 'users', await fetchJson(`/league/${lid}/users`));
  await save(season, 'rosters', await fetchJson(`/league/${lid}/rosters`));

  const matchups = {};
  const transactions = {};
  for (let w = 1; w <= MAX_WEEK; w++) {
    matchups[w] = await fetchJson(`/league/${lid}/matchups/${w}`);
    transactions[w] = await fetchJson(`/league/${lid}/transactions/${w}`);
    for (const t of transactions[w] ?? []) {
      if (t.type === 'trade' && t.status === 'complete') {
        for (const pid of Object.keys(t.adds ?? {})) tradedPlayerIds.add(pid);
      }
    }
  }
  await save(season, 'matchups', matchups);
  await save(season, 'transactions', transactions);

  await save(season, 'winners_bracket', await fetchJson(`/league/${lid}/winners_bracket`));
  await save(season, 'losers_bracket', await fetchJson(`/league/${lid}/losers_bracket`));

  const drafts = await fetchJson(`/league/${lid}/drafts`);
  await save(season, 'draft', drafts?.[0] ?? null);
  await save(
    season,
    'draft_picks',
    drafts?.[0] ? await fetchJson(`/draft/${drafts[0].draft_id}/picks`) : [],
  );
}

// Trim the huge players blob to just ids referenced by trades.
console.log('Fetching player list…');
const allPlayers = await fetchJson('/players/nfl');
const players = {};
for (const pid of tradedPlayerIds) {
  const p = allPlayers[pid];
  players[pid] = p
    ? { name: p.full_name ?? `${p.first_name} ${p.last_name}`, position: p.position ?? '' }
    : { name: pid, position: '' };
}
await mkdir(RAW, { recursive: true });
await writeFile(new URL('players.json', RAW), JSON.stringify(players, null, 1));
console.log(`Done. ${leagues.length} seasons, ${tradedPlayerIds.size} traded players.`);
