import ScoreGraph from './ScoreGraph';
import { MedalIcon } from './MedalBadges';
import { sideLabel, stageLabel, formatDate, scoreDisplay, PairNames } from './helpers';

/**
 * MatchCard — renders a match in the overview tab
 * Medals only on finals (gold/silver) and bronze match (bronze for winner)
 */
export default function MatchCard({ match: m, allPlayers, onPlayerClick, onRefClick, refereeName, refId }) {
  const isLive = m.status === 'in_progress';
  const isFinished = m.status === 'finished' || m.status === 'locked';
  const isUpcoming = m.status === 'pending';

  const scores = scoreDisplay(m);
  const aLabel = sideLabel(m.side_a, allPlayers);
  const bLabel = sideLabel(m.side_b, allPlayers);

  // Medals: only on final and third_place matches
  let aMedal = null, bMedal = null;
  if (isFinished && m.winner) {
    if (m.stage === 'final') {
      aMedal = m.winner === 'side_a' ? 'gold' : 'silver';
      bMedal = m.winner === 'side_b' ? 'gold' : 'silver';
    } else if (m.stage === 'third_place') {
      if (m.winner === 'side_a') aMedal = 'bronze';
      if (m.winner === 'side_b') bMedal = 'bronze';
    }
  }

  return (
    <div className={'pub-match-card ' + (isLive ? 'live' : isUpcoming ? 'upcoming' : '')}>
      <div className="pub-match-event">
        {m._eventName} {'\u2014'} {m.stage === 'group' && m._groupName ? m._groupName : stageLabel(m.stage)}
        {m.court_id ? ' \u00B7 ' + m.court_id : ''}
        {m.scheduled_date ? ' \u00B7 ' + formatDate(m.scheduled_date) : ''}
      </div>
      <div className="pub-match-body">
        <div className={'pub-match-side ' + (m.winner === 'side_a' ? 'winner' : '')}>
          <span className="pub-match-name">
            <PairNames ids={m.side_a} allPlayers={allPlayers} onPlayerClick={onPlayerClick} className="clickable" />
            <MedalIcon type={aMedal} />
          </span>
        </div>
        <div className="pub-match-scores">
          {scores ? scores.map((s, i) => (
            <span key={i} className="pub-set-score" style={s.walkover ? { color: '#d4a843' } : {}}>{s.text}</span>
          )) : <span className="pub-match-vs-text">vs</span>}
        </div>
        <div className={'pub-match-side right ' + (m.winner === 'side_b' ? 'winner' : '')}>
          <span className="pub-match-name">
            <MedalIcon type={bMedal} />
            <PairNames ids={m.side_b} allPlayers={allPlayers} onPlayerClick={onPlayerClick} className="clickable" />
          </span>
        </div>
      </div>
      {refereeName && <div className="pub-match-referee" onClick={() => onRefClick && onRefClick(refId || m.referee_id)} style={{ cursor: 'pointer' }}>Referee: <span className="pub-ref-clickable">{refereeName}</span></div>}
      {m.court_id && !refereeName && <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 2 }}>{'\uD83C\uDFDF\uFE0F'} {m.court_id}</div>}

      {isLive && <ScoreGraph match={m} expanded={true} sideALabel={aLabel} sideBLabel={bLabel} />}
      {isFinished && m.score_data?.sets && !m.default_win && (
        <ScoreGraph match={m} expanded={false} sideALabel={aLabel} sideBLabel={bLabel} />
      )}
    </div>
  );
}