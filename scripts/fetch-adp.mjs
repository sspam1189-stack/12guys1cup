// Snapshots Sleeper's half-PPR ADP per season into data/raw/adp/<season>.json.
//
// This uses api.sleeper.com — the host the Sleeper app itself calls — not the
// documented api.sleeper.app. There is no ADP anywhere in the documented API.
// Undocumented means unversioned: if the shape moves, this script says so
// loudly rather than writing empty files.
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://api.sleeper.com';
const RAW = new URL('../data/raw/', import.meta.url);
const OUT = new URL('adp/', RAW);
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
// 12-team era only. The 2021-22 drafts were 14-team, so every pick in them
// looks like a reach against a league-size-agnostic ADP pool.
const SEASONS = ['2023', '2024', '2025'];

async function fetchJson(url, { retries = 3, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
    }
  }
}


await mkdir(OUT, { recursive: true });

// The row shape is undocumented, so read defensively: the ADP may sit on the
// row itself or inside a nested stats object, and the player may be nested too.
const stats = (row) => row?.stats ?? row ?? {};
const adpOf = (row) => stats(row).adp_half_ppr ?? row?.adp_half_ppr ?? null;
const playerOf = (row) => row?.player ?? row ?? {};
const nameOf = (row) => {
  const p = playerOf(row);
  const built = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return p.full_name ?? (built || String(row?.player_id ?? '?'));
};

const report = [];
for (const season of SEASONS) {
  const params = new URLSearchParams({ season_type: 'regular', order_by: 'adp_half_ppr' });
  for (const pos of POSITIONS) params.append('position[]', pos);
  const url = `${BASE}/projections/nfl/${season}?${params}`;

  let rows;
  try {
    rows = await fetchJson(url);
  } catch (err) {
    report.push({ season, error: String(err.message ?? err) });
    console.error(`${season}: request failed — ${err.message ?? err}`);
    continue;
  }
  if (!Array.isArray(rows)) rows = Object.values(rows ?? {});

  const adp = {};
  for (const row of rows) {
    const value = adpOf(row);
    const playerId = row?.player_id ?? playerOf(row).player_id;
    if (value == null || playerId == null) continue;
    adp[String(playerId)] = {
      name: nameOf(row),
      position: playerOf(row).position ?? stats(row).position ?? '',
      adp: value,
    };
  }

  await writeFile(new URL(`${season}.json`, OUT), JSON.stringify(adp, null, 1));

  // Probe output: does Sleeper actually retain ADP for a finished season?
  const adpKeys = [...new Set(rows.flatMap((r) => Object.keys(stats(r))))]
    .filter((k) => k.startsWith('adp'))
    .sort();
  const top = Object.values(adp)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 3)
    .map((p) => `${p.name} ${p.adp}`)
    .join(', ');
  report.push({ season, rows: rows.length, withAdp: Object.keys(adp).length, adpKeys, top });
  console.log(
    `${season}: ${rows.length} rows, ${Object.keys(adp).length} with half-PPR ADP` +
      `\n  adp fields: ${adpKeys.join(', ') || '(none)'}` +
      `\n  earliest:   ${top || '(none)'}`,
  );
}

const usable = report.filter((r) => r.withAdp > 0);
console.log(`\n${usable.length}/${SEASONS.length} seasons returned half-PPR ADP.`);
if (!usable.length) {
  console.error('No season returned ADP — the endpoint or its shape has changed.');
  process.exit(1);
}
