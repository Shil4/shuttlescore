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

  // Player pool
  const [expandedTournamentId, setExpandedTournamentId] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [tournamentPlayerIds, setTournamentPlayerIds] = useState(new Set());
  const [poolLoading, setPoolLoading] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [addPlayerSearch, setAddPlayerSearch] = useState('');
  const [addPlayerSelected, setAddPlayerSelected] = useState(new Set());
  const [eventPlayerIds, setEventPlayerIds] = useState(new Set()); // players in events (can't remove)

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try {
      setLoading(true);
      const data = await TournamentService.getAll();
      setTournaments(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const resetForm = () => { setForm({ name: '', venue: '', start_date: '', end_date: '', status: 'draft' }); setEditingId(null); setShowForm(false); };

  const handleEdit = (t) => {
    setForm({ name: t.name, venue: t.venue || '', start_date: t.start_date || '', end_date: t.end_date || '', status: t.status });
    setEditingId(t.id); setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (form.start_date && form.end_date && form.start_date > form.end_date) { setError('Start date cannot be after end date.'); return; }
    try {
      if (editingId) await TournamentService.update(editingId, form);
      else await TournamentService.create(form);
      resetForm(); await loadTournaments();
    } catch (err) { setError('Failed to save: ' + err.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this tournament? This cannot be undone.')) return;
    try { await TournamentService.delete(id); await loadTournaments(); }
    catch (err) { setError(err.message); }
  };

  // ── Player Pool ──

  const toggleExpand = async (tournamentId) => {
    if (expandedTournamentId === tournamentId) { setExpandedTournamentId(null); return; }
    setExpandedTournamentId(tournamentId);
    setShowAddPlayers(false);
    setAddPlayerSelected(new Set());
    await loadPool(tournamentId);
  };

  const loadPool = async (tournamentId) => {
    setPoolLoading(true);
    try {
      // Load all players if not loaded
      if (allPlayers.length === 0) {
        const { data } = await supabase.from('players').select('*').order('name');
        setAllPlayers(data || []);
      }
      // Load tournament players
      const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', tournamentId);
      setTournamentPlayerIds(new Set((tp || []).map(r => r.player_id)));

      // Load players who are in events (can't be removed)
      const events = await TournamentService.getEvents(tournamentId);
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
      const rows = Array.from(addPlayerSelected).map(pid => ({
        tournament_id: expandedTournamentId,
        player_id: pid,
      }));
      const { error: err } = await supabase.from('tournament_players').insert(rows);
      if (err) throw err;
      setAddPlayerSelected(new Set());
      setShowAddPlayers(false);
      setAddPlayerSearch('');
      await loadPool(expandedTournamentId);
    } catch (err) { setError('Failed to add players: ' + err.message); }
  };

  const handleRemoveFromPool = async (playerId) => {
    if (eventPlayerIds.has(playerId)) {
      alert('This player is registered in events and cannot be removed from the tournament pool.');
      return;
    }
    try {
      await supabase.from('tournament_players').delete().eq('tournament_id', expandedTournamentId).eq('player_id', playerId);
      await loadPool(expandedTournamentId);
    } catch (err) { setError('Failed to remove: ' + err.message); }
  };

  const toggleAddPlayer = (id) => {
    setAddPlayerSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // Players not yet in the tournament pool
  const availableForPool = useMemo(() =>
    allPlayers
      .filter(p => !tournamentPlayerIds.has(p.id))
      .filter(p => !addPlayerSearch || p.name.toLowerCase().includes(addPlayerSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allPlayers, tournamentPlayerIds, addPlayerSearch]);

  // Players in the pool
  const poolPlayers = useMemo(() =>
    allPlayers.filter(p => tournamentPlayerIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [allPlayers, tournamentPlayerIds]);

  const statusColor = (s) => ({ draft: '#888', in_progress: '#4ecb71', completed: '#d4a843' }[s] || '#888');

  // Shift-select for adding players to pool
  const getPoolKey = useCallback((p) => p.id, []);
  const { handleClick: handlePoolClick } = useShiftSelect(addPlayerSelected, setAddPlayerSelected, availableForPool, getPoolKey);

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
              <div className="admin-field"><label>Tournament Name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Shuttle Masters 2026" required />
              </div>
              <div className="admin-field"><label>Venue</label>
                <input type="text" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} placeholder="e.g. KV Gymnasium, Kochi" />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Start Date</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="admin-field"><label>End Date</label>
                <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              </div>
              <div className="admin-field"><label>Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="draft">Draft</option><option value="in_progress">In Progress</option><option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingId ? 'Save Changes' : 'Create Tournament'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {tournaments.length === 0 && !showForm ? (
        <div className="admin-empty"><p>No tournaments yet. Create your first one!</p></div>
      ) : (
        <div className="admin-list">
          {tournaments.map(t => (
            <div key={t.id}>
              <div className="admin-list-item">
                <div className="admin-list-main" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(t.id)}>
                  <div className="admin-list-title">
                    {expandedTournamentId === t.id ? '▾' : '▸'} {t.name}
                  </div>
                  <div className="admin-list-meta">
                    {t.venue && <span>{t.venue}</span>}
                    {t.start_date && <span>{t.start_date}{t.end_date && t.end_date !== t.start_date ? ` → ${t.end_date}` : ''}</span>}
                  </div>
                </div>
                <div className="admin-list-right">
                  <span className="admin-status-badge" style={{ color: statusColor(t.status), borderColor: statusColor(t.status) }}>
                    {t.status.replace('_', ' ')}
                  </span>
                  <button className="admin-btn small" onClick={() => handleEdit(t)}>Edit</button>
                  <button className="admin-btn small danger" onClick={() => handleDelete(t.id)}>Delete</button>
                </div>
              </div>

              {/* Expanded: Player Pool */}
              {expandedTournamentId === t.id && (
                <div className="tournament-pool">
                  {poolLoading ? <div className="admin-loading">Loading players...</div> : (
                    <>
                      <div className="pool-header">
                        <span className="pool-count">{poolPlayers.length} player{poolPlayers.length !== 1 ? 's' : ''} in tournament</span>
                        <button className="admin-btn primary" onClick={() => setShowAddPlayers(!showAddPlayers)} style={{ fontSize: 12, padding: '5px 12px' }}>
                          {showAddPlayers ? 'Done' : '+ Add Players'}
                        </button>
                      </div>

                      {/* Add players multi-select */}
                      {showAddPlayers && (
                        <div className="pool-add-section">
                          <input type="text" placeholder="Search players to add..." value={addPlayerSearch}
                            onChange={e => setAddPlayerSearch(e.target.value)} className="pool-search-input" />
                          <div className="pool-checklist">
                            {availableForPool.map((p, idx) => {
                              const age = getPlayerAge(p);
                              return (
                                <label key={p.id} className={`pool-check-item ${addPlayerSelected.has(p.id) ? 'selected' : ''}`}
                                  onClick={(e) => { e.preventDefault(); handlePoolClick(e, idx); }}>
                                  <input type="checkbox" checked={addPlayerSelected.has(p.id)} onChange={() => {}} />
                                  <span className="pool-check-name">{p.name}</span>
                                  <span className="pool-check-meta">
                                    {p.gender === 'female' ? 'F' : 'M'}
                                    {age != null && ` · ${age}y`}
                                  </span>
                                </label>
                              );
                            })}
                            {availableForPool.length === 0 && (
                              <p style={{ color: '#555', fontSize: 13, padding: 10 }}>
                                {addPlayerSearch ? 'No matching players.' : 'All players already in tournament.'}
                              </p>
                            )}
                          </div>
                          {addPlayerSelected.size > 0 && (
                            <button className="admin-btn primary" onClick={handleAddPlayersToPool} style={{ marginTop: 8 }}>
                              Add {addPlayerSelected.size} Player{addPlayerSelected.size !== 1 ? 's' : ''} to Tournament
                            </button>
                          )}
                        </div>
                      )}

                      {/* Current pool list */}
                      {poolPlayers.length > 0 && (
                        <div className="pool-list">
                          {poolPlayers.map(p => {
                            const age = getPlayerAge(p);
                            const inEvent = eventPlayerIds.has(p.id);
                            return (
                              <div key={p.id} className="pool-player-item">
                                <span className="pool-player-name">{p.name}</span>
                                <span className="pool-player-meta">
                                  {p.gender === 'female' ? 'F' : 'M'}
                                  {age != null && ` · ${age}y`}
                                </span>
                                {inEvent ? (
                                  <span className="pool-in-event" title="In events — can't remove">📋</span>
                                ) : (
                                  <button className="admin-btn small danger" onClick={() => handleRemoveFromPool(p.id)}
                                    style={{ padding: '2px 6px', fontSize: 11 }}>✕</button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
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