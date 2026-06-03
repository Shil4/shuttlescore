// TournamentSummary — progressive cross-event overview for spectators.
// Shows each event's current stage, completion %, and medal winners if known.

import { categoryLabel } from '../admin/eventCategoryHelpers';

const genderLabel = (g) => ({ mens: "Men's", womens: "Women's", mixed: 'Mixed' }[g] || '');
const typeLabel = (t) => ({ singles: 'Singles', doubles: 'Doubles' }[t] || t);

const stageLabel = (s) => ({
  group: 'Group Stage', round_robin: 'Round Robin', round_of_32: 'R32',
  round_of_16: 'R16', quarterfinal: 'QF', semifinal: 'SF',
  third_place: 'Bronze', final: 'Final',
}[s] || s);

const STATUS_COLOUR = {
  draft: '#444',
  draw_generated: '#5588ff',
  in_progress: '#4ecb71',
  completed: '#d4a843',
};

function sideLabel(ids, allPlayers) {
  if (!ids?.length) return '?';
  return ids.map(id => {
    const p = allPlayers.find(x => x.id === id);
    return p ? p.name.split(' ')[0] : '?'; // first name only for brevity
  }).join(' / ');
}

function getEventProgress(event, matches, allPlayers) {
  const em = matches.filter(m => m.event_id === event.id);
  const total = em.length;
  const done = em.filter(m => m.status === 'finished' || m.status === 'locked').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Furthest stage reached (has at least one non-pending match)
  const STAGE_ORDER = ['group', 'round_robin', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'];
  const playedStages = em.filter(m => m.status !== 'pending').map(m => m.stage);
  const furthest = STAGE_ORDER.slice().reverse().find(s => playedStages.includes(s)) || null;

  // Count matches in the current active stage
  const stageMatches = furthest ? em.filter(m => m.stage === furthest) : [];
  const stageDone = stageMatches.filter(m => m.status === 'finished' || m.status === 'locked').length;
  const stageTotal = stageMatches.length;

  // Medal winners
  const finalMatch = em.find(m => m.stage === 'final' && m.winner && (m.status === 'finished' || m.status === 'locked'));
  const bronzeMatch = em.find(m => m.stage === 'third_place' && m.winner && (m.status === 'finished' || m.status === 'locked'));

  const gold = finalMatch ? (finalMatch.winner === 'side_a' ? finalMatch.side_a : finalMatch.side_b) : null;
  const silver = finalMatch ? (finalMatch.winner === 'side_a' ? finalMatch.side_b : finalMatch.side_a) : null;
  const bronze = bronzeMatch ? (bronzeMatch.winner === 'side_a' ? bronzeMatch.side_a : bronzeMatch.side_b) : null;

  return { total, done, pct, furthest, stageDone, stageTotal, gold, silver, bronze };
}

export default function TournamentSummary({ events, matches, allPlayers, onEventClick }) {
  if (!events.length) return null;

  return (
    <div className="pub-summary">
      {events.map(evt => {
        const { total, done, pct, furthest, stageDone, stageTotal, gold, silver, bronze } = getEventProgress(evt, matches, allPlayers);
        const evtLabel = [genderLabel(evt.gender), categoryLabel(evt.category), typeLabel(evt.type)].filter(Boolean).join(' ');

        return (
          <div key={evt.id} className="pub-summary-card" onClick={() => onEventClick && onEventClick(evt.id)}
            title="Click to view brackets">
            {/* Event name + status dot */}
            <div className="pub-summary-header">
              <span className="pub-summary-name">{evt.name}</span>
              <span className="pub-summary-status-dot" style={{ background: STATUS_COLOUR[evt.status] || '#444' }} />
            </div>

            <div className="pub-summary-label">{evtLabel}</div>

            {/* Progress bar */}
            {total > 0 && (
              <div className="pub-summary-bar-wrap">
                <div className="pub-summary-bar" style={{ width: `${pct}%` }} />
              </div>
            )}

            <div className="pub-summary-meta">
              {furthest && stageTotal > 0 && (
                <span className="pub-summary-stage">{stageLabel(furthest)}</span>
              )}
              {stageTotal > 0 && (
                <span className="pub-summary-matches">{stageDone}/{stageTotal}</span>
              )}
            </div>

            {/* Medal winners */}
            {gold && (
              <div className="pub-summary-medals">
                <div className="pub-summary-medal">🥇 {sideLabel(gold, allPlayers)}</div>
                {silver && <div className="pub-summary-medal">🥈 {sideLabel(silver, allPlayers)}</div>}
                {bronze && <div className="pub-summary-medal">🥉 {sideLabel(bronze, allPlayers)}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}