// ── Shared helpers for public view components ──

export const stageLabel = (s) => ({
  group: 'Group', round_robin: 'Round Robin', round_of_32: 'Round of 32',
  round_of_16: 'Round of 16', quarterfinal: 'Quarterfinal', semifinal: 'Semifinal',
  third_place: 'Bronze', final: 'Final',
}[s] || s);

export const formatDate = (d) => {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d;
};

export const pName = (id, allPlayers) => {
  if (!id) return '?';
  return allPlayers.find(p => p.id === id)?.name || id.substring(0, 6);
};

export const sideLabel = (arr, allPlayers) => {
  if (!arr || !arr.length) return 'TBD';
  return arr.map(id => pName(id, allPlayers)).join(' & ');
};

/**
 * PairNames — renders a side's player(s) as individually clickable names,
 * joined by " & " for doubles. Use in place of a plain sideLabel(...) string
 * wherever the names need to be clickable (so each partner opens their own
 * profile, not just the first player on the side).
 *
 * Props:
 *   ids           — side_a/side_b array of player ids
 *   allPlayers    — full players list (for name lookup)
 *   onPlayerClick — handler called with a single player id
 *   className     — optional class applied to each individual name span
 */
export function PairNames({ ids, allPlayers, onPlayerClick, className }) {
  if (!ids || !ids.length) return 'TBD';
  return ids.map((id, i) => (
    <span key={id || i}>
      {i > 0 && ' & '}
      <span
        className={className}
        onClick={(e) => { e.stopPropagation(); onPlayerClick && onPlayerClick(id); }}
        style={{ cursor: onPlayerClick ? 'pointer' : 'default' }}
      >
        {pName(id, allPlayers)}
      </span>
    </span>
  ));
}

export const scoreDisplay = (m) => {
  if (m.default_win) return [{ text: 'Walkover', walkover: true }];
  if (!m.score_data?.sets) return null;
  return m.score_data.sets.map(s => ({ text: s.side_a_points + '-' + s.side_b_points }));
};

/** Calculate medals for a player across all provided matches */
export function calcMedals(playerId, matches, events) {
  const medals = [];
  const eventMap = new Map((events || []).map(e => [e.id, e]));

  for (const m of matches) {
    if (m.status !== 'finished' && m.status !== 'locked') continue;
    if (!m.winner) continue;
    const isA = (m.side_a || []).includes(playerId);
    const isB = (m.side_b || []).includes(playerId);
    if (!isA && !isB) continue;
    const won = (isA && m.winner === 'side_a') || (isB && m.winner === 'side_b');
    const ev = eventMap.get(m.event_id);
    const evType = ev?.type === 'doubles' ? 'Doubles' : 'Singles';
    const CAT_LABELS = { u8: 'U-8', u12: 'U-13', u18: 'U-18', senior: 'Senior' };
    const catLabel = ev?.category && ev.category !== 'adult' ? (CAT_LABELS[ev.category] || ev.category.toUpperCase()) + ' ' : '';
    const gLabel = ev?.gender ? ({ mens: "Men's ", womens: "Women's ", mixed: 'Mixed ' }[ev.gender] || '') : '';
    const label = gLabel + catLabel + evType;

    if (m.stage === 'final') medals.push({ type: won ? 'gold' : 'silver', label, eventId: m.event_id });
    else if (m.stage === 'third_place' && won) medals.push({ type: 'bronze', label, eventId: m.event_id });
  }

  // Group by type+label and count
  const grouped = {};
  for (const md of medals) {
    const key = md.type + '|' + md.label;
    if (!grouped[key]) grouped[key] = { ...md, count: 0 };
    grouped[key].count++;
  }
  return Object.values(grouped).sort((a, b) => {
    const order = { gold: 0, silver: 1, bronze: 2 };
    return (order[a.type] || 3) - (order[b.type] || 3);
  });
}

/** Check if a player has won a specific event final (for showing medal on match cards) */
export function getPlayerEventMedal(playerId, eventId, matches) {
  for (const m of matches) {
    if (m.event_id !== eventId) continue;
    if (m.status !== 'finished' && m.status !== 'locked') continue;
    if (!m.winner) continue;
    const isA = (m.side_a || []).includes(playerId);
    const isB = (m.side_b || []).includes(playerId);
    if (!isA && !isB) continue;
    const won = (isA && m.winner === 'side_a') || (isB && m.winner === 'side_b');
    if (m.stage === 'final') return won ? 'gold' : 'silver';
    if (m.stage === 'third_place' && won) return 'bronze';
  }
  return null;
}