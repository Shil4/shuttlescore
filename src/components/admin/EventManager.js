import { useState, useEffect, useMemo, useCallback } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { supabase } from '../../lib/supabase';
import { getPlayerAge } from './PlayerManager';
import { useShiftSelect } from '../../hooks/useShiftSelect';
import './AdminComponents.css';

export default function EventManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Event form
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState({ name: '', category: 'adult', type: 'singles', format: 'elimination', group_size: 4, advancement_count: 2 });

  // Registration
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [poolPlayers, setPoolPlayers] = useState([]); // tournament pool players only
  const [showRegForm, setShowRegForm] = useState(false);
  const [regSelected, setRegSelected] = useState(new Set()); // multi-select
  const [playerSearch, setPlayerSearch] = useState('');

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try {
      const data = await TournamentService.getAll();
      setTournaments(data); setLoading(false);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    setExpandedEventId(null);
    await loadEvents(tournament.id);
    await loadPoolPlayers(tournament.id);
  };

  const loadEvents = async (tournamentId) => {
    try {
      setLoading(true);
      const data = await TournamentService.getEvents(tournamentId);
      setEvents(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const loadPoolPlayers = async (tournamentId) => {
    // Get player IDs in this tournament's pool
    const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', tournamentId);
    const playerIds = (tp || []).map(r => r.player_id);
    if (playerIds.length === 0) { setPoolPlayers([]); return; }
    const { data: players } = await supabase.from('players').select('*').in('id', playerIds).order('name');
    setPoolPlayers(players || []);
  };

  // ── Event CRUD ──
  const resetEventForm = () => { setEventForm({ name: '', category: 'adult', type: 'singles', format: 'elimination', group_size: 4, advancement_count: 2 }); setEditingEventId(null); setShowEventForm(false); };

  const handleEditEvent = (event) => {
    setEventForm({ name: event.name, category: event.category, type: event.type, format: event.format, group_size: event.group_size, advancement_count: event.advancement_count });
    setEditingEventId(event.id); setShowEventForm(true);
  };

  const handleSubmitEvent = async (e) => {
    e.preventDefault(); setError('');
    try {
      if (editingEventId) await TournamentService.updateEvent(editingEventId, eventForm);
      else await TournamentService.createEvent(selectedTournament.id, eventForm);
      resetEventForm(); await loadEvents(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Delete this event and all its registrations, draws, and matches?')) return;
    try { await TournamentService.deleteEvent(id); await loadEvents(selectedTournament.id); }
    catch (err) { setError(err.message); }
  };

  // ── Registration ──
  const toggleEventExpand = async (eventId) => {
    if (expandedEventId === eventId) { setExpandedEventId(null); return; }
    setExpandedEventId(eventId);
    setShowRegForm(false);
    setRegSelected(new Set());
    setPlayerSearch('');
    await loadRegistrations(eventId);
  };

  const loadRegistrations = async (eventId) => {
    try {
      const { data, error: err } = await supabase
        .from('player_registrations')
        .select('id, player_id, partner_id, event_id')
        .eq('event_id', eventId);
      if (err) throw err;
      setRegistrations(data || []);
    } catch (err) { setError(err.message); }
  };

  // Registered player IDs (both player and partner)
  const registeredPlayerIds = useMemo(() => {
    const ids = new Set();
    registrations.forEach(r => { if (r.player_id) ids.add(r.player_id); if (r.partner_id) ids.add(r.partner_id); });
    return ids;
  }, [registrations]);

  // Available for registration (in tournament pool, not yet registered)
  const availableForReg = useMemo(() =>
    poolPlayers
      .filter(p => !registeredPlayerIds.has(p.id))
      .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [poolPlayers, registeredPlayerIds, playerSearch]);

  const toggleRegPlayer = (id) => {
    setRegSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const handleRegisterMultiple = async () => {
    if (regSelected.size === 0) return;
    setError('');
    try {
      const rows = [...regSelected].map(playerId => ({
        player_id: playerId,
        event_id: expandedEventId,
        partner_id: null,
      }));
      const { error: err } = await supabase.from('player_registrations').insert(rows);
      if (err) throw err;
      setRegSelected(new Set());
      setShowRegForm(false);
      setPlayerSearch('');
      await loadRegistrations(expandedEventId);
    } catch (err) { setError('Registration failed: ' + err.message); }
  };

  const handleUnregister = async (registrationId) => {
    try {
      await TournamentService.unregisterPlayer(registrationId);
      await loadRegistrations(expandedEventId);
    } catch (err) { setError(err.message); }
  };

  // ── Helpers ──
  const typeLabel = (t) => ({ singles: 'Singles', doubles: 'Doubles', mixed_doubles: 'Mixed Doubles' }[t] || t);
  const formatLabel = (f) => ({ round_robin: 'Round Robin', elimination: 'Elimination', group_to_knockout: 'Group → Knockout' }[f] || f);
  const categoryLabel = (c) => ({ u8: 'U-8', u12: 'U-12', u18: 'U-18', adult: 'Adult', senior: 'Senior' }[c] || c);

  const playerName = (id) => {
    const p = poolPlayers.find(pl => pl.id === id);
    return p?.name || id?.substring(0, 8) || '?';
  };

  const playerAge = (id) => {
    const p = poolPlayers.find(pl => pl.id === id);
    return p ? getPlayerAge(p) : null;
  };

  // Shift-select for event registration
  const getRegKey = useCallback((p) => p.id, []);
  const { handleClick: handleRegClick } = useShiftSelect(regSelected, setRegSelected, availableForReg, getRegKey);

  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;

  if (!selectedTournament) {
    return (
      <div className="admin-section">
        <div className="admin-section-header"><h2>Events</h2></div>
        <p style={{ color: '#888', marginBottom: 16 }}>Select a tournament to manage its events:</p>
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
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <button className="admin-btn secondary" onClick={() => setSelectedTournament(null)} style={{ marginBottom: 8 }}>← Back</button>
          <h2>{selectedTournament.name} — Events</h2>
        </div>
        <button className="admin-btn primary" onClick={() => { resetEventForm(); setShowEventForm(true); }}>+ New Event</button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {poolPlayers.length === 0 && (
        <div className="admin-error" style={{ background: '#2a2215', borderColor: '#5a4a2a', color: '#d4a843' }}>
          No players in this tournament's pool yet. Add players in the Tournaments tab first.
        </div>
      )}

      {showEventForm && (
        <div className="admin-form-card">
          <h3>{editingEventId ? 'Edit Event' : 'New Event'}</h3>
          <form onSubmit={handleSubmitEvent} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Event Name</label>
                <input type="text" value={eventForm.name} onChange={e => setEventForm({ ...eventForm, name: e.target.value })} placeholder="e.g. Men's Singles" required />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Category</label>
                <select value={eventForm.category} onChange={e => setEventForm({ ...eventForm, category: e.target.value })}>
                  <option value="u8">U-8</option><option value="u12">U-12</option><option value="u18">U-18</option>
                  <option value="adult">Adult</option><option value="senior">Senior (45+)</option>
                </select>
              </div>
              <div className="admin-field"><label>Type</label>
                <select value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value })}>
                  <option value="singles">Singles</option><option value="doubles">Doubles</option><option value="mixed_doubles">Mixed Doubles</option>
                </select>
              </div>
              <div className="admin-field"><label>Format</label>
                <select value={eventForm.format} onChange={e => setEventForm({ ...eventForm, format: e.target.value })}>
                  <option value="elimination">Elimination</option><option value="round_robin">Round Robin</option><option value="group_to_knockout">Group → Knockout</option>
                </select>
              </div>
            </div>
            {(eventForm.format === 'round_robin' || eventForm.format === 'group_to_knockout') && (
              <div className="admin-form-row">
                <div className="admin-field"><label>Group Size</label>
                  <input type="number" min="3" max="8" value={eventForm.group_size} onChange={e => setEventForm({ ...eventForm, group_size: parseInt(e.target.value) || 4 })} />
                </div>
                {eventForm.format === 'group_to_knockout' && (
                  <div className="admin-field"><label>Advance per Group</label>
                    <input type="number" min="1" max="4" value={eventForm.advancement_count} onChange={e => setEventForm({ ...eventForm, advancement_count: parseInt(e.target.value) || 2 })} />
                  </div>
                )}
              </div>
            )}
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingEventId ? 'Save Changes' : 'Create Event'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetEventForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? <div className="admin-loading">Loading events...</div> : events.length === 0 && !showEventForm ? (
        <div className="admin-empty"><p>No events yet.</p></div>
      ) : (
        <div className="admin-list">
          {events.map(ev => (
            <div key={ev.id}>
              <div className="admin-list-item">
                <div className="admin-list-main" style={{ cursor: 'pointer' }} onClick={() => toggleEventExpand(ev.id)}>
                  <div className="admin-list-title">{expandedEventId === ev.id ? '▾' : '▸'} {ev.name}</div>
                  <div className="admin-list-meta">
                    <span className="admin-category-badge">{categoryLabel(ev.category)}</span>
                    <span>{typeLabel(ev.type)}</span>
                    <span>{formatLabel(ev.format)}</span>
                  </div>
                </div>
                <div className="admin-list-right">
                  <button className="admin-btn small" onClick={() => handleEditEvent(ev)}>Edit</button>
                  <button className="admin-btn small danger" onClick={() => handleDeleteEvent(ev.id)}>Delete</button>
                </div>
              </div>

              {expandedEventId === ev.id && (
                <div className="event-registrations">
                  <div className="event-reg-header">
                    <span className="event-reg-count">{registrations.length} player{registrations.length !== 1 ? 's' : ''} registered</span>
                    <button className="admin-btn primary" onClick={() => setShowRegForm(!showRegForm)} style={{ fontSize: 12, padding: '5px 12px' }}>
                      {showRegForm ? 'Done' : '+ Register Players'}
                    </button>
                  </div>

                  {/* Multi-select registration */}
                  {showRegForm && (
                    <div className="pool-add-section">
                      <input type="text" placeholder="Search players..." value={playerSearch}
                        onChange={e => setPlayerSearch(e.target.value)} className="pool-search-input" />
                      
                      {availableForReg.length === 0 ? (
                        <p style={{ color: '#555', fontSize: 13, padding: 10 }}>
                          {poolPlayers.length === 0 ? 'No players in tournament pool. Add them in the Tournaments tab.' :
                            playerSearch ? 'No matching players.' : 'All pool players are already registered.'}
                        </p>
                      ) : (
                        <div className="pool-checklist">
                          {availableForReg.map((p, idx) => {
                            const age = getPlayerAge(p);
                            return (
                              <label key={p.id} className={`pool-check-item ${regSelected.has(p.id) ? 'selected' : ''}`}
                                onClick={(e) => { e.preventDefault(); handleRegClick(e, idx); }}>
                                <input type="checkbox" checked={regSelected.has(p.id)} onChange={() => {}} />
                                <span className="pool-check-name">{p.name}</span>
                                <span className="pool-check-meta">
                                  {p.gender === 'female' ? 'F' : 'M'}
                                  {age != null && ` · ${age}y`}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {regSelected.size > 0 && (
                        <button className="admin-btn primary" onClick={handleRegisterMultiple} style={{ marginTop: 8 }}>
                          Register {regSelected.size} Player{regSelected.size !== 1 ? 's' : ''}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Registered list */}
                  {registrations.length > 0 && (
                    <div className="event-reg-list">
                      {registrations.map((reg, idx) => {
                        const age = playerAge(reg.player_id);
                        const partnerAge = reg.partner_id ? playerAge(reg.partner_id) : null;
                        return (
                          <div key={reg.id} className="event-reg-item">
                            <span className="event-reg-number">{idx + 1}</span>
                            <span className="event-reg-name">
                              {playerName(reg.player_id)}{age != null && <span style={{ color: '#888', fontSize: 11 }}> ({age}y)</span>}
                              {reg.partner_id && (
                                <span className="event-reg-partner">
                                  {' & '}{playerName(reg.partner_id)}{partnerAge != null && <span style={{ color: '#888', fontSize: 11 }}> ({partnerAge}y)</span>}
                                </span>
                              )}
                            </span>
                            <button className="admin-btn small danger" onClick={() => handleUnregister(reg.id)}
                              style={{ padding: '3px 8px', fontSize: 11 }}>✕</button>
                          </div>
                        );
                      })}
                    </div>
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