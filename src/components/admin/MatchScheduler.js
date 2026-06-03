// ── Match Scheduler ───────────────────────────────────────────
// Drag-to-reorder pending matches per court, assign dates per match.
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { sideLabelFn } from './matchManagerHelpers';
import './MatchScheduler.css';

const toDisplay = (iso) => {
  if (!iso) return '';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
};

export default function MatchScheduler({ matches, allPlayers, allCourts, events, onSaved }) {
  const sideLabel = sideLabelFn(allPlayers);
  const [eventFilter, setEventFilter] = useState('all');

  const pendingMatches = matches.filter(m => m.status === 'pending' && m.side_a?.length && m.side_b?.length);

  // courtData: courtId → { matchIds[] }
  // matchDates: matchId → ISO date string
  const buildState = (pending) => {
    const courtMap = {};
    const dateMap = {};
    allCourts.forEach(c => { if (!courtMap[c.id]) courtMap[c.id] = { matchIds: [] }; });
    pending.forEach(m => {
      const key = m.court_id || '__unassigned__';
      if (!courtMap[key]) courtMap[key] = { matchIds: [] };
      courtMap[key].matchIds.push(m.id);
      if (m.scheduled_date) dateMap[m.id] = m.scheduled_date;
    });
    if (!courtMap['__unassigned__']) courtMap['__unassigned__'] = { matchIds: [] };
    return { courtMap, dateMap };
  };

  const [courtData, setCourtData] = useState(() => buildState(pendingMatches).courtMap);
  const [matchDates, setMatchDates] = useState(() => buildState(pendingMatches).dateMap);
  const [userEdited, setUserEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Re-initialise when matches load — but not if user has started editing
  useEffect(() => {
    if (!userEdited) {
      const { courtMap, dateMap } = buildState(pendingMatches);
      setCourtData(courtMap);
      setMatchDates(dateMap);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const matchMap = {};
  pendingMatches.forEach(m => { matchMap[m.id] = m; });

  const courtOrder = Object.keys(courtData).filter(k => k !== '__unassigned__').sort()
    .concat(['__unassigned__']);
  const courtLabel = (key) => key === '__unassigned__' ? 'Unscheduled' : key;

  // ── Drag handlers ─────────────────────────────────────────
  const dragMatch = useRef(null);
  const dragOver  = useRef(null);

  const onDragStart = (matchId, fromCourt) => {
    dragMatch.current = { matchId, fromCourt };
    setUserEdited(true);
  };

  const onDragOverSlot = (e, toCourt, toIndex) => {
    e.preventDefault();
    dragOver.current = { toCourt, toIndex };
  };

  const onDrop = (e, toCourt) => {
    e.preventDefault();
    if (!dragMatch.current) return;
    const { matchId, fromCourt } = dragMatch.current;
    const toIndex = dragOver.current?.toIndex ?? courtData[toCourt]?.matchIds.length ?? 0;
    if (fromCourt === toCourt) {
      setCourtData(prev => {
        const ids = [...prev[fromCourt].matchIds];
        const oldIdx = ids.indexOf(matchId);
        if (oldIdx === -1) return prev;
        ids.splice(oldIdx, 1);
        ids.splice(toIndex > oldIdx ? toIndex - 1 : toIndex, 0, matchId);
        return { ...prev, [fromCourt]: { matchIds: ids } };
      });
    } else {
      setCourtData(prev => {
        const fromIds = prev[fromCourt].matchIds.filter(id => id !== matchId);
        const toIds = [...(prev[toCourt]?.matchIds || [])];
        toIds.splice(toIndex, 0, matchId);
        return {
          ...prev,
          [fromCourt]: { matchIds: fromIds },
          [toCourt]:   { matchIds: toIds },
        };
      });
    }
    dragMatch.current = null;
    dragOver.current  = null;
  };

  // Set date for a single match
  const onMatchDateChange = (matchId, date) => {
    setMatchDates(prev => ({ ...prev, [matchId]: date || '' }));
    setUserEdited(true);
    setSaved(false);
  };

  // Bulk set date for all matches on a court
  const onSetAllDates = (courtId, date) => {
    const ids = courtData[courtId]?.matchIds || [];
    setMatchDates(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = date || ''; });
      return next;
    });
    setUserEdited(true);
    setSaved(false);
  };

  // ── Save ──────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const updates = [];
      Object.entries(courtData).forEach(([courtId, { matchIds }]) => {
        matchIds.forEach(mid => {
          updates.push({
            id: mid,
            court_id: courtId === '__unassigned__' ? null : courtId,
            scheduled_date: matchDates[mid] || null,
          });
        });
      });
      for (const u of updates) {
        const { error: err } = await supabase.from('matches')
          .update({ court_id: u.court_id, scheduled_date: u.scheduled_date })
          .eq('id', u.id);
        if (err) throw err;
      }
      setSaved(true);
      setUserEdited(false);
      setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (pendingMatches.length === 0) {
    return <div className="scheduler-empty">No pending matches to schedule.</div>;
  }

  const visibleIds = new Set(
    eventFilter === 'all'
      ? pendingMatches.map(m => m.id)
      : pendingMatches.filter(m => m.event_id === eventFilter).map(m => m.id)
  );

  return (
    <div className="scheduler">
      <div className="scheduler-header">
        <span className="scheduler-title">📅 Schedule</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={eventFilter} onChange={e => setEventFilter(e.target.value)}
            style={{ background: '#14141f', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ccc', padding: '5px 10px', fontSize: 12 }}>
            <option value="all">All Events</option>
            {(events || []).map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          {error && <span style={{ fontSize: 12, color: '#e85454' }}>{error}</span>}
          {saved && <span style={{ fontSize: 12, color: '#4ecb71' }}>✓ Saved</span>}
          <button className="admin-btn primary" onClick={handleSave} disabled={saving}
            style={{ fontSize: 12, padding: '5px 14px' }}>
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>

      <p className="scheduler-hint">Drag matches between courts · Set dates per match or use "Set all" for a court.</p>

      <div className="scheduler-courts">
        {courtOrder.map(courtId => {
          const { matchIds } = courtData[courtId] || { matchIds: [] };
          const isUnassigned = courtId === '__unassigned__';
          const visibleMatchIds = matchIds.filter(mid => visibleIds.has(mid));
          return (
            <div key={courtId} className={'scheduler-court' + (isUnassigned ? ' unassigned' : '')}
              onDragOver={e => onDragOverSlot(e, courtId, matchIds.length)}
              onDrop={e => onDrop(e, courtId)}>

              <div className="scheduler-court-header">
                <span className="scheduler-court-name">{courtLabel(courtId)}</span>
                {!isUnassigned && (
                  <div className="scheduler-bulk-date">
                    <span style={{ fontSize: 10, color: '#555' }}>Set all:</span>
                    <input
                      type="date"
                      className="scheduler-date-native"
                      onChange={e => { if (e.target.value) onSetAllDates(courtId, e.target.value); }}
                      title="Set this date for all matches on this court"
                    />
                  </div>
                )}
              </div>

              <div className="scheduler-match-list">
                {matchIds.length === 0 && (
                  <div className="scheduler-drop-hint">Drop matches here</div>
                )}
                {visibleMatchIds.map((mid, idx) => {
                  const m = matchMap[mid];
                  if (!m) return null;
                  const matchDate = matchDates[mid] || '';
                  return (
                    <div key={mid}
                      className="scheduler-match"
                      draggable
                      onDragStart={() => onDragStart(mid, courtId)}
                      onDragOver={e => { e.preventDefault(); onDragOverSlot(e, courtId, idx); }}>
                      <div className="scheduler-match-grip">⠿</div>
                      <div className="scheduler-match-body">
                        <div className="scheduler-match-event">
                          {m._eventName}
                          {m._groupName && <span style={{ color: '#666' }}> · {m._groupName}</span>}
                        </div>
                        <div className="scheduler-match-sides">
                          <span>{sideLabel(m.side_a)}</span>
                          <span style={{ color: '#555', margin: '0 4px' }}>vs</span>
                          <span>{sideLabel(m.side_b)}</span>
                        </div>
                        {/* Per-match date */}
                        <div className="scheduler-match-date-row">
                          <input
                            type="date"
                            value={matchDate}
                            onChange={e => onMatchDateChange(mid, e.target.value)}
                            className="scheduler-date-native"
                          />
                          {matchDate && (
                            <span className="scheduler-match-date-display">{toDisplay(matchDate)}</span>
                          )}
                          {matchDate && (
                            <button className="scheduler-date-clear" onClick={() => onMatchDateChange(mid, '')}
                              title="Clear date">×</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="scheduler-court-footer">
                {visibleMatchIds.length} match{visibleMatchIds.length !== 1 ? 'es' : ''}
                {eventFilter !== 'all' && matchIds.length !== visibleMatchIds.length
                  ? ` (${matchIds.length} total)` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}