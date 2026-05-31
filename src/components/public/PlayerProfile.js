import { getPlayerAge } from '../admin/PlayerManager';
import MedalBadges from './MedalBadges';
import { sideLabel, stageLabel, scoreDisplay, calcMedals } from './helpers';

/**
 * PlayerProfile — quick popup overlay showing current tournament stats
 * Props: player, matches (current tournament), allMatches (all), events, allPlayers,
 *        tournamentName, onClose, onPlayerClick, onRefClick, onViewHistory, refereeName(id)
 */
export default function PlayerProfile({
  player, matches, allMatches, events, allPlayers,
  tournamentName, onClose, onPlayerClick, onViewHistory, onRefClick, refereeNameFn,
}) {
  if (!player) return null;

  const playerId = player.id;
  const age = getPlayerAge(player);
  const medals = calcMedals(playerId, allMatches, events);

  const finished = matches.filter(m => m.status === 'finished' || m.status === 'locked');
  const won = finished.filter(m =>
    (m.winner === 'side_a' && (m.side_a || []).includes(playerId)) ||
    (m.winner === 'side_b' && (m.side_b || []).includes(playerId))
  ).length;
  const lost = finished.filter(m =>
    (m.winner === 'side_a' && (m.side_b || []).includes(playerId)) ||
    (m.winner === 'side_b' && (m.side_a || []).includes(playerId))
  ).length;

  return (
    <div className="pub-overlay" onClick={onClose}>
      <div className="pub-profile-card" onClick={e => e.stopPropagation()}>
        <button className="pub-profile-close" onClick={onClose}>{'\u2715'}</button>
        <div className="pub-profile-name">{player.name}</div>
        <div className="pub-profile-meta">
          <span className="pub-profile-badge">{player.gender === 'female' ? 'F' : 'M'}</span>
          {age != null && <span className="pub-profile-badge">{age} years</span>}
        </div>

        <MedalBadges medals={medals} />

        <div className="pub-profile-stats">
          <div className="pub-profile-stat">
            <span className="pub-profile-stat-num">{finished.length}</span>
            <span className="pub-profile-stat-label">Played</span>
          </div>
          <div className="pub-profile-stat">
            <span className="pub-profile-stat-num" style={{ color: '#4ecb71' }}>{won}</span>
            <span className="pub-profile-stat-label">Won</span>
          </div>
          <div className="pub-profile-stat">
            <span className="pub-profile-stat-num" style={{ color: '#ff6655' }}>{lost}</span>
            <span className="pub-profile-stat-label">Lost</span>
          </div>
        </div>

        <div className="pub-profile-matches-title">Matches in {tournamentName}</div>
        {matches.length === 0 ? (
          <p style={{ color: '#555', fontSize: 13 }}>No matches yet.</p>
        ) : (
          <div className="pub-profile-matches">
            {matches.filter(m => m.side_a && m.side_b).map(m => {
              const isA = (m.side_a || []).includes(playerId);
              const isWon = (isA && m.winner === 'side_a') || (!isA && m.winner === 'side_b');
              const isFinished = m.status === 'finished' || m.status === 'locked';
              const scores = scoreDisplay(m);

              return (
                <div key={m.id} className={'pub-match-mini ' + (m.status === 'in_progress' ? 'live' : '')}>
                  <div style={{ width: '100%' }}>
                    <div className="pub-match-mini-header">
                      <span className="pub-match-mini-event">{m._eventName}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="pub-match-mini-stage">{stageLabel(m.stage)}</span>
                        {m.status === 'in_progress' && <span style={{ fontSize: 9, color: '#4ecb71', fontWeight: 700 }}>LIVE</span>}
                        {isFinished && <span className={'pub-result-badge ' + (isWon ? 'win' : 'loss')}>{isWon ? 'W' : 'L'}</span>}
                      </div>
                    </div>
                    <div className="pub-match-mini-sides">
                      <span className={isA && isWon ? 'won' : ''} onClick={() => m.side_a?.[0] && onPlayerClick(m.side_a[0])}>{sideLabel(m.side_a, allPlayers)}</span>
                      <span className="pub-match-mini-score">
                        {scores ? scores.map((s, i) => <span key={i} className="pub-set-score" style={s.walkover ? { color: '#d4a843', fontSize: 10 } : { fontSize: 10 }}>{s.text}</span>) : 'vs'}
                      </span>
                      <span className={!isA && isWon ? 'won' : ''} onClick={() => m.side_b?.[0] && onPlayerClick(m.side_b[0])}>{sideLabel(m.side_b, allPlayers)}</span>
                    </div>
                    {refereeNameFn && refereeNameFn(m.referee_id) && (
                      <div className="pub-match-mini-ref" onClick={() => onRefClick && onRefClick(m.referee_id)} style={{ cursor: 'pointer' }}>
                        {'\uD83C\uDFC5'} <span className="pub-ref-clickable">{refereeNameFn(m.referee_id)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button className="pub-full-history-btn" onClick={onViewHistory}>
          {'\uD83D\uDCCA'} View Full History Across All Tournaments
        </button>
      </div>
    </div>
  );
}