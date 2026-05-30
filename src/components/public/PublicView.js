import { useState, useEffect, useRef } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { MatchService } from '../../services/MatchService';
import { DrawService } from '../../services/DrawService';
import { RealtimeService } from '../../services/RealtimeService';
import { supabase } from '../../lib/supabase';
import { getPlayerAge } from '../admin/PlayerManager';
import './PublicView.css';

export default function PublicView({ onLogin }) {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [groups, setGroups] = useState([]);
  const [allReferees, setAllReferees] = useState([]);
  const [fullHistoryPlayerId, setFullHistoryPlayerId] = useState(null);
  const [fullHistoryData, setFullHistoryData] = useState(null);
  const [fullHistoryLoading, setFullHistoryLoading] = useState(false);
  const [selectedRefId, setSelectedRefId] = useState(null);
  const [refProfileData, setRefProfileData] = useState(null);
  const [refProfileLoading, setRefProfileLoading] = useState(false);

  // Realtime ref
  const selectedTournamentObjRef = useRef(null);

  useEffect(() => {
    loadData();

    // Subscribe to match changes for live updates
    const unsub = RealtimeService.subscribeToMatches(() => {
      if (selectedTournamentObjRef.current) {
        reloadMatchesOnly(selectedTournamentObjRef.current);
      }
    });
    return () => unsub();
  }, []);

  // Load full cross-tournament history for a player
  useEffect(() => {
    if (!fullHistoryPlayerId) { setFullHistoryData(null); return; }
    const load = async () => {
      setFullHistoryLoading(true);
      try {
        // Get all tournaments this player participated in
        const { data: tps } = await supabase.from('tournament_players').select('tournament_id').eq('player_id', fullHistoryPlayerId);
        const tournIds = (tps || []).map(r => r.tournament_id);

        // Get tournament names
        const { data: tourns } = await supabase.from('tournaments').select('id, name, start_date, status').in('id', tournIds).order('start_date', { ascending: false });

        // Get all matches across all tournaments where this player participated
        const result = [];
        for (const t of (tourns || [])) {
          const evts = await TournamentService.getEvents(t.id);
          const evtMap = {};
          evts.forEach(e => { evtMap[e.id] = e.name; });

          const matchesForTourn = [];
          for (const evt of evts) {
            const { data: grps } = await supabase.from('groups').select('id').eq('event_id', evt.id);
            const grpIds = (grps || []).map(g => g.id);
            if (grpIds.length === 0) continue;
            const { data: ms } = await supabase.from('matches').select('*').in('group_id', grpIds);
            (ms || []).forEach(m => {
              if ((m.side_a || []).includes(fullHistoryPlayerId) || (m.side_b || []).includes(fullHistoryPlayerId)) {
                matchesForTourn.push({ ...m, _eventName: evtMap[evt.id] || evt.name });
              }
            });
          }
          result.push({ tournament: t, matches: matchesForTourn });
        }

        // Get player info
        const { data: playerData } = await supabase.from('players').select('*').eq('id', fullHistoryPlayerId).single();

        // Get all player names needed
        const allPids = new Set();
        result.forEach(r => r.matches.forEach(m => { (m.side_a || []).forEach(id => allPids.add(id)); (m.side_b || []).forEach(id => allPids.add(id)); }));
        const { data: pNames } = await supabase.from('players').select('id, name').in('id', [...allPids]);
        const nameMap = {};
        (pNames || []).forEach(p => { nameMap[p.id] = p.name; });

        // Check if this player is also a referee
        const { data: refRecord } = await supabase.from('referees').select('*').eq('player_id', fullHistoryPlayerId).maybeSingle();
        let refMatches = [];
        if (refRecord) {
          const { data: rms } = await supabase.from('matches').select('*')
            .eq('referee_id', refRecord.id)
            .in('status', ['finished', 'locked', 'in_progress'])
            .order('started_at', { ascending: false });
          // Get event names for referee matches
          const rEventIds = [...new Set((rms || []).map(m => m.event_id))];
          if (rEventIds.length > 0) {
            const { data: rEvts } = await supabase.from('events').select('id, name').in('id', rEventIds);
            (rEvts || []).forEach(e => { if (!nameMap[e.id]) nameMap[e.id] = e.name; });
            refMatches = (rms || []).map(m => {
              // Get player names for ref matches
              (m.side_a || []).forEach(id => { if (!nameMap[id]) nameMap[id] = id; });
              (m.side_b || []).forEach(id => { if (!nameMap[id]) nameMap[id] = id; });
              const evtName = (rEvts || []).find(e => e.id === m.event_id)?.name || '';
              return { ...m, _eventName: evtName };
            });
          }
        }

        setFullHistoryData({ player: playerData, tournaments: result, nameMap, refMatches, refRecord });
      } catch (err) { console.error(err); }
      finally { setFullHistoryLoading(false); }
    };
    load();
  }, [fullHistoryPlayerId]);

  // Load referee profile when selected
  useEffect(() => {
    if (!selectedRefId) { setRefProfileData(null); return; }
    const load = async () => {
      setRefProfileLoading(true);
      try {
        const ref = allReferees.find(r => r.id === selectedRefId);
        const { data: ms } = await supabase.from('matches').select('*')
          .eq('referee_id', selectedRefId)
          .in('status', ['finished', 'locked', 'in_progress'])
          .order('started_at', { ascending: false });

        // Get event names
        const eventIds = [...new Set((ms || []).map(m => m.event_id))];
        const { data: evts } = eventIds.length > 0
          ? await supabase.from('events').select('id, name').in('id', eventIds)
          : { data: [] };
        const evtMap = {};
        (evts || []).forEach(e => { evtMap[e.id] = e.name; });

        // Get player names
        const allPids = new Set();
        (ms || []).forEach(m => {
          (m.side_a || []).forEach(id => allPids.add(id));
          (m.side_b || []).forEach(id => allPids.add(id));
        });
        const { data: pNames } = allPids.size > 0
          ? await supabase.from('players').select('id, name').in('id', [...allPids])
          : { data: [] };
        const nameMap = {};
        (pNames || []).forEach(p => { nameMap[p.id] = p.name; });

        setRefProfileData({
          referee: ref,
          matches: (ms || []).map(m => ({ ...m, _eventName: evtMap[m.event_id] || '' })),
          nameMap,
        });
      } catch (err) { console.error(err); }
      finally { setRefProfileLoading(false); }
    };
    load();
  }, [selectedRefId, allReferees]);

  const loadData = async () => {
    try {
      const tourns = await TournamentService.getAll();
      setTournaments(tourns);

      // Auto-select first active tournament
      const active = tourns.find(t => t.status === 'in_progress') || tourns[0];
      if (active) selectTournament(active);
      else setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    selectedTournamentObjRef.current = tournament;
    setLoading(true);
    try {
      // Load tournament pool players
      const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', tournament.id);
      const playerIds = (tp || []).map(r => r.player_id);
      let players = [];
      if (playerIds.length > 0) {
        const { data } = await supabase.from('players').select('*').in('id', playerIds).order('name');
        players = data || [];
      }
      setAllPlayers(players);

      const evts = await TournamentService.getEvents(tournament.id);
      setEvents(evts);
      if (evts.length > 0) setSelectedEventId(evts[0].id);

      // Load all matches
      const allMatches = [];
      const allGroups = [];
      for (const evt of evts) {
        const eventMatches = await MatchService.getByEvent(evt.id);
        allMatches.push(...eventMatches.map(m => ({ ...m, _eventName: evt.name, _eventType: evt.type, _eventFormat: evt.format })));

        const draw = await DrawService.getDrawForEvent(evt.id);
        if (draw.groups) allGroups.push(...draw.groups.map(g => ({ ...g, _eventName: evt.name, _eventId: evt.id })));
      }
      setMatches(allMatches);
      setGroups(allGroups);

      // Load referees
      const { data: refs } = await supabase.from('referees').select('id, display_name, username, player_id');
      setAllReferees(refs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Lightweight reload for realtime — only refetch matches, not players/events/groups
  const reloadMatchesOnly = async (tournament) => {
    try {
      const evts = events.length > 0 ? events : await TournamentService.getEvents(tournament.id);
      const allMatches = [];
      for (const evt of evts) {
        const eventMatches = await MatchService.getByEvent(evt.id);
        allMatches.push(...eventMatches.map(m => ({ ...m, _eventName: evt.name, _eventType: evt.type, _eventFormat: evt.format })));
      }
      setMatches(allMatches);
    } catch (err) { console.error('Realtime reload error:', err); }
  };

  // Helpers
  const playerName = (id) => {
    if (!id) return 'BYE';
    return allPlayers.find(p => p.id === id)?.name || '...';
  };

  const sideLabel = (sideArr) => {
    if (!sideArr || sideArr.length === 0) return 'TBD';
    return sideArr.map(playerName).join(' & ');
  };

  const refereeName = (refId) => {
    if (!refId) return null;
    const ref = allReferees.find(r => r.id === refId);
    return ref?.display_name || ref?.username || null;
  };

  const stageLabel = (s) => ({
    group: 'Group', round_of_32: 'Round of 32', round_of_16: 'Round of 16',
    quarterfinal: 'Quarterfinal', semifinal: 'Semifinal', final: 'Final'
  }[s] || s);

  const liveMatches = matches.filter(m => m.status === 'in_progress');
  const recentResults = matches
    .filter(m => m.status === 'finished' || m.status === 'locked')
    .filter(m => m.side_a && m.side_b)
    .sort((a, b) => new Date(b.finished_at || b.updated_at) - new Date(a.finished_at || a.updated_at))
    .slice(0, 8);
  const upcomingMatches = matches
    .filter(m => m.status === 'pending' && m.side_a?.length > 0 && m.side_b?.length > 0)
    .slice(0, 8);

  // Event-filtered matches for bracket view
  const eventMatches = selectedEventId ? matches.filter(m => m.event_id === selectedEventId) : [];
  const eventGroups = selectedEventId ? groups.filter(g => g._eventId === selectedEventId) : [];
  const selectedEvent = events.find(e => e.id === selectedEventId);

  // Player profile data
  const selectedPlayer = selectedPlayerId ? allPlayers.find(p => p.id === selectedPlayerId) : null;
  const playerMatches = selectedPlayerId
    ? matches.filter(m =>
        (m.side_a || []).includes(selectedPlayerId) || (m.side_b || []).includes(selectedPlayerId)
      )
    : [];

  // Player search
  const filteredPlayers = allPlayers.filter(p =>
    !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  const scoreDisplay = (m) => {
    if (!m.score_data?.sets) return null;
    return m.score_data.sets.map((set, i) => (
      <span key={i} className="pub-set-score">{set.side_a_points}-{set.side_b_points}</span>
    ));
  };

  // Group standings calculation
  const calcGroupStandings = (groupId) => {
    const gMatches = eventMatches.filter(m => m.group_id === groupId && (m.status === 'finished' || m.status === 'locked'));
    const stats = {};

    // Collect all players in group from all matches (including pending)
    const allGroupMatches = eventMatches.filter(m => m.group_id === groupId);
    allGroupMatches.forEach(m => {
      (m.side_a || []).forEach(id => {
        if (!stats[id]) stats[id] = { id, played: 0, won: 0, lost: 0, pf: 0, pa: 0 };
      });
      (m.side_b || []).forEach(id => {
        if (!stats[id]) stats[id] = { id, played: 0, won: 0, lost: 0, pf: 0, pa: 0 };
      });
    });

    gMatches.forEach(m => {
      if (!m.score_data?.sets) return;
      const totalA = m.score_data.sets.reduce((sum, s) => sum + s.side_a_points, 0);
      const totalB = m.score_data.sets.reduce((sum, s) => sum + s.side_b_points, 0);

      (m.side_a || []).forEach(id => {
        if (stats[id]) {
          stats[id].played++;
          stats[id].pf += totalA;
          stats[id].pa += totalB;
          if (m.winner === 'side_a') stats[id].won++;
          else stats[id].lost++;
        }
      });
      (m.side_b || []).forEach(id => {
        if (stats[id]) {
          stats[id].played++;
          stats[id].pf += totalB;
          stats[id].pa += totalA;
          if (m.winner === 'side_b') stats[id].won++;
          else stats[id].lost++;
        }
      });
    });

    return Object.values(stats).sort((a, b) => b.won - a.won || (b.pf - b.pa) - (a.pf - a.pa));
  };

  if (loading) {
    return (
      <div className="pub-loading">
        <span className="pub-loading-icon">🏸</span>
        <p>Loading ShuttleScore...</p>
      </div>
    );
  }

  // ── Full History View ──
  if (fullHistoryPlayerId) {
    const fh = fullHistoryData;
    const histPlayer = fh?.player;
    const histNameMap = fh?.nameMap || {};
    const histSideLabel = (side) => (side || []).map(id => histNameMap[id] || '?').join(' & ');

    const allHistMatches = fh ? fh.tournaments.flatMap(t => t.matches) : [];
    const finishedMatches = allHistMatches.filter(m => m.status === 'finished' || m.status === 'locked');
    const totalWins = finishedMatches.filter(m =>
      (m.winner === 'side_a' && (m.side_a || []).includes(fullHistoryPlayerId)) ||
      (m.winner === 'side_b' && (m.side_b || []).includes(fullHistoryPlayerId))
    ).length;
    const totalLosses = finishedMatches.length - totalWins;

    return (
      <div className="pub">
        <header className="pub-header">
          <div className="pub-header-left">
            <button className="pub-back-btn" onClick={() => setFullHistoryPlayerId(null)}>← Back</button>
            <span className="pub-logo">🏸 ShuttleScore</span>
          </div>
        </header>
        <div className="pub-content" style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}>
          {fullHistoryLoading ? (
            <div className="pub-loading"><span className="pub-loading-icon">🏸</span><p>Loading history...</p></div>
          ) : !fh ? (
            <p style={{ color: '#555' }}>Could not load history.</p>
          ) : (
            <>
              <div className="pub-history-header">
                <h2 className="pub-history-name">{histPlayer?.name}</h2>
                <div className="pub-profile-meta">
                  <span className="pub-profile-badge">{histPlayer?.gender === 'female' ? 'F' : 'M'}</span>
                  {getPlayerAge(histPlayer) != null && <span className="pub-profile-badge">{getPlayerAge(histPlayer)} years</span>}
                </div>
              </div>

              <div className="pub-history-summary">
                <div className="pub-profile-stat"><span className="pub-profile-stat-num">{fh.tournaments.length}</span><span className="pub-profile-stat-label">Tournaments</span></div>
                <div className="pub-profile-stat"><span className="pub-profile-stat-num">{finishedMatches.length}</span><span className="pub-profile-stat-label">Played</span></div>
                <div className="pub-profile-stat"><span className="pub-profile-stat-num" style={{ color: '#4ecb71' }}>{totalWins}</span><span className="pub-profile-stat-label">Won</span></div>
                <div className="pub-profile-stat"><span className="pub-profile-stat-num" style={{ color: '#ff6655' }}>{totalLosses}</span><span className="pub-profile-stat-label">Lost</span></div>
              </div>

              {fh.tournaments.map(({ tournament, matches: tMatches }) => (
                <div key={tournament.id} className="pub-history-tournament">
                  <div className="pub-history-tournament-header">
                    <h3>{tournament.name}</h3>
                    <span className="pub-history-tournament-date">{tournament.start_date || ''}</span>
                  </div>
                  {tMatches.length === 0 ? (
                    <p style={{ color: '#555', fontSize: 13, padding: '8px 12px' }}>No matches in this tournament.</p>
                  ) : (
                    <div className="pub-history-matches">
                      {tMatches.filter(m => m.side_a && m.side_b).map(m => {
                        const isA = (m.side_a || []).includes(fullHistoryPlayerId);
                        const won = (isA && m.winner === 'side_a') || (!isA && m.winner === 'side_b');
                        const finished = m.status === 'finished' || m.status === 'locked';
                        return (
                          <div key={m.id} className={`pub-match-mini ${m.status === 'in_progress' ? 'live' : ''}`}>
                            <div className="pub-match-mini-header">
                              <span className="pub-match-mini-event">{m._eventName}</span>
                              <span className="pub-match-mini-stage">{stageLabel(m.stage)}</span>
                            </div>
                            <div className="pub-match-mini-sides">
                              <span className={isA && won ? 'won' : ''}>{histSideLabel(m.side_a)}</span>
                              <span className="pub-match-mini-score">
                                {m.score_data?.sets ? scoreDisplay(m) : 'vs'}
                              </span>
                              <span className={!isA && won ? 'won' : ''}>{histSideLabel(m.side_b)}</span>
                            </div>
                            {m.status === 'in_progress' && <span className="pub-live-badge">LIVE</span>}
                            {finished && <span className={`pub-result-badge ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'}</span>}
                            {refereeName(m.referee_id) && <div className="pub-match-mini-ref" onClick={(e) => { e.stopPropagation(); setSelectedRefId(m.referee_id); }} style={{ cursor: "pointer" }}>🏅 <span className="pub-ref-clickable">{refereeName(m.referee_id)}</span></div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {/* Referee Record */}
              {fh.refMatches && fh.refMatches.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 12 }}>🏅 Referee Record</h3>
                  <div className="pub-history-summary" style={{ marginBottom: 16 }}>
                    <div className="pub-profile-stat">
                      <span className="pub-profile-stat-num">{fh.refMatches.length}</span>
                      <span className="pub-profile-stat-label">Matches Refereed</span>
                    </div>
                  </div>
                  <div className="pub-history-matches">
                    {fh.refMatches.map(m => {
                      const rSide = (side) => (side || []).map(id => fh.nameMap[id] || '?').join(' & ');
                      return (
                        <div key={m.id} className="pub-match-mini">
                          <div className="pub-match-mini-header">
                            <span className="pub-match-mini-event">{m._eventName}</span>
                            <span className="pub-match-mini-stage">{m.status === 'in_progress' ? 'LIVE' : '✓'}</span>
                          </div>
                          <div className="pub-match-mini-sides">
                            <span className={m.winner === 'side_a' ? 'won' : ''}>{rSide(m.side_a)}</span>
                            <span className="pub-match-mini-score">{m.score_data?.sets ? scoreDisplay(m) : 'vs'}</span>
                            <span className={m.winner === 'side_b' ? 'won' : ''}>{rSide(m.side_b)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pub">
      {/* Header */}
      <header className="pub-header">
        <div className="pub-header-left">
          <span className="pub-logo">🏸 ShuttleScore</span>
        </div>
        {tournaments.length > 1 ? (
          <select
            className="pub-tournament-select"
            value={selectedTournament?.id || ''}
            onChange={(e) => {
              const t = tournaments.find(t => t.id === e.target.value);
              if (t) selectTournament(t);
            }}
          >
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : selectedTournament ? (
          <div className="pub-header-tournament">{selectedTournament.name}</div>
        ) : null}
        <button className="pub-login-btn" onClick={onLogin}>Login</button>
      </header>

      {/* Player profile overlay */}
      {selectedPlayer && (
        <div className="pub-overlay" onClick={() => setSelectedPlayerId(null)}>
          <div className="pub-profile-card" onClick={e => e.stopPropagation()}>
            <button className="pub-profile-close" onClick={() => setSelectedPlayerId(null)}>✕</button>
            <div className="pub-profile-name">{selectedPlayer.name}</div>
            <div className="pub-profile-meta">
              <span className="pub-profile-badge">{selectedPlayer.gender === 'female' ? 'F' : 'M'}</span>
              {getPlayerAge(selectedPlayer) != null && <span className="pub-profile-badge">{getPlayerAge(selectedPlayer)} years</span>}
            </div>

            <div className="pub-profile-stats">
              <div className="pub-profile-stat">
                <span className="pub-profile-stat-num">
                  {playerMatches.filter(m => m.status === 'finished' || m.status === 'locked').length}
                </span>
                <span className="pub-profile-stat-label">Played</span>
              </div>
              <div className="pub-profile-stat">
                <span className="pub-profile-stat-num" style={{ color: '#4ecb71' }}>
                  {playerMatches.filter(m =>
                    (m.winner === 'side_a' && (m.side_a || []).includes(selectedPlayerId)) ||
                    (m.winner === 'side_b' && (m.side_b || []).includes(selectedPlayerId))
                  ).length}
                </span>
                <span className="pub-profile-stat-label">Won</span>
              </div>
              <div className="pub-profile-stat">
                <span className="pub-profile-stat-num" style={{ color: '#ff6655' }}>
                  {playerMatches.filter(m =>
                    (m.winner === 'side_a' && (m.side_b || []).includes(selectedPlayerId)) ||
                    (m.winner === 'side_b' && (m.side_a || []).includes(selectedPlayerId))
                  ).length}
                </span>
                <span className="pub-profile-stat-label">Lost</span>
              </div>
            </div>

            <div className="pub-profile-matches-title">Matches in {selectedTournament.name}</div>
            {playerMatches.length === 0 ? (
              <p style={{ color: '#555', fontSize: 13 }}>No matches yet.</p>
            ) : (
              <div className="pub-profile-matches">
                {playerMatches.filter(m => m.side_a && m.side_b).map(m => {
                  const isA = (m.side_a || []).includes(selectedPlayerId);
                  const won = (isA && m.winner === 'side_a') || (!isA && m.winner === 'side_b');
                  return (
                    <div key={m.id} className={`pub-match-mini ${m.status === 'in_progress' ? 'live' : ''}`}>
                      <div className="pub-match-mini-header">
                        <span className="pub-match-mini-event">{m._eventName}</span>
                        <span className="pub-match-mini-stage">{stageLabel(m.stage)}</span>
                      </div>
                      <div className="pub-match-mini-sides">
                        <span className={isA && won ? 'won' : ''}>{sideLabel(m.side_a)}</span>
                        <span className="pub-match-mini-score">
                          {m.score_data?.sets ? scoreDisplay(m) : 'vs'}
                        </span>
                        <span className={!isA && won ? 'won' : ''}>{sideLabel(m.side_b)}</span>
                      </div>
                      {m.status === 'in_progress' && <span className="pub-live-badge">LIVE</span>}
                      {(m.status === 'finished' || m.status === 'locked') && (
                        <span className={`pub-result-badge ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'}</span>
                      )}
                      {refereeName(m.referee_id) && <div className="pub-match-mini-ref" onClick={(e) => { e.stopPropagation(); setSelectedRefId(m.referee_id); }} style={{ cursor: "pointer" }}>🏅 <span className="pub-ref-clickable">{refereeName(m.referee_id)}</span></div>}
                    </div>
                  );
                })}
              </div>
            )}

            <button className="pub-full-history-btn" onClick={() => { setFullHistoryPlayerId(selectedPlayerId); setSelectedPlayerId(null); }}>
              📊 View Full History Across All Tournaments
            </button>
          </div>
        </div>
      )}

      {/* Referee Profile Overlay */}
      {selectedRefId && (
        <div className="pub-overlay" onClick={() => setSelectedRefId(null)}>
          <div className="pub-profile-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <button className="pub-profile-close" onClick={() => setSelectedRefId(null)}>✕</button>
            {refProfileLoading ? (
              <div className="admin-loading" style={{ padding: 40 }}>Loading...</div>
            ) : refProfileData ? (
              <>
                <div className="pub-profile-header">
                  <h3 className="pub-profile-name">🏅 {refProfileData.referee?.display_name || refProfileData.referee?.username}</h3>
                  <div className="pub-profile-meta">
                    <span className="pub-profile-badge">Referee</span>
                    {refProfileData.referee?.player_id && (
                      <span className="pub-profile-badge" style={{ cursor: 'pointer', borderColor: '#d4a843', color: '#d4a843' }}
                        onClick={() => { setSelectedRefId(null); setSelectedPlayerId(refProfileData.referee.player_id); }}>
                        View Player Profile →
                      </span>
                    )}
                  </div>
                </div>
                <div className="pub-profile-stats">
                  <div className="pub-profile-stat">
                    <span className="pub-profile-stat-num">{refProfileData.matches.length}</span>
                    <span className="pub-profile-stat-label">Matches Refereed</span>
                  </div>
                </div>
                <div className="pub-profile-matches-title">Match History</div>
                {refProfileData.matches.length === 0 ? (
                  <p style={{ color: '#555', fontSize: 13 }}>No matches refereed yet.</p>
                ) : (
                  <div className="pub-profile-matches">
                    {refProfileData.matches.map(m => {
                      const rNameMap = refProfileData.nameMap;
                      const rSideLabel = (side) => (side || []).map(id => rNameMap[id] || '?').join(' & ');
                      return (
                        <div key={m.id} className="pub-match-mini">
                          <div className="pub-match-mini-header">
                            <span className="pub-match-mini-event">{m._eventName}</span>
                            <span className="pub-match-mini-stage">
                              {m.status === 'in_progress' ? 'LIVE' : '✓'}
                            </span>
                          </div>
                          <div className="pub-match-mini-sides">
                            <span className={m.winner === 'side_a' ? 'won' : ''}>{rSideLabel(m.side_a)}</span>
                            <span className="pub-match-mini-score">
                              {m.score_data?.sets ? scoreDisplay(m) : 'vs'}
                            </span>
                            <span className={m.winner === 'side_b' ? 'won' : ''}>{rSideLabel(m.side_b)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: '#555', padding: 20 }}>Could not load referee profile.</p>
            )}
          </div>
        </div>
      )}

      <div className="pub-content">
        {/* Tabs */}
        <div className="pub-tabs">
          {['overview', 'brackets', 'players'].map(tab => (
            <button key={tab} className={`pub-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}>
              {tab === 'overview' ? '📊 Overview' : tab === 'brackets' ? '🏆 Brackets' : '👤 Players'}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <div className="pub-overview">
            {/* Tournament info */}
            {selectedTournament && (
              <div className="pub-tournament-card">
                <h2 className="pub-tournament-name">{selectedTournament.name}</h2>
                <div className="pub-tournament-meta">
                  {selectedTournament.venue && <span>📍 {selectedTournament.venue}</span>}
                  {selectedTournament.start_date && <span>📅 {selectedTournament.start_date}{selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date ? ` — ${selectedTournament.end_date}` : ''}</span>}
                  <span>🏸 {events.length} events</span>
                </div>
                <div className="pub-tournament-events">
                  {events.map(e => (
                    <span key={e.id} className="pub-event-chip">{e.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Live matches */}
            {liveMatches.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title"><span className="pub-live-dot" /> Live Now</h3>
                {liveMatches.map(m => (
                  <div key={m.id} className="pub-match-card live">
                    <div className="pub-match-event">{m._eventName} — {stageLabel(m.stage)}</div>
                    <div className="pub-match-body">
                      <div className="pub-match-side">
                        <span className="pub-match-name clickable" onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>
                          {sideLabel(m.side_a)}
                        </span>
                      </div>
                      <div className="pub-match-scores">{scoreDisplay(m)}</div>
                      <div className="pub-match-side right">
                        <span className="pub-match-name clickable" onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>
                          {sideLabel(m.side_b)}
                        </span>
                      </div>
                    </div>
                    {refereeName(m.referee_id) && <div className="pub-match-referee" onClick={() => setSelectedRefId(m.referee_id)} style={{ cursor: "pointer" }}>Referee: <span className="pub-ref-clickable">{refereeName(m.referee_id)}</span></div>}
                    {m.court_id && <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 2 }}>🏟️ {m.court_id}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Recent results */}
            {recentResults.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title">Recent Results</h3>
                {recentResults.map(m => (
                  <div key={m.id} className="pub-match-card">
                    <div className="pub-match-event">{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ` · ${m.court_id}` : ''}</div>
                    <div className="pub-match-body">
                      <div className={`pub-match-side ${m.winner === 'side_a' ? 'winner' : ''}`}>
                        <span className="pub-match-name clickable" onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>
                          {sideLabel(m.side_a)}
                        </span>
                      </div>
                      <div className="pub-match-scores">{scoreDisplay(m)}</div>
                      <div className={`pub-match-side right ${m.winner === 'side_b' ? 'winner' : ''}`}>
                        <span className="pub-match-name clickable" onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>
                          {sideLabel(m.side_b)}
                        </span>
                      </div>
                    </div>
                    {refereeName(m.referee_id) && <div className="pub-match-referee" onClick={() => setSelectedRefId(m.referee_id)} style={{ cursor: "pointer" }}>Referee: <span className="pub-ref-clickable">{refereeName(m.referee_id)}</span></div>}
                  </div>
                ))}
              </div>
            )}

            {/* Upcoming */}
            {upcomingMatches.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title">Upcoming</h3>
                {upcomingMatches.map(m => (
                  <div key={m.id} className="pub-match-card upcoming">
                    <div className="pub-match-event">{m._eventName} — {stageLabel(m.stage)}{m.court_id ? ` · ${m.court_id}` : ''}</div>
                    <div className="pub-match-body">
                      <div className="pub-match-side">
                        <span className="pub-match-name clickable" onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>
                          {sideLabel(m.side_a)}
                        </span>
                      </div>
                      <span className="pub-match-vs-text">vs</span>
                      <div className="pub-match-side right">
                        <span className="pub-match-name clickable" onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>
                          {sideLabel(m.side_b)}
                        </span>
                      </div>
                    </div>
                    {refereeName(m.referee_id) && <div className="pub-match-referee" onClick={() => setSelectedRefId(m.referee_id)} style={{ cursor: "pointer" }}>Referee: <span className="pub-ref-clickable">{refereeName(m.referee_id)}</span></div>}
                  </div>
                ))}
              </div>
            )}

            {liveMatches.length === 0 && recentResults.length === 0 && upcomingMatches.length === 0 && (
              <div className="pub-empty">No matches yet. Check back once the tournament begins!</div>
            )}
          </div>
        )}

        {/* ── Brackets Tab ── */}
        {activeTab === 'brackets' && (
          <div className="pub-brackets">
            {/* Event selector */}
            <div className="pub-event-tabs">
              {events.map(e => (
                <button key={e.id} className={`pub-event-tab ${selectedEventId === e.id ? 'active' : ''}`}
                  onClick={() => setSelectedEventId(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>

            {/* Groups */}
            {eventGroups.length > 0 && (
              <div className="pub-groups">
                {eventGroups.map(group => {
                  const standings = calcGroupStandings(group.id);
                  const gMatches = eventMatches.filter(m => m.group_id === group.id);

                  return (
                    <div key={group.id} className="pub-group-card">
                      <h4 className="pub-group-name">{group.name}</h4>

                      {/* Standings table */}
                      <table className="pub-standings-table">
                        <thead>
                          <tr>
                            <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>PF</th><th>PA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.id}>
                              <td>{i + 1}</td>
                              <td className="clickable" onClick={() => setSelectedPlayerId(s.id)}>{playerName(s.id)}</td>
                              <td>{s.played}</td><td>{s.won}</td><td>{s.lost}</td><td>{s.pf}</td><td>{s.pa}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Group matches */}
                      <div className="pub-group-matches">
                        {gMatches.map(m => (
                          <div key={m.id} className={`pub-match-mini ${m.status === 'in_progress' ? 'live' : ''}`}>
                            <div className="pub-match-mini-sides">
                              <span className={m.winner === 'side_a' ? 'won' : ''}
                                onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>
                                {sideLabel(m.side_a)}
                              </span>
                              <span className="pub-match-mini-score">
                                {m.score_data?.sets ? scoreDisplay(m) : 'vs'}
                              </span>
                              <span className={m.winner === 'side_b' ? 'won' : ''}
                                onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>
                                {sideLabel(m.side_b)}
                              </span>
                            </div>
                            {m.status === 'in_progress' && <span className="pub-live-badge">LIVE</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bracket */}
            {(() => {
              const knockout = eventMatches.filter(m => m.stage !== 'group');
              if (!knockout.length) return null;
              const stageOrder = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];
              const byStage = {};
              knockout.forEach(m => { if (!byStage[m.stage]) byStage[m.stage] = []; byStage[m.stage].push(m); });

              return (
                <div className="pub-bracket">
                  <div className="pub-bracket-rounds">
                    {stageOrder.filter(s => byStage[s]).map(stage => (
                      <div key={stage} className="pub-bracket-round">
                        <div className="pub-bracket-round-title">{stageLabel(stage)}</div>
                        {byStage[stage].sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0)).map(m => (
                          <div key={m.id} className={`pub-bracket-match ${m.status === 'in_progress' ? 'live' : ''}`}>
                            <div className={`pub-bracket-side ${m.winner === 'side_a' ? 'winner' : ''}`}
                              onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>
                              {sideLabel(m.side_a)}
                              {m.score_data?.sets && <span className="pub-bracket-pts">{m.score_data.sets.map(s => s.side_a_points).join(' ')}</span>}
                            </div>
                            <div className={`pub-bracket-side ${m.winner === 'side_b' ? 'winner' : ''}`}
                              onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>
                              {sideLabel(m.side_b)}
                              {m.score_data?.sets && <span className="pub-bracket-pts">{m.score_data.sets.map(s => s.side_b_points).join(' ')}</span>}
                            </div>
                            {m.status === 'in_progress' && <div className="pub-bracket-live">LIVE</div>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {eventMatches.length === 0 && (
              <div className="pub-empty">No draw generated for this event yet.</div>
            )}
          </div>
        )}

        {/* ── Players Tab ── */}
        {activeTab === 'players' && (
          <div className="pub-players">
            <div className="pub-player-search">
              <input type="text" placeholder="Search players..." value={playerSearch}
                onChange={e => setPlayerSearch(e.target.value)} />
              <span className="pub-player-count">{filteredPlayers.length} players</span>
            </div>
            <div className="pub-player-list">
              {filteredPlayers.map(p => (
                <div key={p.id} className="pub-player-item" onClick={() => setSelectedPlayerId(p.id)}>
                  <div className="pub-player-name">{p.name}</div>
                  <span className="pub-player-cat">{p.gender === 'female' ? 'F' : 'M'}{getPlayerAge(p) != null ? ` · ${getPlayerAge(p)}y` : ''}</span>
                </div>
              ))}
            </div>
            {filteredPlayers.length === 0 && (
              <div className="pub-empty">No players found.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}