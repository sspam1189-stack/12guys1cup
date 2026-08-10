// Overrides shape: { [rosterIdOrUserId]: actualUserId } for one season.
export function loadOwnerMap(rosters, overrides = {}) {
  const map = new Map();
  for (const r of rosters) {
    let owner = r.owner_id == null ? null : String(r.owner_id);
    const replacement = overrides[String(r.roster_id)] ?? (owner && overrides[owner]);
    if (replacement) owner = String(replacement);
    if (!owner) throw new Error(`Roster ${r.roster_id} has no owner and no override`);
    map.set(r.roster_id, owner);
  }
  return map;
}

// seasonsRaw: [{ season, users, rosters }] sorted ascending by season.
// overridesBySeason: { [season]: { [rosterIdOrUserId]: userId } }
export function buildMembers(seasonsRaw, overridesBySeason = {}) {
  const members = {};
  for (const raw of seasonsRaw) {
    const ownerMap = loadOwnerMap(raw.rosters, overridesBySeason[raw.season] ?? {});
    const usersById = Object.fromEntries(raw.users.map((u) => [u.user_id, u]));
    for (const userId of ownerMap.values()) {
      const u = usersById[userId];
      const m = (members[userId] ??= {
        userId, name: userId, avatar: null, seasons: [], teamNames: {},
      });
      if (u?.display_name) m.name = u.display_name; // later seasons win
      if (u?.avatar) m.avatar = u.avatar;
      if (!m.seasons.includes(raw.season)) m.seasons.push(raw.season);
      m.teamNames[raw.season] = u?.metadata?.team_name || u?.display_name || 'Unnamed';
    }
  }
  return members;
}
