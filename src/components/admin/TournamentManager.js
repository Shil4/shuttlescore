import { useState, useEffect, useMemo, useCallback } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { supabase } from '../../lib/supabase';
import { getPlayerAge } from './PlayerManager';
import { useShiftSelect } from '../../hooks/useShiftSelect';
import './AdminComponents.css';

export default function TournamentManager() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', venue: '', start_date: '', end_date: '', status: 'draft' });

  const [expandedTournamentId, setExpandedTournamentId] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [tournamentPlayerIds, setTournamentPlayerIds] = useState(new Set());
  const [poolLoading, setPoolLoading] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [addPlayerSearch, setAddPlayerSearch] = useState('');
  const [addPlayerSelected, setAddPlayerSelected] = useState(new Set());
  const [eventPlayerIds, setEventPlayerIds] = useState(new Set());
  const [expandedPoolFolders, setExpandedPoolFolders] = useState(new Set());
  const [removeMode, setRemoveMode] = useState(false);
  const [removeSelected, setRemoveSelected] = useState(new Set());
  const [poolSearch, setPoolSearch] = useState('');
  const [courts, setCourts] = useState([]);
  const [newCourtName, setNewCourtName] = useState('');

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try { setLoading(true); const data = await TournamentService.getAll(); setTournaments(data); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const resetForm = () => { setForm({ name: '', venue: '', start_date: '', end_date: '', status: 'draft' }); setEditingId(null); setShowForm(false); };
  const handleEdit = (t) => { setForm({ name: t.name, venue: t.venue || '', start_date: t.start_date || '', end_date: t.end_date || '', status: t.status }); setEditingId(t.id); setShowForm(true); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (form.start_date && form.end_date && form.start_date > form.end_date) { setError('Start date after end date.'); return; }
    try {
      if (editingId) await TournamentService.update(editingId, form);
      else await TournamentService.create(form);
      resetForm(); await loadTournaments();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this tournament?')) return;
    try { await TournamentService.delete(id); await loadTournaments(); } catch (err) { setError(err.message); }
  };

  // ── Player Pool ──
  const toggleExpand = async (tid) => {
    if (expandedTournamentId === tid) { setExpandedTournamentId(null); return; }
    setExpandedTournamentId(tid); setShowAddPlayers(false); setAddPlayerSelected(new Set());
    await loadPool(tid);
  };

  const loadPool = async (tid) => {
    setPoolLoading(true);
    try {
      const [{ data: p }, { data: f }, { data: tp }, { data: c }] = await Promise.all([
        supabase.from('players').select('*').order('name'),
        supabase.from('player_folders').select('*').order('sort_order').order('name'),
        supabase.from('tournament_players').select('player_id').eq('tournament_id', tid),
        supabase.from('courts').select('*').eq('tournament_id', tid).order('id'),
      ]);
      setAllPlayers(p || []); setAllFolders(f || []);
      setTournamentPlayerIds(new Set((tp || []).map(r => r.player_id)));
      setCourts(c || []);

      const events = await TournamentService.getEvents(tid);
      const inEvents = new Set();
      for (const evt of events) {
        const { data: regs } = await supabase.from('player_registrations').select('player_id, partner_id').eq('event_id', evt.id);
        (regs || []).forEach(r => { if (r.player_id) inEvents.add(r.player_id); if (r.partner_id) inEvents.add(r.partner_id); });
      }
      setEventPlayerIds(inEvents);
    } catch (err) { setError(err.message); }
    finally { setPoolLoading(false); }
  };

  const handleAddPlayersToPool = async () => {
    if (addPlayerSelected.size === 0) return;
    try {
      const rows = [...addPlayerSelected].map(pid => ({ tournament_id: expandedTournamentId, player_id: pid }));
      const { error: err } = await supabase.from('tournament_players').insert(rows);
      if (err) throw err;
      setAddPlayerSelected(new Set()); setShowAddPlayers(false); setAddPlayerSearch('');
      await loadPool(expandedTournamentId);
    } catch (err) { setError(err.message); }
  };

  const handleRemoveFromPool = async (pid) => {
    if (eventPlayerIds.has(pid)) { alert('Player is in events — can\'t remove.'); return; }
    try { await supabase.from('tournament_players').delete().eq('tournament_id', expandedTournamentId).eq('player_id', pid); await loadPool(expandedTournamentId); }
    catch (err) { setError(err.message); }
  };

  const handleBulkRemoveFromPool = async () => {
    const ids = [...removeSelected].filter(id => !eventPlayerIds.has(id));
    const blocked = removeSelected.size - ids.length;
    if (ids.length === 0) { alert('All selected are in events.'); return; }
    let msg = `Remove ${ids.length} player(s) from pool?`;
    if (blocked > 0) msg += `\n\n${blocked} in events will be skipped.`;
    if (!window.confirm(msg)) return;
    try {
      const { error: err } = await supabase.from('tournament_players').delete().eq('tournament_id', expandedTournamentId).in('player_id', ids);
      if (err) throw err;
      setRemoveSelected(new Set()); setRemoveMode(false); await loadPool(expandedTournamentId);
    } catch (err) { setError(err.message); }
  };

  // Available players grouped by folder
  const availableForPool = useMemo(() =>
    allPlayers.filter(p => !tournamentPlayerIds.has(p.id)).filter(p => !addPlayerSearch || p.name.toLowerCase().includes(addPlayerSearch.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [allPlayers, tournamentPlayerIds, addPlayerSearch]);

  const availableByFolder = useMemo(() => {
    const map = new Map();
    map.set(null, []);
    allFolders.forEach(f => map.set(f.id, []));
    availableForPool.forEach(p => {
      const fid = p.folder_id || null;
      if (!map.has(fid)) map.get(null).push(p);
      else map.get(fid).push(p);
    });
    return map;
  }, [availableForPool, allFolders]);

  // Flat ordered list for shift-select (expanded folders + unfiled)
  const orderedAvailable = useMemo(() => {
    const result = [];
    allFolders.forEach(f => {
      if (expandedPoolFolders.has(f.id)) (availableByFolder.get(f.id) || []).forEach(p => result.push(p));
    });
    (availableByFolder.get(null) || []).forEach(p => result.push(p));
    return result;
  }, [allFolders, availableByFolder, expandedPoolFolders]);

  // Map player ID → flat index for O(1) lookups
  const poolIndexMap = useMemo(() => {
    const m = new Map();
    orderedAvailable.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [orderedAvailable]);

  const poolPlayers = useMemo(() =>
    allPlayers.filter(p => tournamentPlayerIds.has(p.id))
      .filter(p => !poolSearch || p.name.toLowerCase().includes(poolSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allPlayers, tournamentPlayerIds, poolSearch]);

  const getPoolKey = useCallback((p) => p.id, []);
  const { handleClick: handlePoolClick } = useShiftSelect(setAddPlayerSelected, orderedAvailable, getPoolKey);

  const getRemoveKey = useCallback((p) => p.id, []);
  const isRemoveDisabled = useCallback((p) => eventPlayerIds.has(p.id), [eventPlayerIds]);
  const { handleClick: handleRemoveClick } = useShiftSelect(setRemoveSelected, poolPlayers, getRemoveKey, isRemoveDisabled);

  const togglePoolFolder = (fid) => { setExpandedPoolFolders(prev => { const n = new Set(prev); if (n.has(fid)) n.delete(fid); else n.add(fid); return n; }); };

  // ── Court Management ──
  const handleAddCourt = async () => {
    const name = newCourtName.trim();
    if (!name) return;
    try {
      await TournamentService.addCourt(expandedTournamentId, name);
      setNewCourtName('');
      const { data: c } = await supabase.from('courts').select('*').eq('tournament_id', expandedTournamentId).order('id');
      setCourts(c || []);
    } catch (err) { setError(err.message); }
  };

  const handleRemoveCourt = async (courtId) => {
    if (!window.confirm(`Remove "${courtId}"? Matches assigned to it will be unassigned.`)) return;
    try {
      await TournamentService.removeCourt(expandedTournamentId, courtId);
      const { data: c } = await supabase.from('courts').select('*').eq('tournament_id', expandedTournamentId).order('id');
      setCourts(c || []);
    } catch (err) { setError(err.message); }
  };

  // ── Tournament Lifecycle ──
  const handleStatusTransition = async (tournamentId, newStatus) => {
    const labels = { in_progress: 'start', completed: 'complete' };
    if (!window.confirm(`Are you sure you want to ${labels[newStatus] || 'change'} this tournament?`)) return;
    try {
      await TournamentService.update(tournamentId, { status: newStatus });
      await loadTournaments();
    } catch (err) { setError(err.message); }
  };

  const statusColor = (s) => ({ draft: '#888', registration: '#5b9bd5', in_progress: '#4ecb71', completed: '#d4a843' }[s] || '#888');

  if (loading) return <div className="admin-loading">Loading tournaments...</div>;

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Tournaments</h2>
        <button className="admin-btn primary" onClick={() => { resetForm(); setShowForm(true); }}>+ New Tournament</button>
      </div>
      {error && <div className="admin-error">{error}</div>}

      {showForm && (
        <div className="admin-form-card">
          <h3>{editingId ? 'Edit Tournament' : 'New Tournament'}</h3>
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Name</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="admin-field"><label>Venue</label><input type="text" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} /></div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Start</label><input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
              <div className="admin-field"><label>End</label><input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
              <div className="admin-field"><label>Status</label><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="in_progress">In Progress</option><option value="completed">Completed</option></select></div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingId ? 'Save' : 'Create'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {tournaments.length === 0 && !showForm ? <div className="admin-empty"><p>No tournaments yet.</p></div> : (
        <div className="admin-list">
          {tournaments.map(t => (
            <div key={t.id}>
              <div className="admin-list-item">
                <div className="admin-list-main" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(t.id)}>
                  <div className="admin-list-title">{expandedTournamentId === t.id ? '▾' : '▸'} {t.name}</div>
                  <div className="admin-list-meta">{t.venue && <span>{t.venue}</span>}{t.start_date && <span>{t.start_date}</span>}</div>
                </div>
                <div className="admin-list-right">
                  <span className="admin-status-badge" style={{ color: statusColor(t.status), borderColor: statusColor(t.status) }}>{t.status.replace('_', ' ')}</span>
                  {t.status === 'draft' && (
                    <button className="admin-btn small" style={{ color: '#4ecb71', borderColor: '#4ecb71' }} onClick={() => handleStatusTransition(t.id, 'in_progress')}>▶ Start</button>
                  )}
                  {t.status === 'in_progress' && (
                    <button className="admin-btn small" style={{ color: '#d4a843', borderColor: '#d4a843' }} onClick={() => handleStatusTransition(t.id, 'completed')}>✓ Complete</button>
                  )}
                  <button className="admin-btn small" onClick={() => handleEdit(t)}>Edit</button>
                  <button className="admin-btn small danger" onClick={() => handleDelete(t.id)}>Delete</button>
                </div>
              </div>

              {expandedTournamentId === t.id && (
                <div className="tournament-pool">
                  {poolLoading ? <div className="admin-loading">Loading...</div> : (
                    <>
                      {/* Court Configuration */}
                      <div style={{ marginBottom: 16, padding: '12px 14px', background: '#14141f', borderRadius: 8, border: '1px solid #1e1e2e' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>🏟️ Courts ({courts.length})</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {courts.map(c => (
                            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, fontSize: 12, color: '#ddd' }}>
                              {c.id}
                              <button onClick={() => handleRemoveCourt(c.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} title="Remove court">✕</button>
                            </span>
                          ))}
                          {courts.length === 0 && <span style={{ fontSize: 12, color: '#555' }}>No courts configured</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input type="text" value={newCourtName} onChange={e => setNewCourtName(e.target.value)}
                            placeholder="e.g. Court 3" onKeyDown={e => e.key === 'Enter' && handleAddCourt()}
                            style={{ flex: 1, padding: '5px 10px', background: '#0d0d14', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ddd', fontSize: 12 }} />
                          <button className="admin-btn primary" onClick={handleAddCourt} disabled={!newCourtName.trim()} style={{ fontSize: 11, padding: '5px 10px' }}>+ Add</button>
                        </div>
                      </div>

                      <div className="pool-header">
                        <span className="pool-count">{poolPlayers.length} player{poolPlayers.length !== 1 ? 's' : ''}</span>
                        <button className="admin-btn primary" onClick={() => { setShowAddPlayers(!showAddPlayers); if (!showAddPlayers) { const all = new Set(); allFolders.forEach(f => all.add(f.id)); setExpandedPoolFolders(all); } }} style={{ fontSize: 12, padding: '5px 12px' }}>
                          {showAddPlayers ? 'Done' : '+ Add Players'}
                        </button>
                      </div>

                      {showAddPlayers && (
                        <div className="pool-add-section">
                          <input type="text" placeholder="Search..." value={addPlayerSearch} onChange={e => setAddPlayerSearch(e.target.value)} className="pool-search-input" />
                          <p style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>
                            Hold Shift to select a range
                            {availableForPool.length > 0 && <> · <span style={{ cursor: 'pointer', color: '#d4a843' }} onClick={() => {
                              const allIds = availableForPool.map(p => p.id);
                              setAddPlayerSelected(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
                            }}>{addPlayerSelected.size === availableForPool.length ? 'Deselect All' : 'Select All'}</span></>}
                          </p>

                          {/* Folder groups */}
                          {allFolders.map(folder => {
                            const fPlayers = availableByFolder.get(folder.id) || [];
                            if (fPlayers.length === 0) return null;
                            const expanded = expandedPoolFolders.has(folder.id);
                            return (
                              <div key={folder.id} style={{ marginBottom: 4 }}>
                                <div className="player-folder-header" onClick={() => togglePoolFolder(folder.id)} style={{ padding: '6px 10px', fontSize: 13 }}>
                                  <span>{expanded ? '▾' : '▸'} 📁 {folder.name}</span>
                                  <span className="player-folder-count">{fPlayers.length}</span>
                                </div>
                                {expanded && (
                                  <div className="pool-checklist" style={{ borderLeft: '2px solid #2a2a3a', marginLeft: 8, paddingLeft: 4 }}>
                                    {fPlayers.map(p => {
                                      const age = getPlayerAge(p);
                                      const flatIdx = poolIndexMap.get(p.id);
                                      return (
                                        <label key={p.id} className={`pool-check-item ${addPlayerSelected.has(p.id) ? 'selected' : ''}`}
                                          onClick={(e) => { e.preventDefault(); handlePoolClick(e, flatIdx); }}>
                                          <input type="checkbox" checked={addPlayerSelected.has(p.id)} readOnly />
                                          <span className="pool-check-name">{p.name}</span>
                                          <span className="pool-check-meta">{p.gender === 'female' ? 'F' : 'M'}{age != null && ` · ${age}y`}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Unfiled */}
                          {(availableByFolder.get(null) || []).length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              {allFolders.length > 0 && <div style={{ fontSize: 12, color: '#666', padding: '4px 8px' }}>📄 Unfiled</div>}
                              <div className="pool-checklist">
                                {(availableByFolder.get(null) || []).map(p => {
                                  const age = getPlayerAge(p);
                                  const flatIdx = poolIndexMap.get(p.id);
                                  return (
                                    <label key={p.id} className={`pool-check-item ${addPlayerSelected.has(p.id) ? 'selected' : ''}`}
                                      onClick={(e) => { e.preventDefault(); handlePoolClick(e, flatIdx); }}>
                                      <input type="checkbox" checked={addPlayerSelected.has(p.id)} readOnly />
                                      <span className="pool-check-name">{p.name}</span>
                                      <span className="pool-check-meta">{p.gender === 'female' ? 'F' : 'M'}{age != null && ` · ${age}y`}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {availableForPool.length === 0 && <p style={{ color: '#555', fontSize: 13, padding: 10 }}>{addPlayerSearch ? 'No match.' : 'All players added.'}</p>}
                          {addPlayerSelected.size > 0 && (
                            <button className="admin-btn primary" onClick={handleAddPlayersToPool} style={{ marginTop: 8 }}>
                              Add {addPlayerSelected.size} Player{addPlayerSelected.size !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                      )}

                      {poolPlayers.length > 0 || poolSearch ? (
                        <div className="pool-list">
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                            <input type="text" placeholder="Search pool..." value={poolSearch} onChange={e => setPoolSearch(e.target.value)}
                              className="pool-search-input" style={{ flex: 1, minWidth: 120 }} />
                            {!removeMode
                              ? <button className="admin-btn secondary" onClick={() => { setRemoveMode(true); setRemoveSelected(new Set()); }} style={{ fontSize: 11, padding: '4px 10px' }}>☑ Remove</button>
                              : <>
                                  <button className="admin-btn danger" onClick={handleBulkRemoveFromPool} disabled={removeSelected.size === 0} style={{ fontSize: 11, padding: '4px 10px' }}>
                                    Remove {removeSelected.size}
                                  </button>
                                  <button className="admin-btn secondary" onClick={() => { setRemoveMode(false); setRemoveSelected(new Set()); }} style={{ fontSize: 11, padding: '4px 10px' }}>Done</button>
                                </>}
                          </div>
                          {removeMode && <p style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>Hold Shift to select range · 📋 = in events (can't remove)</p>}
                          {poolPlayers.map((p, idx) => {
                            const age = getPlayerAge(p);
                            const folder = allFolders.find(f => f.id === p.folder_id);
                            return (
                              <div key={p.id} className="pool-player-item">
                                {removeMode && (
                                  eventPlayerIds.has(p.id) ? <span className="pool-in-event" title="In events" style={{ marginRight: 6 }}>📋</span>
                                  : <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginRight: 6 }}
                                      onClick={(e) => { e.preventDefault(); handleRemoveClick(e, idx); }}>
                                      <input type="checkbox" checked={removeSelected.has(p.id)} readOnly />
                                    </label>
                                )}
                                <span className="pool-player-name">{p.name}</span>
                                <span className="pool-player-meta">
                                  {p.gender === 'female' ? 'F' : 'M'}{age != null && ` · ${age}y`}
                                  {folder && <span style={{ color: '#555', marginLeft: 4 }}>· 📁 {folder.name}</span>}
                                </span>
                                {!removeMode && (
                                  eventPlayerIds.has(p.id) ? <span className="pool-in-event" title="In events">📋</span>
                                  : <button className="admin-btn small danger" onClick={() => handleRemoveFromPool(p.id)} style={{ padding: '2px 6px', fontSize: 11 }}>✕</button>
                                )}
                              </div>
                            );
                          })}
                          {poolPlayers.length === 0 && poolSearch && <p style={{ color: '#555', fontSize: 13, padding: 8 }}>No match.</p>}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}