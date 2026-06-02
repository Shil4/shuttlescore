import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getPlayerAge } from '../admin/PlayerManager';
import MedalBadges from './MedalBadges';
import { sideLabel, stageLabel, formatDate, scoreDisplay, calcMedals } from './helpers';

export default function FullHistory({ playerId, allPlayers, initialTab = 'player', onClose, onPlayerClick, onRefClick }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeTournamentId, setActiveTournamentId] = useState(null);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data: player } = await supabase.from('players').select('*').eq('id', playerId).single();

      // All matches where this player participated
      const { data: allMatches } = await supabase.from('matches')
        .select('*, event:events!inner(name, type, gender, category, tournament_id)')
        .or('side_a.cs.{' + playerId + '},side_b.cs.{' + playerId + '}')
        .order('created_at', { ascending: false });

      // Get tournament IDs
      const tournIds = [...new Set((allMatches || []).map(m => m.event?.tournament_id).filter(Boolean))];
      const { data: tournaments } = tournIds.length > 0
        ? await supabase.from('tournaments').select('id, name, start_date, status').in('id', tournIds).order('start_date', { ascending: false })
        : { data: [] };

      // All events for medal calculation
      const eventIds = [...new Set((allMatches || []).map(m => m.event_id).filter(Boolean))];
      const { data: events } = eventIds.length > 0
        ? await supabase.from('events').select('id, name, type, gender, category').in('id', eventIds)
        : { data: [] };

      // Check if player has refereed — via referees table (regular referees)
      const { data: referee } = await supabase.from('referees').select('*').eq('player_id', playerId).maybeSingle();
      let refMatches = [];
      if (referee) {
        const { data: rm } = await supabase.from('matches').select('*, event:events!inner(name, tournament_id)')
          .eq('referee_id', referee.id).order('created_at', { ascending: false });
        refMatches = rm || [];
      }

      // Also check if player is linked to an admin profile (admin referees)
      const { data: adminProfile } = await supabase.from('profiles').select('id').eq('player_id', playerId).eq('role', 'admin').maybeSingle();
      if (adminProfile) {
        const { data: adminRefMatches } = await supabase.from('matches').select('*, event:events!inner(name, tournament_id)')
          .eq('referee_admin_id', adminProfile.id).eq('referee_is_admin', true).order('created_at', { ascending: false });
        refMatches = [...refMatches, ...(adminRefMatches || [])];
      }

      // Build name map for display
      const allIds = new Set();
      (allMatches || []).forEach(m => { (m.side_a || []).forEach(id => allIds.add(id)); (m.side_b || []).forEach(id => allIds.add(id)); });
      refMatches.forEach(m => { (m.side_a || []).forEach(id => allIds.add(id)); (m.side_b || []).forEach(id => allIds.add(id)); });
      const { data: players } = allIds.size > 0
        ? await supabase.from('players').select('id, name').in('id', [...allIds])
        : { data: [] };

      // Enrich matches with event name
      const enriched = (allMatches || []).map(m => ({
        ...m, _eventName: m.event?.name || '?',
        _tournamentId: m.event?.tournament_id,
      }));
      const enrichedRef = refMatches.map(m => ({
        ...m, _eventName: m.event?.name || '?',
        _tournamentId: m.event?.tournament_id,
      }));

      setData({
        player, tournaments: tournaments || [], events: events || [],
        matches: enriched, refMatches: enrichedRef,
        referee, isAdminReferee: !!adminProfile, allPlayers: players || [],
        hasPlayerHistory: enriched.length > 0,
        hasRefHistory: enrichedRef.length > 0,
      });

      // Set default tab — respect initialTab prop, fall back gracefully
      if (initialTab === 'referee' && enrichedRef.length > 0) {
        setActiveTab('referee');
      } else if (enriched.length > 0) {
        setActiveTab('player');
      } else if (enrichedRef.length > 0) {
        setActiveTab('referee');
      }
      setActiveTournamentId(tournaments?.[0]?.id || null);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  if (loading) return <div className="pub-loading"><div className="pub-loading-icon">{'\uD83C\uDFF8'}</div><p>Loading history...</p></div>;
  if (!data) return null;

  const { player, tournaments, events, matches, refMatches, referee, isAdminReferee, hasPlayerHistory, hasRefHistory } = data;
  const ap = data.allPlayers;
  const age = getPlayerAge(player);
  const medals = calcMedals(playerId, matches, events);
  const showTabs = hasPlayerHistory && hasRefHistory;

  // Stats
  const finished = matches.filter(m => m.status === 'finished' || m.status === 'locked');
  const totalWon = finished.filter(m =>
    (m.winner === 'side_a' && (m.side_a || []).includes(playerId)) ||
    (m.winner === 'side_b' && (m.side_b || []).includes(playerId))
  ).length;
  const totalLost = finished.length - totalWon;

  // Current tab matches
  const currentMatches = activeTab === 'player'
    ? matches.filter(m => !activeTournamentId || m._tournamentId === activeTournamentId)
    : refMatches.filter(m => !activeTournamentId || m._tournamentId === activeTournamentId);

  // Tournaments for current tab
  const tabTournamentIds = activeTab === 'player'
    ? [...new Set(matches.map(m => m._tournamentId).filter(Boolean))]
    : [...new Set(refMatches.map(m => m._tournamentId).filter(Boolean))];
  const tabTournaments = tournaments.filter(t => tabTournamentIds.includes(t.id));

  const renderMatchRow = (m) => {
    const isA = (m.side_a || []).includes(playerId);
    const won = (isA && m.winner === 'side_a') || (!isA && m.winner === 'side_b');
    const fin = m.status === 'finished' || m.status === 'locked';
    const scores = scoreDisplay(m);

    return (
      <div key={m.id} className={'pub-match-mini ' + (m.status === 'in_progress' ? 'live' : '')}>
        <div style={{ width: '100%' }}>
          <div className="pub-match-mini-header">
            <span className="pub-match-mini-event">{m._eventName}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="pub-match-mini-stage">{stageLabel(m.stage)}</span>
              {activeTab === 'player' && fin && <span className={'pub-result-badge ' + (won ? 'win' : 'loss')}>{won ? 'W' : 'L'}</span>}
            </div>
          </div>
          <div className="pub-match-mini-sides">
            <span className={activeTab === 'player' && isA && won ? 'won' : ''}
              onClick={() => m.side_a?.[0] && onPlayerClick(m.side_a[0])}>{sideLabel(m.side_a, ap)}</span>
            <span className="pub-match-mini-score">
              {scores ? scores.map((s, i) => <span key={i} className="pub-set-score" style={{ fontSize: 10, ...(s.walkover ? { color: '#d4a843' } : {}) }}>{s.text}</span>) : 'vs'}
            </span>
            <span className={activeTab === 'player' && !isA && won ? 'won' : ''}
              onClick={() => m.side_b?.[0] && onPlayerClick(m.side_b[0])}>{sideLabel(m.side_b, ap)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="pub-history-header">
        <button className="pub-back-btn" onClick={onClose}>{'\u2190'} Back</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h2 className="pub-history-name">{player.name}</h2>
        <div className="pub-profile-meta">
          <span className="pub-profile-badge">{player.gender === 'female' ? 'F' : 'M'}</span>
          {age != null && <span className="pub-profile-badge">{age} years</span>}
          {(referee || isAdminReferee) && <span className="pub-profile-badge" style={{ background: '#1a2a1a', color: '#4ecb71' }}>Referee</span>}
        </div>
      </div>

      <MedalBadges medals={medals} />

      {/* Overall stats */}
      <div className="pub-history-summary">
        <div className="pub-profile-stat">
          <span className="pub-profile-stat-num">{finished.length}</span>
          <span className="pub-profile-stat-label">Played</span>
        </div>
        <div className="pub-profile-stat">
          <span className="pub-profile-stat-num" style={{ color: '#4ecb71' }}>{totalWon}</span>
          <span className="pub-profile-stat-label">Won</span>
        </div>
        <div className="pub-profile-stat">
          <span className="pub-profile-stat-num" style={{ color: '#ff6655' }}>{totalLost}</span>
          <span className="pub-profile-stat-label">Lost</span>
        </div>
        {hasRefHistory && (
          <div className="pub-profile-stat">
            <span className="pub-profile-stat-num" style={{ color: '#d4a843' }}>{refMatches.length}</span>
            <span className="pub-profile-stat-label">Refereed</span>
          </div>
        )}
      </div>

      {/* Player / Referee tabs */}
      {showTabs && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          <button className={'pub-tab ' + (activeTab === 'player' ? 'active' : '')}
            onClick={() => { setActiveTab('player'); setActiveTournamentId(tabTournaments[0]?.id || null); }}
            style={{ flex: 'none', padding: '8px 16px' }}>
            {'\uD83C\uDFF8'} Player
          </button>
          <button className={'pub-tab ' + (activeTab === 'referee' ? 'active' : '')}
            onClick={() => { setActiveTab('referee'); setActiveTournamentId(tabTournaments[0]?.id || null); }}
            style={{ flex: 'none', padding: '8px 16px' }}>
            {'\uD83C\uDFC5'} Referee
          </button>
        </div>
      )}

      {/* Tournament sub-tabs */}
      {tabTournaments.length > 1 && (
        <div className="pub-event-tabs" style={{ marginBottom: 16 }}>
          {tabTournaments.map(t => (
            <button key={t.id} className={'pub-event-tab ' + (activeTournamentId === t.id ? 'active' : '')}
              onClick={() => setActiveTournamentId(t.id)}>
              {t.name}
              {t.start_date && <span style={{ display: 'block', fontSize: 10, opacity: 0.7 }}>{formatDate(t.start_date)}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Match list */}
      <div className="pub-history-matches">
        {currentMatches.length === 0 ? (
          <p style={{ color: '#555', fontSize: 13, padding: 10 }}>No {activeTab === 'player' ? 'matches' : 'refereed matches'} found.</p>
        ) : (
          currentMatches.filter(m => m.side_a && m.side_b).map(renderMatchRow)
        )}
      </div>
    </div>
  );
}