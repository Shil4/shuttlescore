import { useState, useEffect } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { MatchService } from '../../services/MatchService';
import { supabase } from '../../lib/supabase';
import MatchScorer from './MatchScorer';
import './AdminComponents.css';
import './MatchManager.css';

export default function MatchManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('all');
  const [matches, setMatches] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Scoring
  const [scoringMatchId, setScoringMatchId] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    loadTournaments();
  }, []);

  const loadTournaments = async () => {
    try {
      const data = await TournamentService.getAll();
      setTournaments(data);
      if (allPlayers.length === 0) {
        const { data: players } = await supabase.from('players').select('*').order('name');
        setAllPlayers(players || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    setLoading(true);
    try {
      const evts = await TournamentService.getEvents(tournament.id);
      setEvents(evts);
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

  // Start match (admin bypass — no referee required)
  const handleStartMatch = async (matchId) => {
    try {
      setError('');
      const match = matches.find(m => m.id === matchId);
      if (!match.side_a?.length || !match.side_b?.length) {
        setError('Both sides must be determined before starting.');
        return;
      }

      const initialScore = {
        sets: [{ side_a_points: 0, side_b_points: 0, point_log: [] }],
        current_set: 0,
      };

      await supabase
        .from('matches')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
          score_data: initialScore,
        })
        .eq('id', matchId);

      // Update event status
      await supabase
        .from('events')
        .update({ status: 'in_progress' })
        .eq('id', match.event_id)
        .in('status', ['draft', 'draw_generated']);

      await loadMatches(selectedTournament.id);
      setScoringMatchId(matchId);
    } catch (err) {
      setError('Failed to start match: ' + err.message);
    }
  };

  // Filter matches
  const filteredMatches = matches.filter(m => {
    if (selectedEventId !== 'all' && m.event_id !== selectedEventId) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    // Skip bye matches (locked with a winner but no opponent)
    if (m.status === 'locked' && (!m.side_a || !m.side_b)) return false;
    return true;
  });

  // Group by stage
  const stageOrder = ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];
  const matchesByStage = {};
  filteredMatches.forEach(m => {
    if (!matchesByStage[m.stage]) matchesByStage[m.stage] = [];
    matchesByStage[m.stage].push(m);
  });

  // Interleave group matches across groups:
  // Round 1: Group A match 1, Group B match 1, Group C match 1, ...
  // Round 2: Group A match 2, Group B match 2, Group C match 2, ...
  // This ensures no player plays 3+ matches in a row
  if (matchesByStage['group']) {
    const groupMatches = matchesByStage['group'];
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
    matchesByStage['group'] = interleaved;
  }

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

      {/* Match List by Stage */}
      {stageOrder.filter(s => matchesByStage[s]).map(stage => (
        <div key={stage} className="match-stage-group">
          <div className="match-stage-title">{stageLabel(stage)}</div>
          <div className="match-list">
            {(stage === 'group' ? matchesByStage[stage] : matchesByStage[stage].sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0))).map((m, idx) => (
              <div key={m.id} className={`match-card ${m.status}`}>
                <div className="match-card-header">
                  <span className="match-event-name">
                    {m._eventName}
                    {m._groupName && <span style={{ color: '#888', fontWeight: 400 }}>{' · '}{m._groupName}</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {stage === 'group' && <span style={{ fontSize: 10, color: '#555' }}>#{idx + 1}</span>}
                    {statusBadge(m.status)}
                  </div>
                </div>
                <div className="match-card-body">
                  <div className={`match-side ${m.winner === 'side_a' ? 'winner' : ''}`}>
                    <span className="match-side-name">{sideLabel(m.side_a)}</span>
                  </div>
                  <div className="match-score-area">
                    {m.score_data?.sets ? (
                      <div className="match-scores">{scoreDisplay(m)}</div>
                    ) : (
                      <span className="match-vs">vs</span>
                    )}
                  </div>
                  <div className={`match-side ${m.winner === 'side_b' ? 'winner' : ''}`}>
                    <span className="match-side-name">{sideLabel(m.side_b)}</span>
                  </div>
                </div>
                <div className="match-card-actions">
                  {m.status === 'pending' && m.side_a?.length > 0 && m.side_b?.length > 0 && (
                    <button className="admin-btn primary" onClick={() => handleStartMatch(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                      ▶ Start Match
                    </button>
                  )}
                  {m.status === 'in_progress' && (
                    <button className="admin-btn primary" onClick={() => setScoringMatchId(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                      🏸 Score Match
                    </button>
                  )}
                  {m.status === 'finished' && (
                    <button className="admin-btn secondary" onClick={() => setScoringMatchId(m.id)} style={{ fontSize: 12, padding: '5px 12px' }}>
                      ✏️ Edit Score
                    </button>
                  )}
                  {m.status === 'pending' && (!m.side_a?.length || !m.side_b?.length) && (
                    <span style={{ fontSize: 12, color: '#555' }}>Waiting for previous matches</span>
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