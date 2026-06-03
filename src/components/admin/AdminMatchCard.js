// ── Admin Match Card ──────────────────────────────────────────
import { stageLabel, statusBadge, scoreDisplay } from './matchManagerHelpers';

export default function AdminMatchCard({
  match: m, sectionKey, sideLabel, refName, adminProfiles,
  allReferees, allCourts,
  onAssignReferee, onAssignCourt, onStartMatch, onFalseStart,
  onDefaultWin, onScore,
}) {
  return (
    <div className={`match-card ${m.status} ${sectionKey === 'ready' ? 'ready-to-start' : ''}`}>
      <div className="match-card-header">
        <span className="match-event-name">
          {m._eventName}
          {m._groupName && <span style={{ color: '#888', fontWeight: 400 }}>{' · '}{m._groupName}</span>}
          {m.court_id && <span style={{ color: '#666', fontWeight: 400 }}>{' · 🏟️ '}{m.court_id}</span>}
          {m.scheduled_date && <span style={{ color: '#555', fontWeight: 400 }}>{' · 📅 '}{(() => { const p = m.scheduled_date.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : m.scheduled_date; })()}</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#555' }}>{stageLabel(m.stage)}</span>
          {m.override_log?.length > 0 && (
            <span title={`${m.override_log.length} override(s)`} style={{ fontSize: 10, color: '#d4a843' }}>
              ✏️{m.override_log.length}
            </span>
          )}
          {statusBadge(m.status)}
        </div>
      </div>

      <div className="match-card-body">
        <div className={`match-side ${m.winner === 'side_a' ? 'winner' : ''}`}>
          <span className="match-side-name">{sideLabel(m.side_a)}</span>
        </div>
        <div className="match-score-area">
          {m.default_win ? (
            <span style={{ color: '#d4a843', fontSize: 11, fontWeight: 600 }}>W/O</span>
          ) : m.score_data?.sets ? (
            <div className="match-scores">{scoreDisplay(m)}</div>
          ) : (
            <span className="match-vs">vs</span>
          )}
        </div>
        <div className={`match-side ${m.winner === 'side_b' ? 'winner' : ''}`}>
          <span className="match-side-name">{sideLabel(m.side_b)}</span>
        </div>
      </div>

      {/* Referee assignment */}
      <div className="match-referee-row">
        {m.status === 'pending' ? (
          <>
            <select
              value={m.referee_is_admin ? '__admin__' : (m.referee_id || '')}
              onChange={e => {
                const val = e.target.value;
                if (val === '__admin__') onAssignReferee(m.id, null, true);
                else onAssignReferee(m.id, val || null, false);
              }}
              className="match-referee-select">
              <option value="">Assign referee...</option>
              <option value="__admin__">🛡️ Admin (you)</option>
              {allReferees.filter(r => r.display_name).map(r => (
                <option key={r.id} value={r.id}>🏅 {r.display_name}</option>
              ))}
              {allReferees.filter(r => !r.display_name).map(r => (
                <option key={r.id} value={r.id}>🏅 {r.username} (no name)</option>
              ))}
            </select>
            {m.referee_id && !m.referee_is_admin && (
              <span style={{ fontSize: 11, color: m.referee_confirmed ? '#4ecb71' : '#d4a843' }}>
                {m.referee_confirmed ? '✓ ready' : '⏳ waiting'}
              </span>
            )}
            {m.referee_is_admin && (
              <span style={{ fontSize: 11, color: '#4ecb71' }}>✓ admin ref</span>
            )}
          </>
        ) : (
          <>
            {m.referee_id && <span className="match-referee-name">🏅 {refName(m.referee_id)}</span>}
            {m.referee_is_admin && (
              <span className="match-referee-name">🛡️ {(() => {
                const a = adminProfiles.find(p => p.id === m.referee_admin_id);
                return a ? (a.display_name || a.name) : 'Admin';
              })()}</span>
            )}
          </>
        )}
      </div>

      {/* Court assignment */}
      <div className="match-referee-row">
        {m.status === 'pending' && allCourts.length > 0 ? (
          <select value={m.court_id || ''} onChange={e => onAssignCourt(m.id, e.target.value)}
            className="match-referee-select" style={{ maxWidth: 160 }}>
            <option value="">Assign court...</option>
            {allCourts.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
        ) : m.court_id ? (
          <span style={{ fontSize: 12, color: '#888' }}>🏟️ {m.court_id}</span>
        ) : null}
      </div>

      {/* Actions */}
      <div className="match-card-actions">
        {sectionKey === 'ready' && (
          <button className="admin-btn primary" onClick={() => onStartMatch(m.id)}
            style={{ fontSize: 12, padding: '5px 12px' }}>▶ Start Match</button>
        )}
        {sectionKey === 'awaiting' && (
          <span style={{ fontSize: 12, color: '#d4a843' }}>⏳ Waiting for {refName(m.referee_id)} to confirm</span>
        )}
        {sectionKey === 'upcoming' && (
          <span style={{ fontSize: 12, color: '#555' }}>Assign a referee to proceed</span>
        )}
        {m.status === 'in_progress' && (
          <>
            <button className="admin-btn primary" onClick={() => onScore(m.id)}
              style={{ fontSize: 12, padding: '5px 12px' }}>🏸 Score Match</button>
            <button className="admin-btn secondary" onClick={() => onFalseStart(m.id)}
              style={{ fontSize: 12, padding: '5px 12px' }}>⚠️ False Start</button>
            <button className="admin-btn secondary" onClick={() => onDefaultWin(m.id, 'side_a')}
              style={{ fontSize: 11, padding: '4px 8px', color: '#d4a843' }}>
              W/O → {sideLabel(m.side_a)}
            </button>
            <button className="admin-btn secondary" onClick={() => onDefaultWin(m.id, 'side_b')}
              style={{ fontSize: 11, padding: '4px 8px', color: '#d4a843' }}>
              W/O → {sideLabel(m.side_b)}
            </button>
          </>
        )}
        {m.status === 'finished' && (
          <>
            <button className="admin-btn secondary" onClick={() => onScore(m.id)}
              style={{ fontSize: 12, padding: '5px 12px' }}>✏️ Edit Score</button>
            <button className="admin-btn secondary" onClick={() => onFalseStart(m.id)}
              style={{ fontSize: 12, padding: '5px 12px', color: '#e85454' }}>⚠️ False Start</button>
          </>
        )}
        {m.status === 'locked' && (
          <button className="admin-btn secondary" onClick={() => onScore(m.id)}
            style={{ fontSize: 12, padding: '5px 12px', color: '#d4a843' }}>🔓 Admin Override</button>
        )}
      </div>
    </div>
  );
}