import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { RealtimeService } from '../../services/RealtimeService';
import { getPlayerAge } from '../admin/PlayerManager';
import MatchCard from './MatchCard';
import PlayerProfile from './PlayerProfile';
import FullHistory from './FullHistory';
import BracketView from './BracketView';
import QRModal from './QRModal';
import TournamentSummary from './TournamentSummary';
import ScoreGraph from './ScoreGraph';
import { MedalIcon } from './MedalBadges';
import { stageLabel, formatDate, pName, sideLabel, scoreDisplay, calcMedals, getPlayerEventMedal } from './helpers';
import './PublicView.css';


// ── Confetti ──────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const COLOURS = ['#4ecb71','#d4a843','#5588ff','#ff6655','#ffffff','#cc88ff'];
  const pieces = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * -canvas.height,
    w: 8 + Math.random() * 8, h: 4 + Math.random() * 4,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    rot: Math.random() * Math.PI * 2, vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4, vr: (Math.random() - 0.5) * 0.15,
  }));
  let frame;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.05;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.colour; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if (alive) { frame = requestAnimationFrame(draw); }
    else { cancelAnimationFrame(frame); if (canvas.parentNode) document.body.removeChild(canvas); }
  };
  frame = requestAnimationFrame(draw);
  setTimeout(() => { cancelAnimationFrame(frame); if (canvas.parentNode) document.body.removeChild(canvas); }, 5000);
}

export default function PublicView({ onLogin }) {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [matches, setMatches] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [referees, setReferees] = useState([]);
  const [adminProfiles, setAdminProfiles] = useState([]); // all admin profiles: { id, display_name, name, player_id }
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [selectedRefId, setSelectedRefId] = useState(null);
  const [refProfileData, setRefProfileData] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [playerSearch, setPlayerSearch] = useState('');
  const [fullHistoryPlayerId, setFullHistoryPlayerId] = useState(null);
  const [fullHistoryInitialTab, setFullHistoryInitialTab] = useState('player');
  const [overviewEventFilter, setOverviewEventFilter] = useState('all');
  const [overviewStatusFilter, setOverviewStatusFilter] = useState('all');
  const [announcement, setAnnouncement] = useState('');
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Load tournaments + all admin profiles
  useEffect(() => {
    (async () => {
      const { data: allTourns } = await supabase.from('tournaments').select('*').order('updated_at', { ascending: false });
      setTournaments(allTourns || []);
      if (allTourns?.length > 0) { const active = allTourns.find(t => t.status === 'in_progress') || allTourns[0]; setSelectedTournament(active); }
      const { data: admins } = await supabase.from('profiles').select('id, display_name, name, player_id').eq('role', 'admin');
      setAdminProfiles(admins || []);
      setLoading(false);
    })();
  }, []);

  // Load tournament data + realtime
  useEffect(() => {
    if (!selectedTournament) return;
    loadTournamentData(selectedTournament.id);
    loadAnnouncement(selectedTournament.id);
    setAnnouncementDismissed(false);
    const unsub = RealtimeService.subscribeToMatches((eventType, newRow) => {
      // Confetti when final or bronze match finishes
      if (eventType === 'UPDATE' && newRow?.status === 'finished') {
        const stage = newRow.stage;
        if (stage === 'final' || stage === 'third_place') launchConfetti();
      }
      loadTournamentData(selectedTournament.id);
    });
    const unsubConfig = RealtimeService.subscribeToConfig((row) => {
      if (row?.key === `announcement_${selectedTournament.id}`) {
        setAnnouncement(row.value || '');
        setAnnouncementDismissed(false);
      }
    });
    return () => { unsub(); unsubConfig(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournament?.id]);

  const loadAnnouncement = async (tid) => {
    const { data } = await supabase.from('app_config').select('value').eq('key', `announcement_${tid}`).maybeSingle();
    setAnnouncement(data?.value || '');
  };

  const loadTournamentData = async (tid) => {
    const [evRes, mRes, pRes, gRes, rRes] = await Promise.all([
      supabase.from('events').select('*').eq('tournament_id', tid).order('display_order'),
      supabase.from('matches').select('*, event:events!inner(name, type, gender, category, display_order, tournament_id)').eq('event.tournament_id', tid).order('created_at'),
      supabase.from('players').select('*'),
      supabase.from('groups').select('*, events!inner(tournament_id)').eq('events.tournament_id', tid).order('name'),
      supabase.from('referees').select('*'),
    ]);
    const visibleEvents = (evRes.data || []).filter(e => !e.hidden);
    const visibleEventIds = new Set(visibleEvents.map(e => e.id));
    const visibleGroups = (gRes.data || []).filter(g => visibleEventIds.has(g.event_id));
    const groupMap = {};
    visibleGroups.forEach(g => { groupMap[g.id] = g.name; });
    setEvents(visibleEvents);
    setMatches((mRes.data || []).filter(m => visibleEventIds.has(m.event_id)).map(m => ({
      ...m,
      _eventName: m.event?.name || '?',
      _eventOrder: m.event?.display_order || 0,
      _groupName: m.group_id ? (groupMap[m.group_id] || '') : '',
    })));
    setAllPlayers(pRes.data || []);
    setGroups(visibleGroups.map(g => ({ ...g, _eventId: g.event_id })));
    setReferees(rRes.data || []);
    if (!selectedEventId && visibleEvents.length > 0) setSelectedEventId(visibleEvents[0].id);
  };

  // Ref profile loader
  useEffect(() => {
    if (!selectedRefId) { setRefProfileData(null); return; }
    (async () => {
      const ref = referees.find(r => r.id === selectedRefId);
      if (!ref) return;
      const refMatches = matches.filter(m => m.referee_id === selectedRefId);
      setRefProfileData({ referee: ref, matches: refMatches });
    })();
  }, [selectedRefId, referees, matches]);

  const refereeName = (rid) => { const r = referees.find(x => x.id === rid); return r?.display_name || r?.username || ''; };
  const adminDisplayName = (m) => {
    const a = adminProfiles.find(p => p.id === m.referee_admin_id);
    return a ? (a.display_name || a.name || 'Admin') : 'Admin';
  };
  const getRefDisplay = (m) => {
    if (m.referee_is_admin) return adminDisplayName(m);
    if (m.referee_id) return refereeName(m.referee_id);
    return '';
  };
  const playerName = (id) => pName(id, allPlayers);
  const sideLbl = (arr) => sideLabel(arr, allPlayers);

  // Filtered matches for overview
  const filteredMatches = useMemo(() => matches.filter(m => {
    if (overviewEventFilter !== 'all' && m.event_id !== overviewEventFilter) return false;
    if (overviewStatusFilter === 'live' && m.status !== 'in_progress') return false;
    if (overviewStatusFilter === 'upcoming' && m.status !== 'pending') return false;
    if (overviewStatusFilter === 'results' && m.status !== 'finished' && m.status !== 'locked') return false;
    return true;
  }), [matches, overviewEventFilter, overviewStatusFilter]);

  const liveMatches = filteredMatches.filter(m => m.status === 'in_progress');
  const recentResults = filteredMatches.filter(m => (m.status === 'finished' || m.status === 'locked') && m.side_a && m.side_b)
    .sort((a, b) => new Date(b.finished_at || b.updated_at) - new Date(a.finished_at || a.updated_at));
  const upcomingMatches = filteredMatches.filter(m => m.status === 'pending' && m.side_a?.length > 0 && m.side_b?.length > 0)
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  // Bracket data
  const eventMatches = selectedEventId ? matches.filter(m => m.event_id === selectedEventId) : [];
  const eventGroups = selectedEventId ? groups.filter(g => g._eventId === selectedEventId) : [];

  // Player profile data
  const selectedPlayer = selectedPlayerId ? allPlayers.find(p => p.id === selectedPlayerId) : null;
  const playerMatches = selectedPlayerId ? matches.filter(m => (m.side_a || []).includes(selectedPlayerId) || (m.side_b || []).includes(selectedPlayerId)) : [];

  // Group standings (handles doubles as teams)
  const calcGroupStandings = (groupId) => {
    const allGM = eventMatches.filter(m => m.group_id === groupId);
    const gm = allGM.filter(m => m.status === 'finished' || m.status === 'locked');
    const stats = {};
    const sKey = (a) => a ? a.slice().sort().join(',') : '';
    const goc = (a) => { const k = sKey(a); if (!k) return null; if (!stats[k]) stats[k] = { key: k, playerIds: a, played: 0, won: 0, lost: 0, pf: 0, pa: 0 }; return stats[k]; };
    allGM.forEach(m => { if (m.side_a) goc(m.side_a); if (m.side_b) goc(m.side_b); });
    gm.forEach(m => {
      const sA = goc(m.side_a), sB = goc(m.side_b);
      if (!sA || !sB) return;
      sA.played++; sB.played++;
      const tA = (m.score_data?.sets || []).reduce((s, x) => s + (x.side_a_points || 0), 0);
      const tB = (m.score_data?.sets || []).reduce((s, x) => s + (x.side_b_points || 0), 0);
      sA.pf += tA; sA.pa += tB; sB.pf += tB; sB.pa += tA;
      if (m.winner === 'side_a') { sA.won++; sB.lost++; } else if (m.winner === 'side_b') { sB.won++; sA.lost++; }
    });
    const sorted = Object.values(stats).sort((a, b) => b.won - a.won || (b.pf - b.pa) - (a.pf - a.pa));
    // Flag ties so spectators see when an admin needs to resolve manually
    sorted.forEach((s, i) => {
      s.tied = false;
      if (i > 0 && sorted[i - 1].won === s.won && (sorted[i - 1].pf - sorted[i - 1].pa) === (s.pf - s.pa)) {
        s.tied = true; sorted[i - 1].tied = true;
      }
    });
    return sorted;
  };

  // Player list for Players tab
  const tournamentPlayerIds = useMemo(() => {
    const ids = new Set();
    matches.forEach(m => { (m.side_a || []).forEach(id => ids.add(id)); (m.side_b || []).forEach(id => ids.add(id)); });
    return ids;
  }, [matches]);
  const filteredPlayers = allPlayers.filter(p => tournamentPlayerIds.has(p.id))
    .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Loading skeleton ──
  if (loading) return (
    <div className="pub">
      <header className="pub-header">
        <div className="pub-header-left"><span className="pub-logo">{'\uD83C\uDFF8'} ShuttleScore</span></div>
      </header>
      <div className="pub-skeleton-page">
        <div className="pub-skeleton pub-skeleton-header" />
        <div className="pub-skeleton-tabs">
          <div className="pub-skeleton pub-skeleton-tab" />
          <div className="pub-skeleton pub-skeleton-tab" />
          <div className="pub-skeleton pub-skeleton-tab" />
        </div>
        <div className="pub-skeleton pub-skeleton-card" />
        <div className="pub-skeleton pub-skeleton-card" />
        <div className="pub-skeleton pub-skeleton-card-sm" />
        <div className="pub-skeleton pub-skeleton-card-sm" />
      </div>
    </div>
  );

  // ── Full History Page ──
  if (fullHistoryPlayerId) return (
    <div className="pub"><div className="pub-content">
      <FullHistory playerId={fullHistoryPlayerId} allPlayers={allPlayers}
        initialTab={fullHistoryInitialTab}
        onClose={() => { setFullHistoryPlayerId(null); setFullHistoryInitialTab('player'); }}
        onPlayerClick={(id) => { setFullHistoryPlayerId(null); setFullHistoryInitialTab('player'); setSelectedPlayerId(id); }}
        onRefClick={(rid) => setSelectedRefId(rid)} />
    </div></div>
  );

  return (
    <div className="pub">
      <header className="pub-header">
        <div className="pub-header-left">
          <span className="pub-logo">{'\uD83C\uDFF8'} ShuttleScore</span>
          {selectedTournament && <span className="pub-header-tournament" style={{ marginLeft: 10 }}>{selectedTournament.name}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {tournaments.length > 1 && (
            <select className="pub-tournament-select" value={selectedTournament?.id || ''} onChange={e => setSelectedTournament(tournaments.find(t => t.id === e.target.value))}>
              {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button className="pub-qr-btn" onClick={() => setShowQR(true)} title="Show QR code">{'\uD83D\uDCF1'}</button>
          {onLogin && <button className="pub-login-btn" onClick={onLogin}>Login</button>}
        </div>
      </header>

      {showQR && <QRModal onClose={() => setShowQR(false)} />}

      {/* Player Profile Popup */}
      {selectedPlayer && (
        <PlayerProfile player={selectedPlayer} matches={playerMatches} allMatches={matches}
          events={events} allPlayers={allPlayers} tournamentName={selectedTournament?.name || ''}
          onClose={() => setSelectedPlayerId(null)}
          onPlayerClick={(id) => setSelectedPlayerId(id)}
          onViewHistory={() => { setFullHistoryPlayerId(selectedPlayerId); setFullHistoryInitialTab('player'); setSelectedPlayerId(null); }}
          onRefClick={(rid) => setSelectedRefId(rid)}
          getMatchRefDisplay={getRefDisplay} />
      )}

      {/* Referee profile overlay */}
      {selectedRefId && selectedRefId !== '__admin__' && refProfileData && (
        <div className="pub-overlay" onClick={() => setSelectedRefId(null)}>
          <div className="pub-profile-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <button className="pub-profile-close" onClick={() => setSelectedRefId(null)}>{'\u2715'}</button>
            <h3 className="pub-profile-name">{<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>R</span>} {refProfileData.referee?.display_name || refProfileData.referee?.username}</h3>
            <div className="pub-profile-stats">
              <div className="pub-profile-stat">
                <span className="pub-profile-stat-num">{refProfileData.matches.length}</span>
                <span className="pub-profile-stat-label">Matches Refereed</span>
              </div>
            </div>
            {refProfileData.referee?.player_id && (
              <button className="pub-full-history-btn" onClick={() => {
                const pid = refProfileData.referee.player_id;
                setSelectedRefId(null);
                setFullHistoryPlayerId(pid);
                setFullHistoryInitialTab('referee');
              }}>
                {'\uD83D\uDCCA'} View Full Profile
              </button>
            )}
          </div>
        </div>
      )}
      {/* Admin referee overlay */}
      {selectedRefId && adminProfiles.some(p => p.id === selectedRefId) && (() => {
        const adminP = adminProfiles.find(p => p.id === selectedRefId);
        const adminMatchCount = matches.filter(m => m.referee_is_admin && m.referee_admin_id === selectedRefId && (m.status === 'finished' || m.status === 'locked')).length;
        return (
          <div className="pub-overlay" onClick={() => setSelectedRefId(null)}>
            <div className="pub-profile-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
              <button className="pub-profile-close" onClick={() => setSelectedRefId(null)}>{'\u2715'}</button>
              <h3 className="pub-profile-name">{<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>R</span>} {adminP.display_name || adminP.name || 'Admin'}</h3>
              <div className="pub-profile-meta"><span className="pub-profile-badge">Admin Referee</span></div>
              <div className="pub-profile-stats">
                <div className="pub-profile-stat">
                  <span className="pub-profile-stat-num">{adminMatchCount}</span>
                  <span className="pub-profile-stat-label">Matches Refereed</span>
                </div>
              </div>
              {adminP.player_id && (
                <button className="pub-full-history-btn" onClick={() => {
                  setSelectedRefId(null);
                  setFullHistoryPlayerId(adminP.player_id);
                  setFullHistoryInitialTab('referee');
                }}>
                  {'\uD83D\uDCCA'} View Full Profile
                </button>
              )}
            </div>
          </div>
        );
      })()}
      {/* Fallback admin overlay when referee_admin_id not set (old matches) */}
      {selectedRefId === '__admin__' && (
        <div className="pub-overlay" onClick={() => setSelectedRefId(null)}>
          <div className="pub-profile-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <button className="pub-profile-close" onClick={() => setSelectedRefId(null)}>{'\u2715'}</button>
            <h3 className="pub-profile-name">{<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>R</span>} Admin</h3>
            <div className="pub-profile-meta"><span className="pub-profile-badge">Admin Referee</span></div>
          </div>
        </div>
      )}

      {/* Announcement bar */}
      {announcement && !announcementDismissed && (
        <div className="pub-announcement">
          <span className="pub-announcement-icon">{'\uD83D\uDCE3'}</span>
          <span className="pub-announcement-text">{announcement}</span>
          <button className="pub-announcement-dismiss" onClick={() => setAnnouncementDismissed(true)}>{'\u2715'}</button>
        </div>
      )}

      <div className="pub-content">
        {/* Tabs */}
        <div className="pub-tabs">
          {['overview', 'brackets', 'players'].map(tab => (
            <button key={tab} className={'pub-tab ' + (activeTab === tab ? 'active' : '')} onClick={() => setActiveTab(tab)}>
              {tab === 'overview' ? 'Overview' : tab === 'brackets' ? 'Brackets' : 'Players'}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="pub-tab-content">
            {/* Tournament card */}
            {selectedTournament && (
              <div className="pub-tournament-card">
                <h2 className="pub-tournament-name">{selectedTournament.name}</h2>
                <div className="pub-tournament-meta">
                  {selectedTournament.venue && <span>{'\uD83D\uDCCD'} {selectedTournament.venue}</span>}
                  {selectedTournament.start_date && <span>{'\uD83D\uDCC5'} {formatDate(selectedTournament.start_date)}{selectedTournament.end_date && selectedTournament.end_date !== selectedTournament.start_date ? ' \u2014 ' + formatDate(selectedTournament.end_date) : ''}</span>}
                </div>
                {events.length > 0 && (
                  <div className="pub-tournament-events">
                    {events.map(e => <span key={e.id} className="pub-event-chip">{e.name}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* Tournament summary — cross-event progress */}
            {events.length > 0 && (
              <TournamentSummary events={events} matches={matches} allPlayers={allPlayers}
                onEventClick={(evtId) => { setSelectedEventId(evtId); setActiveTab('brackets'); }} />
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={overviewEventFilter} onChange={e => setOverviewEventFilter(e.target.value)}
                style={{ background: '#14141f', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ccc', padding: '6px 10px', fontSize: 12 }}>
                <option value="all">All Events</option>
                {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              {['all', 'live', 'upcoming', 'results'].map(f => (
                <button key={f} onClick={() => setOverviewStatusFilter(f)}
                  style={{ background: overviewStatusFilter === f ? '#2a2a3e' : 'transparent', border: '1px solid #2a2a3e', borderRadius: 6,
                    color: overviewStatusFilter === f ? '#ddd' : '#888', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
                  {f === 'all' ? 'All' : f === 'live' ? '\uD83D\uDD34 Live' : f === 'upcoming' ? 'Upcoming' : 'Results'}
                </button>
              ))}
            </div>

            {/* Live */}
            {liveMatches.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title"><span className="pub-live-dot" /> Live Now</h3>
                {liveMatches.map(m => <MatchCard key={m.id} match={m} allPlayers={allPlayers} allMatches={matches}
                  onPlayerClick={setSelectedPlayerId} onRefClick={setSelectedRefId}
                  refereeName={getRefDisplay(m)} refId={m.referee_is_admin ? (m.referee_admin_id || "__admin__") : m.referee_id} />)}
              </div>
            )}

            {/* Upcoming */}
            {upcomingMatches.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title">Upcoming</h3>
                {upcomingMatches.map(m => <MatchCard key={m.id} match={m} allPlayers={allPlayers} allMatches={matches}
                  onPlayerClick={setSelectedPlayerId} onRefClick={setSelectedRefId}
                  refereeName={getRefDisplay(m)} refId={m.referee_is_admin ? (m.referee_admin_id || "__admin__") : m.referee_id} />)}
              </div>
            )}

            {/* Results */}
            {recentResults.length > 0 && (
              <div className="pub-section">
                <h3 className="pub-section-title">Results</h3>
                {recentResults.map(m => <MatchCard key={m.id} match={m} allPlayers={allPlayers} allMatches={matches}
                  onPlayerClick={setSelectedPlayerId} onRefClick={setSelectedRefId}
                  refereeName={getRefDisplay(m)} refId={m.referee_is_admin ? (m.referee_admin_id || "__admin__") : m.referee_id} />)}
              </div>
            )}

            {liveMatches.length === 0 && recentResults.length === 0 && upcomingMatches.length === 0 && (
              <div className="pub-empty">No matches to show{overviewEventFilter !== 'all' || overviewStatusFilter !== 'all' ? ' for this filter' : ''}.</div>
            )}
          </div>
        )}

        {/* ── BRACKETS TAB ── */}
        {activeTab === 'brackets' && (
          <div className="pub-tab-content">
            <div className="pub-event-tabs">
              {events.map(e => (
                <button key={e.id} className={'pub-event-tab ' + (selectedEventId === e.id ? 'active' : '')} onClick={() => setSelectedEventId(e.id)}>
                  {e.name}
                  {e.start_date && <span style={{ display: 'block', fontSize: 10, opacity: 0.7 }}>{formatDate(e.start_date)}{e.end_date && e.end_date !== e.start_date ? ' - ' + formatDate(e.end_date) : ''}</span>}
                </button>
              ))}
            </div>

            {/* Groups */}
            {eventGroups.length > 0 && (
              <div className="pub-groups">
                {eventGroups.map(group => {
                  const standings = calcGroupStandings(group.id);
                  const gMatches = eventMatches.filter(m => m.group_id === group.id && m.side_a && m.side_b);
                  return (
                    <div key={group.id} className="pub-group-card">
                      <h4 className="pub-group-name">{group.name}</h4>
                      <table className="pub-standings-table">
                        <thead><tr><th>#</th><th>Player/Team</th><th>P</th><th>W</th><th>L</th><th>PD</th></tr></thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.key}>
                              <td>{i + 1}{s.tied && <span style={{ color: '#e85454', marginLeft: 2 }} title="Tied on wins and point diff">*</span>}</td>
                              <td className="clickable" onClick={() => s.playerIds?.[0] && setSelectedPlayerId(s.playerIds[0])}>{sideLbl(s.playerIds)}</td>
                              <td>{s.played}</td><td>{s.won}</td><td>{s.lost}</td><td>{(s.pf - s.pa) >= 0 ? '+' : ''}{s.pf - s.pa}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="pub-group-matches">
                        {gMatches.map(m => {
                          const scores = scoreDisplay(m);
                          return (
                            <div key={m.id} className={'pub-match-mini ' + (m.status === 'in_progress' ? 'live' : '')}>
                              <div className="pub-match-mini-sides">
                                <span className={m.winner === 'side_a' ? 'won' : ''} onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>{sideLbl(m.side_a)}</span>
                                <span className="pub-match-mini-score">
                                  {scores ? scores.map((s, i) => <span key={i} className="pub-set-score" style={{ fontSize: 10, ...(s.walkover ? { color: '#d4a843' } : {}) }}>{s.text}</span>) : 'vs'}
                                </span>
                                <span className={m.winner === 'side_b' ? 'won' : ''} onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>{sideLbl(m.side_b)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Round Robin — treated like a single virtual group (no group_id) */}
            {(() => {
              const rrMatches = eventMatches.filter(m => m.stage === 'round_robin');
              if (!rrMatches.length) return null;
              const standings = calcGroupStandings(null);
              const rrPlayable = rrMatches.filter(m => m.side_a && m.side_b);
              return (
                <div className="pub-groups">
                  <div className="pub-group-card">
                    <h4 className="pub-group-name">Round Robin</h4>
                    <table className="pub-standings-table">
                      <thead><tr><th>#</th><th>Player/Team</th><th>P</th><th>W</th><th>L</th><th>PD</th></tr></thead>
                      <tbody>
                        {standings.map((s, i) => (
                          <tr key={s.key}>
                            <td>{i + 1}{s.tied && <span style={{ color: '#e85454', marginLeft: 2 }} title="Tied on wins and point diff">*</span>}</td>
                            <td className="clickable" onClick={() => s.playerIds?.[0] && setSelectedPlayerId(s.playerIds[0])}>{sideLbl(s.playerIds)}</td>
                            <td>{s.played}</td><td>{s.won}</td><td>{s.lost}</td><td>{(s.pf - s.pa) >= 0 ? '+' : ''}{s.pf - s.pa}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="pub-group-matches">
                      {rrPlayable.map(m => {
                        const scores = scoreDisplay(m);
                        return (
                          <div key={m.id} className={'pub-match-mini ' + (m.status === 'in_progress' ? 'live' : '')}>
                            <div className="pub-match-mini-sides">
                              <span className={m.winner === 'side_a' ? 'won' : ''} onClick={() => m.side_a?.[0] && setSelectedPlayerId(m.side_a[0])}>{sideLbl(m.side_a)}</span>
                              <span className="pub-match-mini-score">
                                {scores ? scores.map((s, i) => <span key={i} className="pub-set-score" style={{ fontSize: 10, ...(s.walkover ? { color: '#d4a843' } : {}) }}>{s.text}</span>) : 'vs'}
                              </span>
                              <span className={m.winner === 'side_b' ? 'won' : ''} onClick={() => m.side_b?.[0] && setSelectedPlayerId(m.side_b[0])}>{sideLbl(m.side_b)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Bracket */}
            {(() => {
              const knockout = eventMatches.filter(m => m.stage !== 'group' && m.stage !== 'round_robin');
              if (!knockout.length) return null;
              return (
                <div className="pub-bracket">
                  <BracketView matches={knockout} allPlayers={allPlayers} onPlayerClick={setSelectedPlayerId} />
                </div>
              );
            })()}

                        {eventMatches.length === 0 && <div className="pub-empty">No draws yet for this event.</div>}
          </div>
        )}

        {/* ── PLAYERS TAB ── */}
        {activeTab === 'players' && (
          <div className="pub-tab-content">
            <div className="pub-player-search">
              <input type="text" placeholder="Search players..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} />
              <span className="pub-player-count">{filteredPlayers.length}</span>
            </div>
            <div className="pub-player-list">
              {filteredPlayers.map(p => {
                const age = getPlayerAge(p);
                return (
                  <div key={p.id} className="pub-player-item" onClick={() => setSelectedPlayerId(p.id)}>
                    <span className="pub-player-name">{p.name}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {age != null && <span className="pub-player-cat">{age}y</span>}
                      <span className="pub-player-cat">{p.gender === 'female' ? 'F' : 'M'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}