// ── MatchManager pure helpers ─────────────────────────────────

export const stageLabel = (s) => ({
  group: 'Group', round_of_32: 'R32', round_of_16: 'R16',
  quarterfinal: 'QF', semifinal: 'SF', third_place: 'Bronze', final: 'Final',
}[s] || s);

export const statusBadge = (status) => {
  const colors = {
    pending:     { color: '#888',    bg: '#1e1e2e' },
    in_progress: { color: '#4ecb71', bg: '#152a15' },
    finished:    { color: '#d4a843', bg: '#2a2215' },
    locked:      { color: '#666',    bg: '#1a1a1a' },
  };
  const c = colors[status] || colors.pending;
  return (
    <span className="match-status-badge"
      style={{ color: c.color, background: c.bg, borderColor: c.color }}>
      {status === 'in_progress' ? 'LIVE' : status.toUpperCase()}
    </span>
  );
};

export const scoreDisplay = (match) => {
  if (!match.score_data?.sets) return null;
  return match.score_data.sets.map((set, i) => (
    <span key={i} className="match-set-score">
      {set.side_a_points}-{set.side_b_points}
    </span>
  ));
};

export const playerNameFn = (allPlayers) => (id) => {
  if (!id) return 'BYE';
  return allPlayers.find(p => p.id === id)?.name || id.substring(0, 8);
};

export const sideLabelFn = (allPlayers) => (sideArr) => {
  if (!sideArr || sideArr.length === 0) return 'TBD';
  const pName = playerNameFn(allPlayers);
  return sideArr.map(pName).join(' & ');
};

export const interleavedOrder = (matchList) => {
  const groupMatches    = matchList.filter(m => m.stage === 'group');
  const nonGroupMatches = matchList.filter(m => m.stage !== 'group');
  if (groupMatches.length === 0) return matchList;

  const byGroup = {};
  groupMatches.forEach(m => {
    const gid = m.group_id || '_';
    if (!byGroup[gid]) byGroup[gid] = [];
    byGroup[gid].push(m);
  });
  const groupIds = Object.keys(byGroup).sort();
  const interleaved = [];
  const maxLen = Math.max(...groupIds.map(gid => byGroup[gid].length));
  for (let round = 0; round < maxLen; round++) {
    for (const gid of groupIds) {
      if (byGroup[gid][round]) interleaved.push(byGroup[gid][round]);
    }
  }
  return [
    ...interleaved,
    ...nonGroupMatches.sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0)),
  ];
};

export const buildSections = (orderedMatches) => [
  { key: 'live',     title: '🔴 Live',                          color: '#4ecb71', matches: orderedMatches.filter(m => m.status === 'in_progress') },
  { key: 'ready',    title: '✅ Ready to Start',                color: '#4ecb71', matches: orderedMatches.filter(m => m.status === 'pending' && (m.referee_is_admin || (m.referee_id && m.referee_confirmed))) },
  { key: 'awaiting', title: '⏳ Awaiting Referee Confirmation', color: '#d4a843', matches: orderedMatches.filter(m => m.status === 'pending' && m.referee_id && !m.referee_confirmed && !m.referee_is_admin) },
  { key: 'upcoming', title: '📋 Upcoming',                     color: '#888',    matches: orderedMatches.filter(m => m.status === 'pending' && !m.referee_id && !m.referee_is_admin && m.side_a?.length && m.side_b?.length) },
  { key: 'waiting',  title: '⏸ Waiting for Previous Matches',  color: '#555',    matches: orderedMatches.filter(m => m.status === 'pending' && (!m.side_a?.length || !m.side_b?.length) && !m.referee_id && !m.referee_is_admin) },
  { key: 'completed',title: '✓ Completed',                     color: '#666',    matches: orderedMatches.filter(m => m.status === 'finished' || m.status === 'locked') },
];