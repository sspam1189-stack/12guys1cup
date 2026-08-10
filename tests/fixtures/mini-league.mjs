export const users = [
  { user_id: 'u1', display_name: 'Alice', metadata: { team_name: 'Team A' } },
  { user_id: 'u2', display_name: 'Bob', metadata: { team_name: 'Team B' } },
  { user_id: 'u3', display_name: 'Carol', metadata: { team_name: 'Team C' } },
  { user_id: 'u4', display_name: 'Dave', metadata: { team_name: 'Team D' } },
];

export const rosters = [
  { roster_id: 1, owner_id: 'u1' },
  { roster_id: 2, owner_id: 'u2' },
  { roster_id: 3, owner_id: 'u3' },
  { roster_id: 4, owner_id: 'u4' },
];

const m = (id, roster, points) => ({ matchup_id: id, roster_id: roster, points });

export const season = {
  season: '2030',
  league: {
    season: '2030', name: 'Mini League', status: 'complete', league_id: 'L1',
    settings: { playoff_week_start: 4, playoff_teams: 2 },
  },
  users,
  rosters,
  matchups: {
    1: [m(1, 1, 100), m(1, 2, 90), m(2, 3, 80), m(2, 4, 70)],
    2: [m(1, 1, 110), m(1, 3, 60), m(2, 2, 95), m(2, 4, 85)],
    3: [m(1, 1, 120), m(1, 4, 50), m(2, 2, 88), m(2, 3, 87)],
    4: [m(1, 1, 105), m(1, 2, 99), m(2, 3, 65), m(2, 4, 88)],
  },
  winners_bracket: [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }],
  losers_bracket: [{ r: 1, m: 1, t1: 3, t2: 4, w: 4, l: 3, p: 1 }],
  draft_picks: [
    { round: 1, pick_no: 1, draft_slot: 1, roster_id: 1, picked_by: 'u1',
      metadata: { first_name: 'Star', last_name: 'Runner', position: 'RB' } },
  ],
  transactions: {
    2: [{
      type: 'trade', status: 'complete', roster_ids: [1, 2],
      adds: { p100: 1, p200: 2 },
      draft_picks: [{ season: '2031', round: 2, owner_id: 1, previous_owner_id: 2, roster_id: 2 }],
      created: 1700000000000,
    }],
  },
};

export const players = {
  p100: { name: 'John Smith', position: 'RB' },
  p200: { name: 'Mike Jones', position: 'WR' },
};
