import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import './AdminComponents.css';

export default function RefereeManager() {
  const { user } = useAuth();
  const [referees, setReferees] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Admin display name + player link
  const [adminName, setAdminName] = useState('');
  const [adminPlayerId, setAdminPlayerId] = useState('');
  const [adminNameSaved, setAdminNameSaved] = useState(false);
  const [showAdminPlayerLink, setShowAdminPlayerLink] = useState(false);
  const [adminPlayerSearch, setAdminPlayerSearch] = useState('');

  // Editing referee
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ display_name: '', password: '', player_id: '' });

  // Referee match history
  const [historyRefId, setHistoryRefId] = useState(null);
  const [historyMatches, setHistoryMatches] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [{ data: refs }, { data: players }, { data: folders }] = await Promise.all([
        supabase.from('referees').select('*').order('username'),
        supabase.from('players').select('id, name').order('name'),
        supabase.from('player_folders').select('*').order('sort_order').order('name'),
      ]);
      setReferees(refs || []);
      setAllPlayers(players || []);
      setAllFolders(folders || []);

      // Load admin profile
      if (user?.profile?.id) {
        const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.profile.id).single();
        if (profile?.display_name) { setAdminName(profile.display_name); setAdminNameSaved(true); }
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleSaveAdminName = async () => {
    if (!adminName.trim() || !user?.profile?.id) return;
    try {
      await supabase.from('profiles').update({ display_name: adminName.trim() }).eq('id', user.profile.id);
      setAdminNameSaved(true); setSuccess('Admin name saved.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) { setError(err.message); }
  };

  // When admin links to a player, offer to use player name
  const handleAdminPlayerLink = (playerId) => {
    setAdminPlayerId(playerId);
    if (playerId) {
      const player = allPlayers.find(p => p.id === playerId);
      if (player && (!adminName.trim() || window.confirm(`Use "${player.name}" as your admin display name?`))) {
        setAdminName(player.name);
        setAdminNameSaved(false);
      }
    }
  };

  const startEdit = (ref) => {
    setEditingId(ref.id);
    setEditForm({ display_name: ref.display_name || '', password: ref.password, player_id: ref.player_id || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      const update = {
        display_name: editForm.display_name.trim() || null,
        password: editForm.password,
        player_id: editForm.player_id || null,
      };
      await supabase.from('referees').update(update).eq('id', editingId);
      setEditingId(null); setSuccess('Referee updated.');
      setTimeout(() => setSuccess(''), 2000);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  // When linking a referee to a player, offer to override name
  const handleRefPlayerLink = (playerId) => {
    if (playerId) {
      const player = allPlayers.find(p => p.id === playerId);
      if (player && (!editForm.display_name.trim() || window.confirm(`Use "${player.name}" as this referee's display name?`))) {
        setEditForm({ ...editForm, player_id: playerId, display_name: player.name });
        return;
      }
    }
    setEditForm({ ...editForm, player_id: playerId });
  };

  const handleAddReferee = async () => {
    const nextNum = referees.length + 1;
    const username = `ref${nextNum}`;
    const password = `shuttle${nextNum}`;
    try {
      await supabase.from('referees').insert({ username, password });
      setSuccess(`Created ${username} / ${password}`);
      setTimeout(() => setSuccess(''), 3000);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  const handleDeleteReferee = async (refId) => {
    const ref = referees.find(r => r.id === refId);
    const { count } = await supabase.from('matches').select('*', { count: 'exact', head: true }).eq('referee_id', refId);
    if (count > 0) {
      if (!window.confirm(`${ref?.username} is assigned to ${count} match(es). Removing will unassign them. Continue?`)) return;
      await supabase.from('matches').update({ referee_id: null, referee_confirmed: false }).eq('referee_id', refId);
    } else {
      if (!window.confirm(`Delete referee account ${ref?.username}?`)) return;
    }
    try {
      await supabase.from('referees').delete().eq('id', refId);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  const loadHistory = async (refId) => {
    if (historyRefId === refId) { setHistoryRefId(null); return; }
    setHistoryRefId(refId); setHistoryLoading(true);
    try {
      const { data: ms } = await supabase.from('matches').select('*').eq('referee_id', refId)
        .in('status', ['finished', 'locked', 'in_progress']).order('started_at', { ascending: false });
      const eventIds = [...new Set((ms || []).map(m => m.event_id))];
      const { data: evts } = eventIds.length > 0 ? await supabase.from('events').select('id, name').in('id', eventIds) : { data: [] };
      const evtMap = {};
      (evts || []).forEach(e => { evtMap[e.id] = e.name; });
      setHistoryMatches((ms || []).map(m => ({ ...m, _eventName: evtMap[m.event_id] || '' })));
    } catch (err) { setError(err.message); }
    finally { setHistoryLoading(false); }
  };

  const playerName = (id) => allPlayers.find(p => p.id === id)?.name || '?';
  const sideLabel = (sideArr) => (!sideArr || !sideArr.length) ? 'TBD' : sideArr.map(playerName).join(' & ');

  // Filtered players for admin link
  const adminFilteredPlayers = adminPlayerSearch
    ? allPlayers.filter(p => p.name.toLowerCase().includes(adminPlayerSearch.toLowerCase()))
    : allPlayers;

  if (loading) return <div className="admin-loading">Loading...</div>;

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Referees</h2>
        <button className="admin-btn primary" onClick={handleAddReferee}>+ Add Referee</button>
      </div>
      {error && <div className="admin-error">{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      {/* Admin name + player link */}
      <div className="admin-form-card" style={{ marginBottom: 20 }}>
        <h3>Your Admin Name</h3>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>Shown when you referee a match yourself.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="admin-field" style={{ flex: 1, minWidth: 150 }}>
            <input type="text" value={adminName} onChange={e => { setAdminName(e.target.value); setAdminNameSaved(false); }}
              placeholder="Your name" />
          </div>
          <button className="admin-btn primary" onClick={handleSaveAdminName} disabled={adminNameSaved || !adminName.trim()}>
            {adminNameSaved ? '✓ Saved' : 'Save'}
          </button>
          <button className="admin-btn secondary" onClick={() => setShowAdminPlayerLink(!showAdminPlayerLink)} style={{ fontSize: 12 }}>
            {showAdminPlayerLink ? 'Hide' : '🔗 Link Player'}
          </button>
        </div>
        {showAdminPlayerLink && (
          <div style={{ marginTop: 12, background: '#14141f', borderRadius: 8, padding: 12, border: '1px solid #1e1e2e' }}>
            <p style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>If you're also playing, link to your player profile. Your display name will update to match.</p>
            <input type="text" placeholder="Search players..." value={adminPlayerSearch} onChange={e => setAdminPlayerSearch(e.target.value)}
              className="pool-search-input" style={{ marginBottom: 8, width: '100%' }} />
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {adminFilteredPlayers.map(p => (
                <div key={p.id} className={`ref-player-option ${adminPlayerId === p.id ? 'selected' : ''}`}
                  onClick={() => handleAdminPlayerLink(adminPlayerId === p.id ? '' : p.id)}
                  style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#ddd', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  {adminPlayerId === p.id && <span style={{ color: '#4ecb71' }}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Referee list */}
      <div className="admin-list">
        {referees.map(ref => (
          <div key={ref.id}>
            <div className="admin-list-item">
              <div className="admin-list-main">
                <div className="admin-list-title">
                  {ref.display_name || <span style={{ color: '#555', fontStyle: 'italic' }}>No name yet</span>}
                  <span style={{ color: '#666', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>@{ref.username}</span>
                </div>
                <div className="admin-list-meta">
                  <span>Password: <code style={{ color: '#d4a843' }}>{ref.password}</code></span>
                  {ref.player_id && <span>🔗 {playerName(ref.player_id)}</span>}
                </div>
              </div>
              <div className="admin-list-right">
                <button className="admin-btn small" onClick={() => loadHistory(ref.id)}>
                  {historyRefId === ref.id ? '▾ History' : '▸ History'}
                </button>
                <button className="admin-btn small" onClick={() => editingId === ref.id ? setEditingId(null) : startEdit(ref)}>
                  {editingId === ref.id ? 'Cancel' : 'Edit'}
                </button>
                <button className="admin-btn small danger" onClick={() => handleDeleteReferee(ref.id)}>Delete</button>
              </div>
            </div>

            {/* Edit form */}
            {editingId === ref.id && (
              <div className="admin-form-card" style={{ margin: '0 0 8px', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                <div className="admin-form-row">
                  <div className="admin-field"><label>Display Name</label>
                    <input type="text" value={editForm.display_name} onChange={e => setEditForm({ ...editForm, display_name: e.target.value })} placeholder="Referee name" />
                  </div>
                  <div className="admin-field"><label>Password</label>
                    <input type="text" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} />
                  </div>
                  <div className="admin-field"><label>Linked Player</label>
                    <select value={editForm.player_id} onChange={e => handleRefPlayerLink(e.target.value)}>
                      <option value="">None</option>
                      {allPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <p style={{ color: '#666', fontSize: 11, marginBottom: 8 }}>Linking to a player will offer to update the display name to match.</p>
                <button className="admin-btn primary" onClick={handleSaveEdit}>Save</button>
              </div>
            )}

            {/* History */}
            {historyRefId === ref.id && (
              <div style={{ padding: '8px 16px 12px', background: '#11111a', borderRadius: '0 0 8px 8px', marginBottom: 8 }}>
                {historyLoading ? <p style={{ color: '#555', fontSize: 12 }}>Loading...</p> : historyMatches.length === 0 ? (
                  <p style={{ color: '#555', fontSize: 12 }}>No matches refereed yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <p style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>{historyMatches.length} match(es) refereed</p>
                    {historyMatches.map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ccc', padding: '4px 8px', background: '#14141f', borderRadius: 6 }}>
                        <span style={{ color: '#888', minWidth: 80 }}>{m._eventName}</span>
                        <span>{sideLabel(m.side_a)} vs {sideLabel(m.side_b)}</span>
                        <span style={{ color: m.status === 'in_progress' ? '#4ecb71' : '#666', marginLeft: 'auto', fontSize: 10, fontWeight: 700 }}>
                          {m.status === 'in_progress' ? 'LIVE' : '✓'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}