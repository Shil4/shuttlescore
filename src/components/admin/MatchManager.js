import { useState, useEffect, useRef } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { MatchService } from '../../services/MatchService';
import { RealtimeService } from '../../services/RealtimeService';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import MatchScorer from './MatchScorer';
import './AdminComponents.css';
import './MatchManager.css';

export default function MatchManager() {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('all');
  const [matches, setMatches] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [allGroups, setAllGroups] = useState([]); // eslint-disable-line no-unused-vars
  const [allReferees, setAllReferees] = useState([]);
  const [allCourts, setAllCourts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Scoring
  const [scoringMatchId, setScoringMatchId] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');

  // Realtime ref
  const selectedTournamentRef = useRef(null);

  useEffect(() => {
    loadTournaments();

    // Subscribe to match changes
    const unsub = RealtimeService.subscribeToMatches(() => {
      if (selectedTournamentRef.current) {
        loadMatches(selectedTournamentRef.current);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTournaments = async () => {
    try {
      const data = await TournamentService.getAll();
      setTournaments(data);
      if (allPlayers.length === 0) {
        const { data: players } = await supabase.from('players').select('*').order('name');
        setAllPlayers(players || []);
      }
      const { data: refs } = await supabase.from('referees').select('*').order('username');
      setAllReferees(refs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    selectedTournamentRef.current = tournament.id;
    setLoading(true);
    try {
      const evts = await TournamentService.getEvents(tournament.id);
      setEvents(evts);
      const { data: c } = await supabase.from('courts').select('*').eq('tournament_id', tournament.id).order('id');
      setAllCourts(c || []);
      await loadMatches(tournament.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMatches = async (tournamentId) => {
    try {
      const evts = await TournamentService.getEvents(tournamentId);
      const allMatches = [];
      const groupMap = {};
      for (const evt of evts) {
        const eventMatches = await MatchService.getByEvent(evt.id);
        const { data: groups } = await supabase.from('groups').select('*').eq('event_id', evt.id);
        (groups || []).forEach(g => { groupMap[g.id] = g.name; });
        allMatches.push(...eventMatches.map(m => ({
          ...m, _eventName: evt.name, _eventType: evt.type,
          _groupName: m.group_id ? groupMap[m.group_id] || '' : '',
        })));
      }
      setMatches(allMatches);
      setAllGroups(Object.entries(groupMap).map(([id, name]) => ({ id, name })));
    } catch (err) {
      setError('Failed to load matches: ' + err.message);
    }
  };

  const playerName = (id) => {
    if (!id) return 'BYE';
    return allPlayers.find(p => p.id === id)?.name || id.substring(0, 8);
  };

  const sideLabel = (sideArr) => {
    if (!sideArr || sideArr.length === 0) return 'TBD';
    return sideArr.map(playerName).join(' & ');
  };

  const stageLabel = (s) => ({
    group: 'Group', round_of_32: 'R32', round_of_16: 'R16',
    quarterfinal: 'QF', semifinal: 'SF', final: 'Final'
  }[s] || s);

  const statusBadge = (status) => {
    const colors = {
      pending: { color: '#888', bg: '#1e1e2e' },
      in_progress: { color: '#4ecb71', bg: '#152a15' },
      finished: { color: '#d4a843', bg: '#2a2215' },
      locked: { color: '#666', bg: '#1a1a1a' },
    };
    const c = colors[status] || colors.pending;
    return (
      <span className="match-status-badge" style={{ color: c.color, background: c.bg, borderColor: c.color }}>
        {status === 'in_progress' ? 'LIVE' : status.toUpperCase()}
      </span>
    );
  };

  const scoreDisplay = (match) => {
    if (!match.score_data?.sets) return null;
    return match.score_data.sets.map((set, i) => (
      <span key={i} className="match-set-score">
        {set.side_a_points}-{set.side_b_points}
      </span>
    ));
  };

  // Assign referee to match
  const handleAssignReferee = async (matchId, refereeId, isAdmin) => {
    try {
      setError('');
      const update = {
        referee_confirmed: false,
        referee_is_admin: !!isAdmin,
      };
      if (isAdmin) {
        update.referee_id = null;
        update.referee_confirmed = true;
      } else if (refereeId) {
        update.referee_id = refereeId;
      } else {
        // Unassigning
        update.referee_id = null;
        update.referee_is_admin = false;
      }
      const { error: updateErr } = await supabase.from('matches').update(update).eq('id', matchId);
      if (updateErr) { setError('Failed to assign referee: ' + updateErr.message); return; }
      await loadMatches(selectedTournament.id);
    } catch (err) { setError('Failed to assign referee: ' + err.message); }
  };

  // Assign court to match
  const handleAssignCourt = async (matchId, courtId) => {
    try {
      setError('');
      const { error: updateErr } = await supabase.from('matches').update({ court_id: courtId || null }).eq('id', matchId);
      if (updateErr) { setError('Failed to assign court: ' + updateErr.message); return; }
      await loadMatches(selectedTournament.id);
    } catch (err) { setError('Failed to assign court: ' + err.message); }
  };

  // Start match — requires referee assignment OR admin-as-referee
  const handleStartMatch = async (matchId) => {
    try {
      setError('');
      const match = matches.find(m => m.id === matchId);
      if (!match.side_a?.length || !match.side_b?.length) {
        setError('Both sides must be determined before starting.');
        return;
      }
      if (!match.referee_id && !match.referee_is_admin) {
        setError('Assign a referee before starting the match.');
        return;
      }
      if (!match.referee_is_admin && !match.referee_confirmed) {
        setError('Referee hasn\'t confirmed yet. They need to click "Ready to Start" first.');
        return;
      }

      const initialScore = {
        sets: [{ side_a_points: 0, side_b_points: 0, point_log: [] }],
        current_set: 0,
      };

      await supabase.from('matches').update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        score_data: initialScore,
      }).eq('id', matchId);

      await supabase.from('events').update({ status: 'in_progress' })
        .eq('id', match.event_id).in('status', ['draft', 'draw_generated']);

      await loadMatches(selectedTournament.id);
      // Only open scoring if admin is refereeing this match
      if (match.referee_is_admin) {
        setScoringMatchId(matchId);
      }
    } catch (err) {
      setError('Failed to start match: ' + err.message);
    }
  };

  // False start — revert match to pending
  const handleFalseStart = async (matchId) => {
    if (!window.confirm('False start? This will revert the match to pending and clear any score data.')) return;
    try {
      await supabase.from('matches').update({
        status: 'pending',
        started_at: null,
        score_data: null,
        winner: null,
        referee_confirmed: false,
      }).eq('id', matchId);
      setSuccess('Match reverted to pending.');
      setTimeout(() => setSuccess(''), 3000);
      await loadMatches(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  // Default win (walkover / injury / no-show)
  const handleDefaultWin = async (matchId, winningSide) => {
    const winLabel = winningSide === 'side_a' ? 'Side A' : 'Side B';
    if (!window.confirm('Award default win (walkover) to ' + winLabel + '?')) return;
    try {
      await supabase.from('matches').update({
        status: 'finished',
        winner: winningSide,
        default_win: winningSide,
        finished_at: new Date().toISOString(),
      }).eq('id', matchId);
      setSuccess('Default win awarded.');
      setTimeout(() => setSuccess(''), 3000);
      await loadMatches(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  const refName = (refId) => {
    if (!refId) return null;
    const ref = allReferees.find(r => r.id === refId);
    return ref?.display_name || ref?.username || '?';
  };

  // Filter matches
  const filteredMatches = matches.filter(m => {
    if (selectedEventId !== 'all' && m.event_id !== selectedEventId) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    // Skip bye matches (locked with a winner but no opponent)
    if (m.status === 'locked' && (!m.side_a || !m.side_b)) return false;
    return true;
  });

  // ── Categorize matches into sections ──
  // Keep interleaved order within each section
  const interleavedOrder = (matchList) => {
    // For group-stage matches, interleave across groups
    const groupMatches = matchList.filter(m => m.stage === 'group');
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
    return [...interleaved, ...nonGroupMatches.sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0))];
  };

  // Build ordered match list preserving interleaved order, then partition by status
  const allOrdered = interleavedOrder(filteredMatches);

  const liveMatches = allOrdered.filter(m => m.status === 'in_progress');
  const readyToStart = allOrdered.filter(m => m.status === 'pending' && (m.referee_is_admin || (m.referee_id && m.referee_confirmed)));
  const awaitingRef = allOrdered.filter(m => m.status === 'pending' && m.referee_id && !m.referee_confirmed && !m.referee_is_admin);
  const upcoming = allOrdered.filter(m => m.status === 'pending' && !m.referee_id && !m.referee_is_admin && m.side_a?.length && m.side_b?.length);
  const waitingForPlayers = allOrdered.filter(m => m.status === 'pending' && (!m.side_a?.length || !m.side_b?.length) && !m.referee_id && !m.referee_is_admin);
  const completed = allOrdered.filter(m => m.status === 'finished' || m.status === 'locked');

  const sections = [
    { key: 'live', title: '🔴 Live', matches: liveMatches, color: '#4ecb71' },
    { key: 'ready', title: '✅ Ready to Start', matches: readyToStart, color: '#4ecb71' },
    { key: 'awaiting', title: '⏳ Awaiting Referee Confirmation', matches: awaitingRef, color: '#d4a843' },
    { key: 'upcoming', title: '📋 Upcoming', matches: upcoming, color: '#888' },
    { key: 'waiting', title: '⏸ Waiting for Previous Matches', matches: waitingForPlayers, color: '#555' },
    { key: 'completed', title: '✓ Completed', matches: completed, color: '#666' },
  ];

  const stats = {
    total: matches.filter(m => m.side_a && m.side_b).length,
    pending: matches.filter(m => m.status === 'pending' && m.side_a && m.side_b).length,
    live: matches.filter(m => m.status === 'in_progress').length,
    finished: matches.filter(m => m.status === 'finished' || m.status === 'locked').length,
  };

  // ── Render ──

  if (scoringMatchId) {
    return (
      <MatchScorer
        matchId={scoringMatchId}
        allPlayers={allPlayers}
        onBack={() => {
          setScoringMatchId(null);
          loadMatches(selectedTournament.id);
        }}
      />
    );
  }

  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;

  if (!selectedTournament) {
    return (
      <div className="admin-section">
        <div className="admin-section-header"><h2>Matches</h2></div>
        <p style={{ color: '#888', marginBottom: 16 }}>Select a tournament:</p>
        {tournaments.length === 0 ? (
          <div className="admin-empty"><p>No tournaments yet.</p></div>
        ) : (
          <div className="admin-list">
            {tournaments.map(t => (
              <div key={t.id} className="admin-list-item" style={{ cursor: 'pointer' }} onClick={() => selectTournament(t)}>
                <div className="admin-list-main">
                  <div className="admin-list-title">{t.name}</div>
                  <div className="admin-list-meta">{t.venue && <span>{t.venue}</span>}</div>
                </div>
                <span style={{ color: '#d4a843', fontSize: 18 }}>→</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-section" style={{ maxWidth: 1000 }}>
      <div className="admin-section-header">
        <div>
          <button className="admin-btn secondary" onClick={() => { setSelectedTournament(null); setMatches([]); }} style={{ marginBottom: 8 }}>← Back</button>
          <h2>{selectedTournament.name} — Matches</h2>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      {/* Stats */}
      <div className="match-stats-bar">
        <div className="match-stat">
          <span className="match-stat-num">{stats.total}</span>
          <span className="match-stat-label">Total</span>
        </div>
        <div className="match-stat">
          <span className="match-stat-num" style={{ color: '#888' }}>{stats.pending}</span>
          <span className="match-stat-label">Pending</span>
        </div>
        <div className="match-stat">
          <span className="match-stat-num" style={{ color: '#4ecb71' }}>{stats.live}</span>
          <span className="match-stat-label">Live</span>
        </div>
        <div className="match-stat">
          <span className="match-stat-num" style={{ color: '#d4a843' }}>{stats.finished}</span>
          <span className="match-stat-label">Done</span>
        </div>
      </div>

      {/* Filters */}
      <div className="match-filters">
        <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
          <option value="all">All Events</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="finished">Finished</option>
          <option value="locked">Locked</option>
        </select>
        <button className="admin-btn secondary" onClick={() => loadMatches(selectedTournament.id)} style={{ fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* Match List by Section */}
      {sections.filter(s => s.matches.length > 0).map(section => (
        <div key={section.key} className="match-stage-group">
          <div className="match-stage-title" style={{ color: section.color, borderColor: section.color }}>
            {section.title} ({section.matches.length})
          </div>
          <div className="match-list">
            {section.matches.map((m, idx) => (
              <div key={m.id} className={`match-card ${m.status} ${section.key === 'ready' ? 'ready-to-start' : ''}`}>
                <div className="match-card-header">
                  <span className="match-event-name">
                    {m._eventName}
                    {m._groupName && <span style={{ color: '#888', fontWeight: 400 }}>{' · '}{m._groupName}</span>}
                    {m.court_id && <span style={{ color: '#666', fontWeight: 400 }}>{' · 🏟️ '}{m.court_id}</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#555' }}>{stageLabel(m.stage)}</span>
                    {m.override_log?.length > 0 && <span title={`${m.override_log.length} override(s)`} style={{ fontSize: 10, color: '#d4a843' }}>✏️{m.override_log.length}</span>}
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
                      <select value={m.referee_is_admin ? '__admin__' : (m.referee_id || '')}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '__admin__') handleAssignReferee(m.id, null, true);
                          else handleAssignReferee(m.id, val || null, false);
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
                      {m.referee_is_admin && <span className="match-referee-name">🛡️ Admin{user?.profile?.display_name ? ` (${user.profile.display_name})` : ''}</span>}
                    </>
                  )}
                </div>
                {/* Court assignment */}
                <div className="match-referee-row">
                  {m.status === 'pending' && allCourts.length > 0 ? (
                    <select value={m.court_id || ''} onChange={e => handleAssignCourt(m.id, e.target.value)}
                      className="match-referee-select" style={{ maxWidth: 160 }}>
                      <option value="">Assign court...</option>
                      {allCourts.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  ) : m.court_id ? (
                    <span style={{ fontSize: 12, color: '#888' }}>🏟️ {m.court_id}</span>
                  ) : null}
                </div>
                <div className="match-card-actions">
                  {section.key === 'ready' && (
                    <button className="admin-btn primary" onClick={() => handleStartMatch(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                      ▶ Start Match
                    </button>
                  )}
                  {section.key === 'awaiting' && (
                    <span style={{ fontSize: 12, color: '#d4a843' }}>⏳ Waiting for {refName(m.referee_id)} to confirm</span>
                  )}
                  {section.key === 'upcoming' && (
                    <span style={{ fontSize: 12, color: '#555' }}>Assign a referee to proceed</span>
                  )}
                  {m.status === 'in_progress' && (
                    <>
                      <button className="admin-btn primary" onClick={() => setScoringMatchId(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                        🏸 Score Match
                      </button>
                      <button className="admin-btn secondary" onClick={() => handleFalseStart(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                        ⚠️ False Start
                      </button>
                      <button className="admin-btn secondary" onClick={() => handleDefaultWin(m.id, 'side_a')} style={{ fontSize: 11, padding: '4px 8px', color: '#d4a843' }}>
                        W/O → {sideLabel(m.side_a)}
                      </button>
                      <button className="admin-btn secondary" onClick={() => handleDefaultWin(m.id, 'side_b')} style={{ fontSize: 11, padding: '4px 8px', color: '#d4a843' }}>
                        W/O → {sideLabel(m.side_b)}
                      </button>
                    </>
                  )}
                  {m.status === 'finished' && (
                    <>
                      <button className="admin-btn secondary" onClick={() => setScoringMatchId(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                        ✏️ Edit Score
                      </button>
                      <button className="admin-btn secondary" onClick={() => handleFalseStart(m.id)} style={{ fontSize: 12, padding: '5px 12px', color: '#e85454' }}>
                        ⚠️ False Start
                      </button>
                    </>
                  )}
                  {m.status === 'locked' && (
                    <button className="admin-btn secondary" onClick={() => setScoringMatchId(m.id)} style={{ fontSize: 12, padding: '5px 12px', color: '#d4a843' }}>
                      🔓 Admin Override
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filteredMatches.length === 0 && (
        <div className="admin-empty">
          <p>{matches.length === 0 ? 'No matches yet. Generate draws first.' : 'No matches match the current filter.'}</p>
        </div>
      )}
    </div>
  );
}