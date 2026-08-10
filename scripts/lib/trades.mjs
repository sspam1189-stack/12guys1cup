export function extractTrades(raw, ownerMap, players = {}) {
  const out = [];
  for (const [week, txs] of Object.entries(raw.transactions ?? {})) {
    for (const t of txs ?? []) {
      if (t.type !== 'trade' || t.status !== 'complete') continue;
      const assets = {};
      const parties = (t.roster_ids ?? []).map((rid) => ownerMap.get(rid)).filter(Boolean);
      for (const userId of parties) assets[userId] = { players: [], picks: [] };
      for (const [pid, rid] of Object.entries(t.adds ?? {})) {
        const userId = ownerMap.get(rid);
        if (!assets[userId]) continue;
        const p = players[pid];
        assets[userId].players.push(p ? `${p.name} (${p.position})` : String(pid));
      }
      for (const pk of t.draft_picks ?? []) {
        const userId = ownerMap.get(pk.owner_id);
        if (assets[userId]) assets[userId].picks.push(`${pk.season} Round ${pk.round}`);
      }
      out.push({ season: raw.season, week: Number(week), parties, assets, created: t.created ?? null });
    }
  }
  return out.sort((a, b) => a.week - b.week);
}
