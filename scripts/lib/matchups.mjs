export function pairWeek(entries) {
  const byMatch = new Map();
  for (const e of entries ?? []) {
    if (e.matchup_id == null) continue;
    if (!byMatch.has(e.matchup_id)) byMatch.set(e.matchup_id, []);
    byMatch.get(e.matchup_id).push(e);
  }
  const pairs = [];
  for (const list of byMatch.values()) {
    if (list.length === 2) pairs.push({ a: list[0], b: list[1] });
  }
  return pairs;
}
