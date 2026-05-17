import { useState, useEffect, useMemo, useCallback } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { supabase } from '../../lib/supabase';
import { getPlayerAge } from './PlayerManager';
import { useShiftSelect } from '../../hooks/useShiftSelect';
import './AdminComponents.css';

// Sort players by age relevance to event category
function sortByAgeRelevance(players, category) {
  const getAge = (p) => getPlayerAge(p);

  const bucket = (p) => {
    const age = getAge(p);
    if (age === null) return 99; // unknown age goes last
    switch (category) {
      case 'u8':
        if (age < 8) return 0;
        if (age < 12) return 1;
        if (age < 18) return 2;
        if (age < 45) return 3;
        return 4;
      case 'u12':
        if (age >= 8 && age < 12) return 0;
        if (age < 8) return 1;
        if (age < 18) return 2;
        if (age < 45) return 3;
        return 4;
      case 'u18':
        if (age >= 12 && age < 18) return 0;
        if (age >= 8 && age < 12) return 1;
        if (age < 8) return 2;
        if (age < 45) return 3;
        return 4;
      case 'adult':
        if (age >= 18 && age < 45) return 0;
        if (age >= 45) return 1;
        if (age >= 12 && age < 18) return 2;
        if (age >= 8 && age < 12) return 3;
        return 4;
      case 'senior':
        if (age >= 45) return 0;
        if (age >= 18 && age < 45) return 1;
        if (age >= 12 && age < 18) return 2;
        if (age >= 8 && age < 12) return 3;
        return 4;
      default:
        return 0;
    }
  };

  return [...players].sort((a, b) => {
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
    return a.name.localeCompare(b.name);
  });
}

// Label for bucket separators
function bucketLabel(category, bucketIdx) {
  const labels = {
    u8: ['Under 8 (eligible)', 'U-12', 'U-18', 'Adults', 'Seniors'],
    u12: ['Ages 8–12 (eligible)', 'Under 8', 'U-18', 'Adults', 'Seniors'],
    u18: ['Ages 12–18 (eligible)', 'U-12', 'Under 8', 'Adults', 'Seniors'],
    adult: ['Adults 18–44 (eligible)', 'Seniors 45+', 'U-18', 'U-12', 'Under 8'],
    senior: ['Seniors 45+ (eligible)', 'Adults 18–44', 'U-18', 'U-12', 'Under 8'],
  };
  return (labels[category] || [])[bucketIdx] || 'Other';
}

function getBucket(player, category) {
  const age = getPlayerAge(player);
  if (age === null) return 99;
  switch (category) {
    case 'u8': return age < 8 ? 0 : age < 12 ? 1 : age < 18 ? 2 : age < 45 ? 3 : 4;
    case 'u12': return (age >= 8 && age < 12) ? 0 : age < 8 ? 1 : age < 18 ? 2 : age < 45 ? 3 : 4;
    case 'u18': return (age >= 12 && age < 18) ? 0 : (age >= 8 && age < 12) ? 1 : age < 8 ? 2 : age < 45 ? 3 : 4;
    case 'adult': return (age >= 18 && age < 45) ? 0 : age >= 45 ? 1 : (age >= 12 && age < 18) ? 2 : (age >= 8 && age < 12) ? 3 : 4;
    case 'senior': return age >= 45 ? 0 : (age >= 18 && age < 45) ? 1 : (age >= 12 && age < 18) ? 2 : (age >= 8 && age < 12) ? 3 : 4;
    default: return 0;
  }
}

export default function EventManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState({ name: '', category: 'adult', type: 'singles', format: 'elimination', group_size: 4, advancement_count: 2, gender_filter: 'mixed' });

  const [expandedEventId, setExpandedEventId] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [poolPlayers, setPoolPlayers] = useState([]);
  const [showRegForm, setShowRegForm] = useState(false);
  const [regSelected, setRegSelected] = useState(new Set());
  const [playerSearch, setPlayerSearch] = useState('');
  const [eventRegCounts, setEventRegCounts] = useState({});

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try { const data = await TournamentService.getAll(); setTournaments(data); setLoading(false); }
    catch (err) { setError(err.message); setLoading(false); }
  };

  const selectTournament = async (t) => {
    setSelectedTournament(t); setExpandedEventId(null);
    await loadEvents(t.id); await loadPoolPlayers(t.id);
  };

  const loadEvents = async (tid) => {
    try {
      setLoading(true);
      const data = await TournamentService.getEvents(tid);
      setEvents(data);
      // Load reg counts for all events
      const counts = {};
      for (const e of data) {
        const { count } = await supabase.from('player_registrations').select('*', { count: 'exact', head: true }).eq('event_id', e.id);
        counts[e.id] = count || 0;
      }
      setEventRegCounts(counts);
    }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const loadPoolPlayers = async (tid) => {
    const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', tid);
    const ids = (tp || []).map(r => r.player_id);
    if (ids.length === 0) { setPoolPlayers([]); return; }
    const { data } = await supabase.from('players').select('*').in('id', ids).order('name');
    setPoolPlayers(data || []);
  };

  // Event CRUD
  const resetEventForm = () => { setEventForm({ name: '', category: 'adult', type: 'singles', format: 'elimination', group_size: 4, advancement_count: 2, gender_filter: 'mixed' }); setEditingEventId(null); setShowEventForm(false); };
  const handleEditEvent = (ev) => { setEventForm({ name: ev.name, category: ev.category, type: ev.type, format: ev.format, group_size: ev.group_size, advancement_count: ev.advancement_count, gender_filter: ev.gender_filter || 'mixed' }); setEditingEventId(ev.id); setShowEventForm(true); };

  const handleSubmitEvent = async (e) => {
    e.preventDefault(); setError('');
    const payload = { ...eventForm };
    // Only store gender_filter for adult category
    if (payload.category !== 'adult') payload.gender_filter = 'mixed';
    try {
      if (editingEventId) await TournamentService.updateEvent(editingEventId, payload);
      else await TournamentService.createEvent(selectedTournament.id, payload);
      resetEventForm(); await loadEvents(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    try { await TournamentService.deleteEvent(id); await loadEvents(selectedTournament.id); }
    catch (err) { setError(err.message); }
  };

  // Registration
  const toggleEventExpand = async (eid) => {
    if (expandedEventId === eid) { setExpandedEventId(null); return; }
    setExpandedEventId(eid); setShowRegForm(false); setRegSelected(new Set()); setPlayerSearch('');
    await loadRegistrations(eid);
  };

  const loadRegistrations = async (eid) => {
    try {
      const { data, error: err } = await supabase.from('player_registrations').select('id, player_id, partner_id, event_id').eq('event_id', eid);
      if (err) throw err;
      setRegistrations(data || []);
      setEventRegCounts(prev => ({ ...prev, [eid]: (data || []).length }));
    }
    catch (err) { setError(err.message); }
  };

  const registeredPlayerIds = useMemo(() => {
    const ids = new Set();
    registrations.forEach(r => { if (r.player_id) ids.add(r.player_id); if (r.partner_id) ids.add(r.partner_id); });
    return ids;
  }, [registrations]);

  // Get current expanded event for sorting/filtering
  const currentEvent = useMemo(() => events.find(e => e.id === expandedEventId), [events, expandedEventId]);

  // Available for registration — sorted by age relevance, filtered by gender for adult events
  const availableForReg = useMemo(() => {
    let available = poolPlayers
      .filter(p => !registeredPlayerIds.has(p.id))
      .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()));

    if (!currentEvent) return available.sort((a, b) => a.name.localeCompare(b.name));

    // For adult category with gender filter, sort matching gender first
    if (currentEvent.category === 'adult' && currentEvent.gender_filter && currentEvent.gender_filter !== 'mixed') {
      const targetGender = currentEvent.gender_filter === 'M' ? 'male' : 'female';
      available = sortByAgeRelevance(available, currentEvent.category);
      // Within each age bucket, put matching gender first
      available.sort((a, b) => {
        const bucketA = getBucket(a, currentEvent.category);
        const bucketB = getBucket(b, currentEvent.category);
        if (bucketA !== bucketB) return bucketA - bucketB;
        const gA = a.gender === targetGender ? 0 : 1;
        const gB = b.gender === targetGender ? 0 : 1;
        if (gA !== gB) return gA - gB;
        return a.name.localeCompare(b.name);
      });
    } else {
      available = sortByAgeRelevance(available, currentEvent.category);
    }

    return available;
  }, [poolPlayers, registeredPlayerIds, playerSearch, currentEvent]);

  const handleRegisterMultiple = async () => {
    if (regSelected.size === 0) return; setError('');
    try {
      const rows = [...regSelected].map(pid => ({ player_id: pid, event_id: expandedEventId, partner_id: null }));
      const { error: err } = await supabase.from('player_registrations').insert(rows); if (err) throw err;
      setRegSelected(new Set()); setShowRegForm(false); setPlayerSearch('');
      await loadRegistrations(expandedEventId);
    } catch (err) { setError('Registration failed: ' + err.message); }
  };

  const handleBulkUnregister = async (regIds) => {
    if (!window.confirm(`Unregister ${regIds.length} player(s)?`)) return;
    try {
      const { error: err } = await supabase.from('player_registrations').delete().in('id', regIds); if (err) throw err;
      await loadRegistrations(expandedEventId);
    } catch (err) { setError(err.message); }
  };

  const handleUnregister = async (rid) => {
    try { await TournamentService.unregisterPlayer(rid); await loadRegistrations(expandedEventId); }
    catch (err) { setError(err.message); }
  };

  // Shift-select
  const getRegKey = useCallback((p) => p.id, []);
  const { handleClick: handleRegClick } = useShiftSelect(setRegSelected, availableForReg, getRegKey);

  const typeLabel = (t) => ({ singles: 'Singles', doubles: 'Doubles', mixed_doubles: 'Mixed Doubles' }[t] || t);
  const formatLabel = (f) => ({ round_robin: 'Round Robin', elimination: 'Elimination', group_to_knockout: 'Group → Knockout' }[f] || f);
  const categoryLabel = (c) => ({ u8: 'U-8', u12: 'U-12', u18: 'U-18', adult: 'Adult', senior: 'Senior' }[c] || c);
  const genderFilterLabel = (g) => ({ M: "Men's", F: "Women's", mixed: 'Mixed' }[g] || 'Mixed');
  const playerName = (id) => poolPlayers.find(p => p.id === id)?.name || '?';
  const playerAge = (id) => { const p = poolPlayers.find(pl => pl.id === id); return p ? getPlayerAge(p) : null; };

  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;

  if (!selectedTournament) {
    return (
      <div className="admin-section">
        <div className="admin-section-header"><h2>Events</h2></div>
        <p style={{ color: '#888', marginBottom: 16 }}>Select a tournament:</p>
        {tournaments.length === 0 ? <div className="admin-empty"><p>No tournaments.</p></div> : (
          <div className="admin-list">
            {tournaments.map(t => (
              <div key={t.id} className="admin-list-item" style={{ cursor: 'pointer' }} onClick={() => selectTournament(t)}>
                <div className="admin-list-main"><div className="admin-list-title">{t.name}</div><div className="admin-list-meta">{t.venue && <span>{t.venue}</span>}</div></div>
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
          No players in tournament pool. Add them in Tournaments tab first.
        </div>
      )}

      {showEventForm && (
        <div className="admin-form-card">
          <h3>{editingEventId ? 'Edit Event' : 'New Event'}</h3>
          <form onSubmit={handleSubmitEvent} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Event Name</label><input type="text" value={eventForm.name} onChange={e => setEventForm({ ...eventForm, name: e.target.value })} required /></div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Category</label>
                <select value={eventForm.category} onChange={e => setEventForm({ ...eventForm, category: e.target.value })}>
                  <option value="u8">U-8</option><option value="u12">U-12</option><option value="u18">U-18</option>
                  <option value="adult">Adult</option><option value="senior">Senior (45+)</option>
                </select>
              </div>
              {eventForm.category === 'adult' && (
                <div className="admin-field"><label>Gender</label>
                  <select value={eventForm.gender_filter} onChange={e => setEventForm({ ...eventForm, gender_filter: e.target.value })}>
                    <option value="M">Men's</option><option value="F">Women's</option><option value="mixed">Mixed</option>
                  </select>
                </div>
              )}
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
                <div className="admin-field"><label>Group Size</label><input type="number" min="3" max="8" value={eventForm.group_size} onChange={e => setEventForm({ ...eventForm, group_size: parseInt(e.target.value) || 4 })} /></div>
                {eventForm.format === 'group_to_knockout' && <div className="admin-field"><label>Advance per Group</label><input type="number" min="1" max="4" value={eventForm.advancement_count} onChange={e => setEventForm({ ...eventForm, advancement_count: parseInt(e.target.value) || 2 })} /></div>}
              </div>
            )}
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingEventId ? 'Save' : 'Create'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetEventForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? <div className="admin-loading">Loading...</div> : events.length === 0 && !showEventForm ? <div className="admin-empty"><p>No events.</p></div> : (
        <div className="admin-list">
          {events.map(ev => (
            <div key={ev.id}>
              <div className="admin-list-item">
                <div className="admin-list-main" style={{ cursor: 'pointer' }} onClick={() => toggleEventExpand(ev.id)}>
                  <div className="admin-list-title">{expandedEventId === ev.id ? '▾' : '▸'} {ev.name}</div>
                  <div className="admin-list-meta">
                    <span className="admin-category-badge">{categoryLabel(ev.category)}</span>
                    {ev.category === 'adult' && ev.gender_filter && ev.gender_filter !== 'mixed' && <span className="admin-category-badge">{genderFilterLabel(ev.gender_filter)}</span>}
                    <span>{typeLabel(ev.type)}</span><span>{formatLabel(ev.format)}</span>
                    {eventRegCounts[ev.id] > 0 && <span className="admin-category-badge" style={{ background: '#152a15', color: '#4ecb71' }}>{eventRegCounts[ev.id]} players</span>}
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
                    <span className="event-reg-count">{registrations.length} registered</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {registrations.length > 0 && (
                        <button className="admin-btn small danger" onClick={() => handleBulkUnregister(registrations.map(r => r.id))}>
                          Unregister All
                        </button>
                      )}
                      <button className="admin-btn primary" onClick={() => setShowRegForm(!showRegForm)} style={{ fontSize: 12, padding: '5px 12px' }}>
                        {showRegForm ? 'Done' : '+ Register'}
                      </button>
                    </div>
                  </div>

                  {showRegForm && (
                    <div className="pool-add-section">
                      <input type="text" placeholder="Search..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} className="pool-search-input" />
                      <p style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>
                        Sorted by age relevance for {categoryLabel(ev.category)}
                        {ev.category === 'adult' && ev.gender_filter !== 'mixed' && ` · ${genderFilterLabel(ev.gender_filter)}`}
                        {' · Hold Shift to select range'}
                        {availableForReg.length > 0 && <> · <span style={{ cursor: 'pointer', color: '#d4a843' }} onClick={() => {
                          const allIds = availableForReg.map(p => p.id);
                          setRegSelected(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
                        }}>{regSelected.size === availableForReg.length ? 'Deselect All' : 'Select All'}</span></>}
                      </p>

                      {availableForReg.length === 0 ? (
                        <p style={{ color: '#555', fontSize: 13, padding: 10 }}>{poolPlayers.length === 0 ? 'No players in pool.' : playerSearch ? 'No match.' : 'All registered.'}</p>
                      ) : (
                        <div className="pool-checklist">
                          {(() => {
                            let lastBucket = -1;
                            return availableForReg.map((p, idx) => {
                              const age = getPlayerAge(p);
                              const b = getBucket(p, ev.category);
                              const showHeader = b !== lastBucket && b !== 99;
                              lastBucket = b;
                              return (
                                <div key={p.id}>
                                  {showHeader && <div className="pool-bucket-header">{bucketLabel(ev.category, b)}</div>}
                                  <label className={`pool-check-item ${regSelected.has(p.id) ? 'selected' : ''} ${b === 0 ? 'eligible' : b > 0 && b < 99 ? 'other-age' : ''}`}
                                    onClick={(e) => { e.preventDefault(); handleRegClick(e, idx); }}>
                                    <input type="checkbox" checked={regSelected.has(p.id)} readOnly />
                                    <span className="pool-check-name">{p.name}</span>
                                    <span className="pool-check-meta">
                                      {p.gender === 'female' ? 'F' : 'M'}
                                      {age != null && ` · ${age}y`}
                                    </span>
                                  </label>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      {regSelected.size > 0 && (
                        <button className="admin-btn primary" onClick={handleRegisterMultiple} style={{ marginTop: 8 }}>
                          Register {regSelected.size}
                        </button>
                      )}
                    </div>
                  )}

                  {registrations.length > 0 && (
                    <div className="event-reg-list">
                      {registrations.map((reg, idx) => {
                        const age = playerAge(reg.player_id);
                        return (
                          <div key={reg.id} className="event-reg-item">
                            <span className="event-reg-number">{idx + 1}</span>
                            <span className="event-reg-name">
                              {playerName(reg.player_id)}{age != null && <span style={{ color: '#888', fontSize: 11 }}> ({age}y)</span>}
                              {reg.partner_id && <span className="event-reg-partner">{' & '}{playerName(reg.partner_id)}{playerAge(reg.partner_id) != null && <span style={{ color: '#888', fontSize: 11 }}> ({playerAge(reg.partner_id)}y)</span>}</span>}
                            </span>
                            <button className="admin-btn small danger" onClick={() => handleUnregister(reg.id)} style={{ padding: '3px 8px', fontSize: 11 }}>✕</button>
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