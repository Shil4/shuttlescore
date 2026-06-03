import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

const formatDate = (d) => {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
};

const formatDateTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const stageLabel = (s) => ({
  group: 'Group', round_of_32: 'R32', round_of_16: 'R16',
  quarterfinal: 'QF', semifinal: 'SF', third_place: 'Bronze', final: 'Final',
}[s] || s || 'Match');

function buildEntries(matches, players, events, referees, adminProfiles) {
  const playerMap = {};
  players.forEach(p => { playerMap[p.id] = p.name; });
  const eventMap = {};
  events.forEach(e => { eventMap[e.id] = e.name; });
  const refMap = {};
  referees.forEach(r => { refMap[r.id] = r.display_name || r.username; });
  const adminMap = {};
  adminProfiles.forEach(a => { adminMap[a.id] = a.display_name || a.name; });

  const sideName = (ids) => ids?.length ? ids.map(id => playerMap[id] || '?').join(' / ') : 'TBD';

  const entries = [];

  matches.forEach(m => {
    const evtName = eventMap[m.event_id] || 'Unknown event';
    const stage = stageLabel(m.stage);
    const matchLabel = `${evtName} — ${stage}`;
    const sideA = sideName(m.side_a);
    const sideB = sideName(m.side_b);
    const matchDesc = m.side_a?.length && m.side_b?.length ? `${sideA} vs ${sideB}` : 'Unassigned match';

    // Override log entries
    if (Array.isArray(m.override_log)) {
      m.override_log.forEach(entry => {
        const adminName = adminMap[entry.admin_id] || 'Admin';
        entries.push({
          ts: entry.timestamp,
          type: 'override',
          icon: '🔓',
          colour: '#d4a843',
          title: `Score override — ${matchLabel}`,
          detail: `${matchDesc} · by ${adminName}${entry.reason ? ` · "${entry.reason}"` : ''}`,
        });
      });
    }

    // Match finished
    if (m.finished_at && m.winner) {
      const winner = m.winner === 'side_a' ? sideA : sideB;
      entries.push({
        ts: m.finished_at,
        type: 'result',
        icon: m.stage === 'final' ? '🥇' : m.stage === 'third_place' ? '🥉' : '✅',
        colour: '#4ecb71',
        title: `Result — ${matchLabel}`,
        detail: `${winner} won${m.default_win ? ' (walkover)' : ''}`,
      });
    }

    // Match started
    if (m.started_at) {
      entries.push({
        ts: m.started_at,
        type: 'started',
        icon: '▶',
        colour: '#5588ff',
        title: `Match started — ${matchLabel}`,
        detail: matchDesc + (m.court_id ? ` · ${m.court_id}` : ''),
      });
    }

    // Referee assigned
    if (m.referee_id && m.referee_confirmed) {
      const refName = refMap[m.referee_id] || 'Referee';
      entries.push({
        ts: m.updated_at,
        type: 'referee',
        icon: 'R',
        colour: '#888',
        title: `Referee assigned — ${matchLabel}`,
        detail: `${refName} · ${matchDesc}`,
      });
    }

    if (m.referee_is_admin && m.referee_admin_id) {
      const adminName = adminMap[m.referee_admin_id] || 'Admin';
      entries.push({
        ts: m.updated_at,
        type: 'referee',
        icon: '🛡️',
        colour: '#888',
        title: `Admin refereeing — ${matchLabel}`,
        detail: `${adminName} · ${matchDesc}`,
      });
    }
  });

  // Sort newest first
  entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return entries;
}

export default function ActionLog() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTid, setSelectedTid] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    supabase.from('tournaments').select('id, name, start_date').order('start_date', { ascending: false })
      .then(({ data }) => {
        setTournaments(data || []);
        if (data?.[0]) setSelectedTid(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (!selectedTid) return;
    setLoading(true);
    (async () => {
      try {
        const events = await (await import('../../services/TournamentService')).TournamentService.getEvents(selectedTid);
        const eventIds = events.map(e => e.id);

        const [{ data: matches }, { data: players }, { data: referees }, { data: adminProfiles }] = await Promise.all([
          supabase.from('matches').select('*').in('event_id', eventIds),
          supabase.from('players').select('id, name'),
          supabase.from('referees').select('id, username, display_name'),
          supabase.from('profiles').select('id, name, display_name').eq('role', 'admin'),
        ]);

        setEntries(buildEntries(matches || [], players || [], events, referees || [], adminProfiles || []));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedTid]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.type === filter);

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'result', label: '✅ Results' },
    { key: 'override', label: '🔓 Overrides' },
    { key: 'started', label: '▶ Started' },
    { key: 'referee', label: 'R Referees' },
  ];

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Action Log</h2>
      </div>

      {/* Tournament selector */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedTid} onChange={e => setSelectedTid(e.target.value)}
          style={{ background: '#14141f', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ccc', padding: '6px 10px', fontSize: 13 }}>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.start_date ? ` (${formatDate(t.start_date)})` : ''}</option>
          ))}
        </select>

        {/* Type filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={'admin-btn small' + (filter === f.key ? ' primary' : '')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="admin-loading">Loading log...</div>}

      {!loading && filtered.length === 0 && (
        <div className="admin-empty"><p>No entries{filter !== 'all' ? ' for this filter' : ''}.</p></div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="action-log-list">
          {filtered.map((e, i) => (
            <div key={i} className="action-log-entry">
              <div className="action-log-icon" style={{ color: e.colour }}>{e.icon}</div>
              <div className="action-log-body">
                <div className="action-log-title">{e.title}</div>
                <div className="action-log-detail">{e.detail}</div>
              </div>
              <div className="action-log-time">{formatDateTime(e.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}