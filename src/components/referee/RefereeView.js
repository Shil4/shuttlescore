import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { TournamentService } from '../../services/TournamentService';
import { MatchService } from '../../services/MatchService';
import { RealtimeService } from '../../services/RealtimeService';
import { supabase } from '../../lib/supabase';
import MatchScorer from '../admin/MatchScorer';
import './RefereeView.css';

export default function RefereeView() {
  const { referee, refereeLogout, refreshReferee } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [matches, setMatches] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('my_matches');
  const [scoringMatchId, setScoringMatchId] = useState(null);

  // First-time setup
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupPlayerId, setSetupPlayerId] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [showPlayerLink, setShowPlayerLink] = useState(false);

  // Realtime ref
  const selectedTournamentRef = useRef(null);

  useEffect(() => {
    if (!referee) return;
    if (!referee.display_name) {
      setNeedsSetup(true);
      loadPlayersForSetup();
    } else {
      setNeedsSetup(false);
      loadData();
    }

    // Subscribe to match changes
    const unsub = RealtimeService.subscribeToMatches(() => {
      if (selectedTournamentRef.current) {
        reloadMatches(selectedTournamentRef.current);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referee]);

  const loadPlayersForSetup = async () => {
    const [{ data: p }, { data: f }] = await Promise.all([
      supabase.from('players').select('*').order('name'),
      supabase.from('player_folders').select('*').order('sort_order').order('name'),
    ]);
    setAllPlayers(p || []);
    setAllFolders(f || []);
    setLoading(false);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const tourns = await TournamentService.getAll();
      setTournaments(tourns);
      const active = tourns.find(t => t.status === 'in_progress') || tourns[0];
      if (active) await selectTournament(active);
      else setLoading(false);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    selectedTournamentRef.current = tournament.id;
    setLoading(true);
    try {
      // Load players from pool
      const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', tournament.id);
      const playerIds = (tp || []).map(r => r.player_id);
      if (playerIds.length > 0) {
        const { data } = await supabase.from('players').select('*').in('id', playerIds).order('name');
        setAllPlayers(data || []);
      }
      const evts = await TournamentService.getEvents(tournament.id);
      setEvents(evts);

      // Load all matches
      await reloadMatches(tournament.id, evts);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // Lightweight match reload for realtime updates
  const reloadMatches = async (tournamentId, evtsList) => {
    try {
      const evts = evtsList || events;
      if (evts.length === 0) {
        const loadedEvts = await TournamentService.getEvents(tournamentId);
        evtsList = loadedEvts;
      }
      const allMatches = [];
      for (const evt of (evtsList || evts)) {
        const eventMatches = await MatchService.getByEvent(evt.id);
        allMatches.push(...eventMatches.map(m => ({ ...m, _eventName: evt.name })));
      }
      setMatches(allMatches);
    } catch (err) { console.error('Realtime reload error:', err); }
  };

  const handleSetupSubmit = async (e) => {
    e.preventDefault();
    if (!setupName.trim()) return;
    try {
      const update = { display_name: setupName.trim() };
      if (setupPlayerId) update.player_id = setupPlayerId;
      await supabase.from('referees').update(update).eq('id', referee.id);
      await refreshReferee();
    } catch (err) { setError(err.message); }
  };

  const handleConfirmStart = async (matchId) => {
    try {
      const { error: err } = await supabase.from('matches').update({ referee_confirmed: true }).eq('id', matchId);
      if (err) throw err;
      setError('');
      // Reload matches
      if (selectedTournament) await selectTournament(selectedTournament);
    } catch (err) { setError(err.message); }
  };

  const playerName = (id) => !id ? 'BYE' : allPlayers.find(p => p.id === id)?.name || '?';
  const sideLabel = (sideArr) => (!sideArr || sideArr.length === 0) ? 'TBD' : sideArr.map(playerName).join(' & ');
  const stageLabel = (s) => ({ group: 'Group', round_robin: 'RR', round_of_32: 'R32', round_of_16: 'R16', quarterfinal: 'QF', semifinal: 'SF', third_place: 'Bronze', final: 'Final' }[s] || s);
  const formatDate = (d) => { if (!d) return ''; const p = d.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; };

  const scoreDisplay = (match) => {
    if (!match.score_data?.sets) return null;
    return match.score_data.sets.map((set, i) => (
      <span key={i} style={{ margin: '0 3px', fontWeight: 600 }}>{set.side_a_points}-{set.side_b_points}</span>
    ));
  };

  // My matches — assigned to this referee
  const myPending = matches.filter(m => m.referee_id === referee.id && m.status === 'pending');
  const myLive = matches.filter(m => m.referee_id === referee.id && m.status === 'in_progress');
  const myDone = matches.filter(m => m.referee_id === referee.id && (m.status === 'finished' || m.status === 'locked'));

  // All matches for overview
  const liveMatches = matches.filter(m => m.status === 'in_progress');
  const recentResults = matches.filter(m => m.status === 'finished' || m.status === 'locked').slice(-10).reverse();
  const upcomingMatches = matches.filter(m => m.status === 'pending' && m.side_a?.length && m.side_b?.length).slice(0, 15);

  // Players by folder for setup
  const playersByFolder = {};
  allFolders.forEach(f => { playersByFolder[f.id] = []; });
  playersByFolder['__unfiled__'] = [];
  allPlayers.forEach(p => {
    const fid = p.folder_id || '__unfiled__';
    if (!playersByFolder[fid]) playersByFolder['__unfiled__'].push(p);
    else playersByFolder[fid].push(p);
  });
  const filteredPlayers = playerSearch ? allPlayers.filter(p => p.name.toLowerCase().includes(playerSearch.toLowerCase())) : null;

  if (scoringMatchId) {
    return (
      <MatchScorer
        matchId={scoringMatchId}
        allPlayers={allPlayers}
        onBack={() => { setScoringMatchId(null); if (selectedTournament) selectTournament(selectedTournament); }}
        isAdmin={false}
      />
    );
  }

  // ── First-time name setup ──
  if (needsSetup) {
    return (
      <div className="ref-view">
        <header className="ref-header">
          <span className="ref-logo">🏸 ShuttleScore</span>
          <button className="ref-logout" onClick={refereeLogout}>Logout</button>
        </header>
        <div className="ref-setup">
          <h2>Welcome, Referee!</h2>
          <p style={{ color: '#888', marginBottom: 20 }}>Please enter your name to get started.</p>
          <form onSubmit={handleSetupSubmit} className="ref-setup-form">
            {error && <div className="admin-error">{error}</div>}
            <div className="login-field">
              <label>Your Name</label>
              <input type="text" value={setupName} onChange={e => setSetupName(e.target.value)} placeholder="Your full name" required autoFocus />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#aaa', fontSize: 13 }}>
                <input type="checkbox" checked={showPlayerLink} onChange={e => setShowPlayerLink(e.target.checked)} />
                I'm also playing in the tournament
              </label>
            </div>
            {showPlayerLink && (
              <div className="ref-player-link">
                <p style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>Link to your player profile:</p>
                <input type="text" placeholder="Search players..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} className="pool-search-input" style={{ marginBottom: 8 }} />
                <div className="ref-player-list">
                  {filteredPlayers ? filteredPlayers.map(p => (
                    <div key={p.id} className={`ref-player-option ${setupPlayerId === p.id ? 'selected' : ''}`} onClick={() => setSetupPlayerId(setupPlayerId === p.id ? '' : p.id)}>
                      <span>{p.name}</span>{setupPlayerId === p.id && <span style={{ color: '#4ecb71' }}>✓</span>}
                    </div>
                  )) : allFolders.map(folder => {
                    const fPlayers = playersByFolder[folder.id] || [];
                    if (fPlayers.length === 0) return null;
                    return (
                      <div key={folder.id}>
                        <div style={{ fontSize: 11, color: '#666', padding: '6px 8px', fontWeight: 700 }}>📁 {folder.name}</div>
                        {fPlayers.map(p => (
                          <div key={p.id} className={`ref-player-option ${setupPlayerId === p.id ? 'selected' : ''}`} onClick={() => setSetupPlayerId(setupPlayerId === p.id ? '' : p.id)}>
                            <span>{p.name}</span>{setupPlayerId === p.id && <span style={{ color: '#4ecb71' }}>✓</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {(playersByFolder['__unfiled__'] || []).length > 0 && !filteredPlayers && (
                    <div>
                      <div style={{ fontSize: 11, color: '#666', padding: '6px 8px', fontWeight: 700 }}>📄 Unfiled</div>
                      {playersByFolder['__unfiled__'].map(p => (
                        <div key={p.id} className={`ref-player-option ${setupPlayerId === p.id ? 'selected' : ''}`} onClick={() => setSetupPlayerId(setupPlayerId === p.id ? '' : p.id)}>
                          <span>{p.name}</span>{setupPlayerId === p.id && <span style={{ color: '#4ecb71' }}>✓</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <button type="submit" className="login-button" style={{ marginTop: 16 }}>Continue</button>
          </form>
        </div>
      </div>
    );
  }

  // ── Main referee view ──
  return (
    <div className="ref-view">
      <header className="ref-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="ref-logo">🏸 ShuttleScore</span>
          <span className="ref-name">[R] {referee.display_name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {tournaments.length > 1 && (
            <select value={selectedTournament?.id || ''} onChange={e => { const t = tournaments.find(t => t.id === e.target.value); if (t) selectTournament(t); }}
              style={{ padding: '4px 8px', background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 6, color: '#f0f0f0', fontSize: 12 }}>
              {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button className="ref-logout" onClick={refereeLogout}>Logout</button>
        </div>
      </header>

      {error && <div className="admin-error" style={{ margin: '0 16px 16px' }}>{error}</div>}

      {/* Tabs */}
      <div className="ref-tabs">
        <button className={`ref-tab ${activeTab === 'my_matches' ? 'active' : ''}`} onClick={() => setActiveTab('my_matches')}>
          My Matches {myLive.length > 0 && <span className="ref-tab-badge">{myLive.length}</span>}
        </button>
        <button className={`ref-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          📊 Overview
        </button>
        <button className={`ref-tab ${activeTab === 'players' ? 'active' : ''}`} onClick={() => setActiveTab('players')}>
          👤 Players
        </button>
      </div>

      <div className="ref-content">
        {loading ? <div className="ref-loading">🏸 Loading...</div> : (
          <>
            {/* ── My Matches Tab ── */}
            {activeTab === 'my_matches' && (
              <div>
                {/* Live */}
                {myLive.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">🔴 Live</h3>
                    {myLive.map(m => (
                      <div key={m.id} className="ref-match-card live">
                        <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span><span className="ref-match-live">LIVE</span></div>
                        <div className="ref-match-sides">
                          <span>{sideLabel(m.side_a)}</span>
                          <span className="ref-match-score">{scoreDisplay(m) || 'vs'}</span>
                          <span>{sideLabel(m.side_b)}</span>
                        </div>
                        <button className="admin-btn primary" onClick={() => setScoringMatchId(m.id)} style={{ marginTop: 8, width: '100%' }}>🏸 Score Match</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upcoming */}
                {myPending.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">📋 Upcoming</h3>
                    {myPending.map(m => (
                      <div key={m.id} className="ref-match-card">
                        <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span></div>
                        <div className="ref-match-sides">
                          <span>{sideLabel(m.side_a)}</span>
                          <span className="ref-match-vs">vs</span>
                          <span>{sideLabel(m.side_b)}</span>
                        </div>
                        {!m.referee_confirmed ? (
                          <button className="admin-btn primary" onClick={() => handleConfirmStart(m.id)} style={{ marginTop: 8, width: '100%' }}>✓ Ready to Start</button>
                        ) : (
                          <p style={{ color: '#4ecb71', fontSize: 12, marginTop: 8, textAlign: 'center' }}>✓ Confirmed — waiting for admin to start</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Completed */}
                {myDone.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">✅ Completed</h3>
                    {myDone.map(m => {
                      const won = m.winner;
                      return (
                        <div key={m.id} className="ref-match-card done">
                          <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span><span style={{ fontSize: 10, color: '#4ecb71' }}>✓</span></div>
                          <div className="ref-match-sides">
                            <span className={won === 'side_a' ? 'ref-winner' : ''}>{sideLabel(m.side_a)}</span>
                            <span className="ref-match-score">{scoreDisplay(m)}</span>
                            <span className={won === 'side_b' ? 'ref-winner' : ''}>{sideLabel(m.side_b)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {myLive.length === 0 && myPending.length === 0 && myDone.length === 0 && (
                  <div className="ref-empty"><p>🏸 No matches assigned to you yet.</p><p style={{ color: '#555', fontSize: 13 }}>The admin will assign matches when it's time.</p></div>
                )}
              </div>
            )}

            {/* ── Overview Tab ── */}
            {activeTab === 'overview' && (
              <div>
                {liveMatches.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">🔴 Live Matches</h3>
                    {liveMatches.map(m => (
                      <div key={m.id} className="ref-match-card live">
                        <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span><span className="ref-match-live">LIVE</span></div>
                        <div className="ref-match-sides">
                          <span>{sideLabel(m.side_a)}</span>
                          <span className="ref-match-score">{scoreDisplay(m) || 'vs'}</span>
                          <span>{sideLabel(m.side_b)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {recentResults.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">Recent Results</h3>
                    {recentResults.map(m => (
                      <div key={m.id} className="ref-match-card done">
                        <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span></div>
                        <div className="ref-match-sides">
                          <span className={m.winner === 'side_a' ? 'ref-winner' : ''}>{sideLabel(m.side_a)}</span>
                          <span className="ref-match-score">{scoreDisplay(m)}</span>
                          <span className={m.winner === 'side_b' ? 'ref-winner' : ''}>{sideLabel(m.side_b)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {upcomingMatches.length > 0 && (
                  <div className="ref-section">
                    <h3 className="ref-section-title">Upcoming</h3>
                    {upcomingMatches.map(m => (
                      <div key={m.id} className="ref-match-card">
                        <div className="ref-match-header"><span>{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ' · ' + m.court_id : ''}{m.scheduled_date ? ' · ' + formatDate(m.scheduled_date) : ''}</span></div>
                        <div className="ref-match-sides">
                          <span>{sideLabel(m.side_a)}</span><span className="ref-match-vs">vs</span><span>{sideLabel(m.side_b)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {liveMatches.length === 0 && recentResults.length === 0 && upcomingMatches.length === 0 && (
                  <div className="ref-empty"><p>No matches yet.</p></div>
                )}
              </div>
            )}

            {/* ── Players Tab ── */}
            {activeTab === 'players' && (
              <div>
                <div className="ref-section">
                  <h3 className="ref-section-title">Players ({allPlayers.length})</h3>
                  <input type="text" placeholder="Search players..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)}
                    className="pool-search-input" style={{ marginBottom: 12, width: '100%' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {allPlayers
                      .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()))
                      .map(p => (
                        <div key={p.id} style={{ padding: '8px 12px', background: '#14141f', borderRadius: 6, fontSize: 14, color: '#ddd' }}>
                          {p.name}
                          <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>{p.gender === 'female' ? 'F' : 'M'}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}