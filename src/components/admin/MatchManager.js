import { useState, useEffect, useRef } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { MatchService } from '../../services/MatchService';
import { RealtimeService } from '../../services/RealtimeService';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import MatchScorer from './MatchScorer';
import AdminMatchCard from './AdminMatchCard';
import { sideLabelFn, interleavedOrder, buildSections } from './matchManagerHelpers';
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
  const [allReferees, setAllReferees] = useState([]);
  const [adminProfiles, setAdminProfiles] = useState([]);
  const [allCourts, setAllCourts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [scoringMatchId, setScoringMatchId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const selectedTournamentRef = useRef(null);

  useEffect(() => {
    loadTournaments();
    const unsub = RealtimeService.subscribeToMatches(() => {
      if (selectedTournamentRef.current) loadMatches(selectedTournamentRef.current);
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
      const { data: admins } = await supabase.from('profiles').select('id, display_name, name').eq('role', 'admin');
      setAdminProfiles(admins || []);
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
      const allMatchesList = [];
      const groupMap = {};
      for (const evt of evts) {
        const eventMatches = await MatchService.getByEvent(evt.id);
        const { data: groups } = await supabase.from('groups').select('*').eq('event_id', evt.id);
        (groups || []).forEach(g => { groupMap[g.id] = g.name; });
        allMatchesList.push(...eventMatches.map(m => ({
          ...m, _eventName: evt.name, _eventType: evt.type,
          _groupName: m.group_id ? groupMap[m.group_id] || '' : '',
        })));
      }
      setMatches(allMatchesList);
    } catch (err) {
      setError('Failed to load matches: ' + err.message);
    }
  };

  const sideLabel = sideLabelFn(allPlayers);
  const refName = (refId) => {
    if (!refId) return null;
    const ref = allReferees.find(r => r.id === refId);
    return ref?.display_name || ref?.username || '?';
  };

  // ── Handlers ──────────────────────────────────────────────
  const handleAssignReferee = async (matchId, refereeId, isAdmin) => {
    try {
      setError('');
      const update = { referee_confirmed: false, referee_is_admin: !!isAdmin };
      if (isAdmin) {
        update.referee_id = null;
        update.referee_confirmed = true;
        update.referee_admin_id = user?.profile?.id || null;
      } else if (refereeId) {
        update.referee_id = refereeId;
        update.referee_admin_id = null;
      } else {
        update.referee_id = null;
        update.referee_is_admin = false;
        update.referee_admin_id = null;
      }
      const { error: updateErr } = await supabase.from('matches').update(update).eq('id', matchId);
      if (updateErr) { setError('Failed to assign referee: ' + updateErr.message); return; }
      await loadMatches(selectedTournament.id);
    } catch (err) { setError('Failed to assign referee: ' + err.message); }
  };

  const handleAssignCourt = async (matchId, courtId) => {
    try {
      setError('');
      const { error: updateErr } = await supabase.from('matches').update({ court_id: courtId || null }).eq('id', matchId);
      if (updateErr) { setError('Failed to assign court: ' + updateErr.message); return; }
      await loadMatches(selectedTournament.id);
    } catch (err) { setError('Failed to assign court: ' + err.message); }
  };

  const handleStartMatch = async (matchId) => {
    try {
      setError('');
      const match = matches.find(m => m.id === matchId);
      if (!match.side_a?.length || !match.side_b?.length) { setError('Both sides must be determined before starting.'); return; }
      if (!match.referee_id && !match.referee_is_admin) { setError('Assign a referee before starting the match.'); return; }
      if (!match.referee_is_admin && !match.referee_confirmed) { setError('Referee hasn\'t confirmed yet.'); return; }
      const initialScore = { sets: [{ side_a_points: 0, side_b_points: 0, point_log: [] }], current_set: 0 };
      await supabase.from('matches').update({ status: 'in_progress', started_at: new Date().toISOString(), score_data: initialScore }).eq('id', matchId);
      await supabase.from('events').update({ status: 'in_progress' }).eq('id', match.event_id).in('status', ['draft', 'draw_generated']);
      await loadMatches(selectedTournament.id);
      if (match.referee_is_admin) setScoringMatchId(matchId);
    } catch (err) { setError('Failed to start match: ' + err.message); }
  };

  const handleFalseStart = async (matchId) => {
    if (!window.confirm('False start? This will revert the match to pending and clear any score data.')) return;
    try {
      await supabase.from('matches').update({ status: 'pending', started_at: null, score_data: null, winner: null, referee_confirmed: false }).eq('id', matchId);
      setSuccess('Match reverted to pending.');
      setTimeout(() => setSuccess(''), 3000);
      await loadMatches(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  const handleDefaultWin = async (matchId, winningSide) => {
    if (!window.confirm('Award default win (walkover) to ' + (winningSide === 'side_a' ? 'Side A' : 'Side B') + '?')) return;
    try {
      await supabase.from('matches').update({ status: 'finished', winner: winningSide, default_win: winningSide, finished_at: new Date().toISOString() }).eq('id', matchId);
      setSuccess('Default win awarded.');
      setTimeout(() => setSuccess(''), 3000);
      await loadMatches(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  // ── Filtered + sectioned matches ──────────────────────────
  const filteredMatches = matches.filter(m => {
    if (selectedEventId !== 'all' && m.event_id !== selectedEventId) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (m.status === 'locked' && (!m.side_a || !m.side_b)) return false;
    return true;
  });
  const allOrdered = interleavedOrder(filteredMatches);
  const sections = buildSections(allOrdered);

  const stats = {
    total:    matches.filter(m => m.side_a && m.side_b).length,
    pending:  matches.filter(m => m.status === 'pending' && m.side_a && m.side_b).length,
    live:     matches.filter(m => m.status === 'in_progress').length,
    finished: matches.filter(m => m.status === 'finished' || m.status === 'locked').length,
  };

  const sharedCardProps = {
    sideLabel, refName, adminProfiles, allReferees, allCourts,
    onAssignReferee: handleAssignReferee,
    onAssignCourt: handleAssignCourt,
    onStartMatch: handleStartMatch,
    onFalseStart: handleFalseStart,
    onDefaultWin: handleDefaultWin,
    onScore: setScoringMatchId,
  };

  // ── Render ────────────────────────────────────────────────
  if (scoringMatchId) {
    return (
      <MatchScorer matchId={scoringMatchId} allPlayers={allPlayers}
        onBack={() => { setScoringMatchId(null); loadMatches(selectedTournament.id); }} />
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

      {/* Stats bar */}
      <div className="match-stats-bar">
        <div className="match-stat"><span className="match-stat-num">{stats.total}</span><span className="match-stat-label">Total</span></div>
        <div className="match-stat"><span className="match-stat-num" style={{ color: '#888' }}>{stats.pending}</span><span className="match-stat-label">Pending</span></div>
        <div className="match-stat"><span className="match-stat-num" style={{ color: '#4ecb71' }}>{stats.live}</span><span className="match-stat-label">Live</span></div>
        <div className="match-stat"><span className="match-stat-num" style={{ color: '#d4a843' }}>{stats.finished}</span><span className="match-stat-label">Done</span></div>
      </div>

      <div className="match-filters">
        <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
          <option value="all">All Events</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="finished">Finished</option>
          <option value="locked">Locked</option>
        </select>
        <button className="admin-btn secondary" onClick={() => loadMatches(selectedTournament.id)} style={{ fontSize: 12 }}>↻ Refresh</button>
      </div>

      {sections.filter(s => s.matches.length > 0).map(section => (
        <div key={section.key} className="match-stage-group">
          <div className="match-stage-title" style={{ color: section.color, borderColor: section.color }}>
            {section.title} ({section.matches.length})
          </div>
          <div className="match-list">
            {section.matches.map(m => (
              <AdminMatchCard key={m.id} match={m} sectionKey={section.key} {...sharedCardProps} />
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