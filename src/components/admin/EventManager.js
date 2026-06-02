import { useState, useEffect, useMemo, useCallback } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { supabase } from '../../lib/supabase';
import { useShiftSelect } from '../../hooks/useShiftSelect';
import {
  isDoubles, isGenderApplicable, getGenderOptions, categoryLabel,
  getBucket, bucketLabel, sortByAgeRelevance, sortByGenderAndAge,
} from './eventCategoryHelpers';
import { getPlayerAge } from './PlayerManager';
import './AdminComponents.css';

export default function EventManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState({
    name: '', category: 'adult', type: 'singles', gender: null,
    start_date: '', end_date: '',
  });

  const [expandedEventId, setExpandedEventId] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [poolPlayers, setPoolPlayers] = useState([]);
  const [showRegForm, setShowRegForm] = useState(false);
  const [eventRegCounts, setEventRegCounts] = useState({});

  // Singles registration (bulk)
  const [regSelected, setRegSelected] = useState(new Set());
  const [playerSearch, setPlayerSearch] = useState('');

  // Doubles registration (pair-by-pair)
  const [pairPlayer1, setPairPlayer1] = useState('');
  const [pairPlayer2, setPairPlayer2] = useState('');
  const [pairSearch1, setPairSearch1] = useState('');
  const [pairSearch2, setPairSearch2] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const resetEventForm = () => {
    setEventForm({ name: '', category: 'adult', type: 'singles', gender: null, start_date: '', end_date: '' });
    setEditingEventId(null); setShowEventForm(false);
  };

  const handleEditEvent = (ev) => {
    setEventForm({
      name: ev.name,
      category: ev.category,
      type: ev.type === 'mixed_doubles' ? 'doubles' : ev.type,
      gender: ev.gender || (ev.type === 'mixed_doubles' ? 'mixed' : (ev.gender_filter === 'M' ? 'mens' : ev.gender_filter === 'F' ? 'womens' : null)),
      start_date: ev.start_date || '',
      end_date: ev.end_date || '',
    });
    setEditingEventId(ev.id); setShowEventForm(true);
  };

  const handleCategoryChange = (category) => {
    const newForm = { ...eventForm, category };
    if (!isGenderApplicable(category)) newForm.gender = null;
    setEventForm(newForm);
  };

  const handleTypeChange = (type) => {
    const newForm = { ...eventForm, type };
    if (isGenderApplicable(eventForm.category)) {
      const validOptions = getGenderOptions(type).map(o => o.value);
      if (!validOptions.includes(newForm.gender)) newForm.gender = validOptions[0] || null;
    }
    setEventForm(newForm);
  };

  const handleSubmitEvent = async (e) => {
    e.preventDefault(); setError('');
    const payload = {
      name: eventForm.name, category: eventForm.category, type: eventForm.type,
      gender: isGenderApplicable(eventForm.category) ? eventForm.gender : null,
      start_date: eventForm.start_date || null, end_date: eventForm.end_date || null,
      format: 'elimination', // default — actual format handled by stage wizard
    };
    try {
      if (editingEventId) await TournamentService.updateEvent(editingEventId, payload);
      else await TournamentService.createEvent(selectedTournament.id, payload);
      resetEventForm(); await loadEvents(selectedTournament.id);
    } catch (err) { setError(err.message); }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Delete this event and all its registrations?')) return;
    try { await TournamentService.deleteEvent(id); await loadEvents(selectedTournament.id); }
    catch (err) { setError(err.message); }
  };

  // Registration
  const toggleEventExpand = async (eid) => {
    if (expandedEventId === eid) { setExpandedEventId(null); return; }
    setExpandedEventId(eid); setShowRegForm(false); setRegSelected(new Set());
    setPlayerSearch(''); setPairPlayer1(''); setPairPlayer2('');
    setPairSearch1(''); setPairSearch2('');
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

  const currentEvent = useMemo(() => events.find(e => e.id === expandedEventId), [events, expandedEventId]);
  const currentIsDoubles = currentEvent && isDoubles(currentEvent.type);

  // Singles: available for bulk registration
  const availableForReg = useMemo(() => {
    if (!currentEvent || currentIsDoubles) return [];
    let available = poolPlayers
      .filter(p => !registeredPlayerIds.has(p.id))
      .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()));

    const targetGender = currentEvent.gender === 'mens' ? 'male' : currentEvent.gender === 'womens' ? 'female' : null;
    if (targetGender) {
      available = sortByGenderAndAge(available, currentEvent.category, targetGender);
    } else {
      available = sortByAgeRelevance(available, currentEvent.category);
    }
    return available;
  }, [poolPlayers, registeredPlayerIds, playerSearch, currentEvent, currentIsDoubles]);

  // Doubles: available players for pair selectors
  const availableForPairing = useMemo(() => {
    if (!currentEvent || !currentIsDoubles) return [];
    return poolPlayers.filter(p => !registeredPlayerIds.has(p.id));
  }, [poolPlayers, registeredPlayerIds, currentEvent, currentIsDoubles]);

  const pairList1 = useMemo(() => {
    if (!currentEvent || !currentIsDoubles) return [];
    let list = availableForPairing;
    if (pairSearch1) list = list.filter(p => p.name.toLowerCase().includes(pairSearch1.toLowerCase()));
    if (currentEvent.gender === 'mixed') {
      return sortByGenderAndAge(list, currentEvent.category, 'male');
    } else {
      const tg = currentEvent.gender === 'mens' ? 'male' : currentEvent.gender === 'womens' ? 'female' : null;
      return sortByGenderAndAge(list, currentEvent.category, tg);
    }
  }, [availableForPairing, currentEvent, currentIsDoubles, pairSearch1]);

  const pairList2 = useMemo(() => {
    if (!currentEvent || !currentIsDoubles) return [];
    let list = availableForPairing.filter(p => p.id !== pairPlayer1);
    if (pairSearch2) list = list.filter(p => p.name.toLowerCase().includes(pairSearch2.toLowerCase()));
    if (currentEvent.gender === 'mixed') {
      return sortByGenderAndAge(list, currentEvent.category, 'female');
    } else {
      const tg = currentEvent.gender === 'mens' ? 'male' : currentEvent.gender === 'womens' ? 'female' : null;
      return sortByGenderAndAge(list, currentEvent.category, tg);
    }
  }, [availableForPairing, currentEvent, currentIsDoubles, pairPlayer1, pairSearch2]);

  // Singles registration
  const handleRegisterMultiple = async () => {
    if (regSelected.size === 0) return; setError('');
    try {
      const rows = [...regSelected].map(pid => ({ player_id: pid, event_id: expandedEventId, partner_id: null }));
      const { error: err } = await supabase.from('player_registrations').insert(rows); if (err) throw err;
      setRegSelected(new Set()); setShowRegForm(false); setPlayerSearch('');
      await loadRegistrations(expandedEventId);
    } catch (err) { setError('Registration failed: ' + err.message); }
  };

  // Doubles registration
  const handleRegisterPair = async () => {
    if (!pairPlayer1 || !pairPlayer2) return; setError('');
    try {
      const { error: err } = await supabase.from('player_registrations').insert({
        player_id: pairPlayer1, partner_id: pairPlayer2, event_id: expandedEventId,
      });
      if (err) throw err;
      setPairPlayer1(''); setPairPlayer2(''); setPairSearch1(''); setPairSearch2('');
      await loadRegistrations(expandedEventId);
    } catch (err) { setError('Registration failed: ' + err.message); }
  };

  const handleBulkUnregister = async (regIds) => {
    if (!window.confirm('Unregister ' + regIds.length + (currentIsDoubles ? ' pair(s)?' : ' player(s)?'))) return;
    try {
      const { error: err } = await supabase.from('player_registrations').delete().in('id', regIds); if (err) throw err;
      await loadRegistrations(expandedEventId);
    } catch (err) { setError(err.message); }
  };

  const handleUnregister = async (rid) => {
    try { await TournamentService.unregisterPlayer(rid); await loadRegistrations(expandedEventId); }
    catch (err) { setError(err.message); }
  };

  // Shift-select (singles only)
  const getRegKey = useCallback((p) => p.id, []);
  const { handleClick: handleRegClick } = useShiftSelect(setRegSelected, availableForReg, getRegKey);

  // Label helpers
  const typeLabel = (t) => ({ singles: 'Singles', doubles: 'Doubles', mixed_doubles: 'Mixed Doubles' }[t] || t);
  const genderLabel = (g) => ({ mens: "Men's", womens: "Women's", mixed: 'Mixed' }[g] || '');
  const formatDate = (d) => { if (!d) return ''; const p = d.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; };
  const playerName = (id) => poolPlayers.find(p => p.id === id)?.name || '?';
  const playerAge = (id) => { const p = poolPlayers.find(pl => pl.id === id); return p ? getPlayerAge(p) : null; };
  const playerGenderTag = (id) => { const p = poolPlayers.find(pl => pl.id === id); return p?.gender === 'female' ? 'F' : 'M'; };

  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;

  // Tournament selector
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
                <span style={{ color: '#d4a843', fontSize: 18 }}>&#8594;</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Main render
  const genderApplicable = isGenderApplicable(eventForm.category);
  const genderOptions = getGenderOptions(eventForm.type);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <button className="admin-btn secondary" onClick={() => setSelectedTournament(null)} style={{ marginBottom: 8 }}>&#8592; Back</button>
          <h2>{selectedTournament.name} &#8212; Events</h2>
        </div>
        <button className="admin-btn primary" onClick={() => { resetEventForm(); setShowEventForm(true); }}>+ New Event</button>
      </div>
      {error && <div className="admin-error">{error}</div>}

      {poolPlayers.length === 0 && (
        <div className="admin-error" style={{ background: '#2a2215', borderColor: '#5a4a2a', color: '#d4a843' }}>
          No players in tournament pool. Add them in Tournaments tab first.
        </div>
      )}

      {/* Event Form */}
      {showEventForm && (
        <div className="admin-form-card">
          <h3>{editingEventId ? 'Edit Event' : 'New Event'}</h3>
          <form onSubmit={handleSubmitEvent} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Event Name</label><input type="text" value={eventForm.name} onChange={e => setEventForm({ ...eventForm, name: e.target.value })} required /></div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Category</label>
                <select value={eventForm.category} onChange={e => handleCategoryChange(e.target.value)}>
                  <option value="u8">U-8</option><option value="u12">U-13</option><option value="u18">U-18</option>
                  <option value="adult">Adult</option><option value="senior">Senior (45+)</option>
                </select>
              </div>
              <div className="admin-field"><label>Type</label>
                <select value={eventForm.type} onChange={e => handleTypeChange(e.target.value)}>
                  <option value="singles">Singles</option><option value="doubles">Doubles</option>
                </select>
              </div>
              <div className="admin-field">
                <label style={{ color: genderApplicable ? '#ccc' : '#444' }}>Gender</label>
                <select value={eventForm.gender || ''} onChange={e => setEventForm({ ...eventForm, gender: e.target.value || null })}
                  disabled={!genderApplicable}
                  style={!genderApplicable ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
                  {!genderApplicable ? (
                    <option value="">N/A</option>
                  ) : (
                    <>
                      <option value="">Select...</option>
                      {genderOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </>
                  )}
                </select>
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Start Date</label>
                <input type="date" value={eventForm.start_date} onChange={e => setEventForm({ ...eventForm, start_date: e.target.value })} />
              </div>
              <div className="admin-field"><label>End Date</label>
                <input type="date" value={eventForm.end_date} onChange={e => setEventForm({ ...eventForm, end_date: e.target.value })} />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingEventId ? 'Save' : 'Create'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetEventForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Event List */}
      {loading ? <div className="admin-loading">Loading...</div> : events.length === 0 && !showEventForm ? <div className="admin-empty"><p>No events.</p></div> : (
        <div className="admin-list">
          {events.map(ev => (
            <div key={ev.id}>
              <div className="admin-list-item">
                <div className="admin-list-main" style={{ cursor: 'pointer' }} onClick={() => toggleEventExpand(ev.id)}>
                  <div className="admin-list-title">{expandedEventId === ev.id ? '\u25BE' : '\u25B8'} {ev.name}</div>
                  <div className="admin-list-meta">
                    <span className="admin-category-badge">{categoryLabel(ev.category)}</span>
                    {ev.gender && <span className="admin-category-badge">{genderLabel(ev.gender)}</span>}
                    <span>{typeLabel(ev.type)}</span>
                    {ev.start_date && <span>{formatDate(ev.start_date)}{ev.end_date && ev.end_date !== ev.start_date ? ' \u2013 ' + formatDate(ev.end_date) : ''}</span>}
                    {eventRegCounts[ev.id] > 0 && (
                      <span className="admin-category-badge" style={{ background: '#152a15', color: '#4ecb71' }}>
                        {eventRegCounts[ev.id]} {isDoubles(ev.type) ? 'pair' : 'player'}{eventRegCounts[ev.id] !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="admin-list-right">
                  <button className="admin-btn small" onClick={() => handleEditEvent(ev)}>Edit</button>
                  <button className="admin-btn small danger" onClick={() => handleDeleteEvent(ev.id)}>Delete</button>
                </div>
              </div>

              {/* Expanded: Registration */}
              {expandedEventId === ev.id && (
                <div className="event-registrations">
                  <div className="event-reg-header">
                    <span className="event-reg-count">
                      {registrations.length} {isDoubles(ev.type) ? 'pair' : 'player'}{registrations.length !== 1 ? 's' : ''} registered
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {registrations.length > 0 && (
                        <button className="admin-btn small danger" onClick={() => handleBulkUnregister(registrations.map(r => r.id))}>
                          Unregister All
                        </button>
                      )}
                      <button className="admin-btn primary" onClick={() => setShowRegForm(!showRegForm)} style={{ fontSize: 12, padding: '5px 12px' }}>
                        {showRegForm ? 'Done' : isDoubles(ev.type) ? '+ Register Pair' : '+ Register'}
                      </button>
                    </div>
                  </div>

                  {/* Registration Form */}
                  {showRegForm && (
                    isDoubles(ev.type) ? (
                      /* DOUBLES PAIR REGISTRATION */
                      <div className="pool-add-section">
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                          {ev.gender === 'mixed'
                            ? 'Select one male and one female player to form a pair'
                            : 'Select two players to form a ' + (genderLabel(ev.gender) || '') + ' doubles pair'}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
                          Sorted by {ev.gender ? genderLabel(ev.gender) + ' \u00B7 ' : ''}age relevance for {categoryLabel(ev.category)}
                        </div>

                        {/* Player 1 selector */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 4 }}>
                            {ev.gender === 'mixed' ? '\u2642 Male Player' : 'Player 1'}
                          </label>
                          <input type="text" placeholder="Search..." value={pairSearch1}
                            onChange={e => { setPairSearch1(e.target.value); setPairPlayer1(''); }}
                            className="pool-search-input" style={{ marginBottom: 4 }} />
                          {!pairPlayer1 ? (
                            <div className="pool-checklist" style={{ maxHeight: 180 }}>
                              {pairList1.length === 0 ? (
                                <p style={{ color: '#555', fontSize: 12, padding: 8 }}>No players available</p>
                              ) : pairList1.map((p, idx) => {
                                const age = getPlayerAge(p);
                                const targetG = ev.gender === 'mixed' ? 'male' : (ev.gender === 'mens' ? 'male' : ev.gender === 'womens' ? 'female' : null);
                                const isMatch = targetG ? p.gender === targetG : true;
                                const prevP = idx > 0 ? pairList1[idx - 1] : null;
                                const showSep = targetG && prevP && prevP.gender === targetG && p.gender !== targetG;
                                return (
                                  <div key={p.id}>
                                    {showSep && <div className="pool-bucket-header" style={{ color: '#666', marginTop: 8 }}>Other players</div>}
                                    <div className={'pool-check-item ' + (isMatch ? 'eligible' : 'other-age')}
                                      onClick={() => { setPairPlayer1(p.id); setPairSearch1(''); }}
                                      style={{ cursor: 'pointer' }}>
                                      <span className="pool-check-name">{p.name}</span>
                                      <span className="pool-check-meta">{p.gender === 'female' ? 'F' : 'M'}{age != null ? ' \u00B7 ' + age + 'y' : ''}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#1a2a1a', borderRadius: 6, border: '1px solid #2a4a2a' }}>
                              <span style={{ color: '#4ecb71', fontSize: 13, flex: 1 }}>{'\u2713'} {playerName(pairPlayer1)} ({playerGenderTag(pairPlayer1)})</span>
                              <button className="admin-btn small" onClick={() => setPairPlayer1('')} style={{ fontSize: 10, padding: '2px 8px' }}>Change</button>
                            </div>
                          )}
                        </div>

                        {/* Player 2 selector */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 4 }}>
                            {ev.gender === 'mixed' ? '\u2640 Female Player' : 'Player 2'}
                          </label>
                          <input type="text" placeholder="Search..." value={pairSearch2}
                            onChange={e => { setPairSearch2(e.target.value); setPairPlayer2(''); }}
                            className="pool-search-input" style={{ marginBottom: 4 }} />
                          {!pairPlayer2 ? (
                            <div className="pool-checklist" style={{ maxHeight: 180 }}>
                              {pairList2.length === 0 ? (
                                <p style={{ color: '#555', fontSize: 12, padding: 8 }}>{pairPlayer1 ? 'No players available' : 'Select player 1 first'}</p>
                              ) : pairList2.map((p, idx) => {
                                const age = getPlayerAge(p);
                                const targetG = ev.gender === 'mixed' ? 'female' : (ev.gender === 'mens' ? 'male' : ev.gender === 'womens' ? 'female' : null);
                                const isMatch = targetG ? p.gender === targetG : true;
                                const prevP = idx > 0 ? pairList2[idx - 1] : null;
                                const showSep = targetG && prevP && prevP.gender === targetG && p.gender !== targetG;
                                return (
                                  <div key={p.id}>
                                    {showSep && <div className="pool-bucket-header" style={{ color: '#666', marginTop: 8 }}>Other players</div>}
                                    <div className={'pool-check-item ' + (isMatch ? 'eligible' : 'other-age')}
                                      onClick={() => { setPairPlayer2(p.id); setPairSearch2(''); }}
                                      style={{ cursor: 'pointer' }}>
                                      <span className="pool-check-name">{p.name}</span>
                                      <span className="pool-check-meta">{p.gender === 'female' ? 'F' : 'M'}{age != null ? ' \u00B7 ' + age + 'y' : ''}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#1a2a1a', borderRadius: 6, border: '1px solid #2a4a2a' }}>
                              <span style={{ color: '#4ecb71', fontSize: 13, flex: 1 }}>{'\u2713'} {playerName(pairPlayer2)} ({playerGenderTag(pairPlayer2)})</span>
                              <button className="admin-btn small" onClick={() => setPairPlayer2('')} style={{ fontSize: 10, padding: '2px 8px' }}>Change</button>
                            </div>
                          )}
                        </div>

                        {/* Register pair button */}
                        {pairPlayer1 && pairPlayer2 && (
                          <button className="admin-btn primary" onClick={handleRegisterPair} style={{ width: '100%' }}>
                            Register Pair: {playerName(pairPlayer1)} & {playerName(pairPlayer2)}
                          </button>
                        )}
                      </div>
                    ) : (
                      /* SINGLES BULK REGISTRATION */
                      <div className="pool-add-section">
                        <input type="text" placeholder="Search..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} className="pool-search-input" />
                        <p style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>
                          {'Sorted by ' + (ev.gender ? genderLabel(ev.gender) + ' \u00B7 ' : '') + 'age relevance for ' + categoryLabel(ev.category)}
                          {' \u00B7 Hold Shift to select range'}
                          {availableForReg.length > 0 && <>{' \u00B7 '}<span style={{ cursor: 'pointer', color: '#d4a843' }} onClick={() => {
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
                              const targetGender = ev.gender === 'mens' ? 'male' : ev.gender === 'womens' ? 'female' : null;
                              let shownOtherHeader = false;
                              return availableForReg.map((p, idx) => {
                                const age = getPlayerAge(p);
                                const b = getBucket(p, ev.category);
                                const showBucketHeader = b !== lastBucket && b !== 99;
                                lastBucket = b;
                                let showGenderSep = false;
                                if (targetGender && !shownOtherHeader && p.gender !== targetGender) {
                                  shownOtherHeader = true;
                                  showGenderSep = true;
                                }
                                return (
                                  <div key={p.id}>
                                    {showGenderSep && <div className="pool-bucket-header" style={{ color: '#666', marginTop: 8 }}>Other players</div>}
                                    {showBucketHeader && !showGenderSep && <div className="pool-bucket-header">{bucketLabel(ev.category, b)}</div>}
                                    <label className={'pool-check-item ' + (regSelected.has(p.id) ? 'selected' : '') + ' ' + (b === 0 ? 'eligible' : b > 0 && b < 99 ? 'other-age' : '')}
                                      onClick={(e) => { e.preventDefault(); handleRegClick(e, idx); }}>
                                      <input type="checkbox" checked={regSelected.has(p.id)} readOnly />
                                      <span className="pool-check-name">{p.name}</span>
                                      <span className="pool-check-meta">{p.gender === 'female' ? 'F' : 'M'}{age != null ? ' \u00B7 ' + age + 'y' : ''}</span>
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
                    )
                  )}

                  {/* Registered list */}
                  {registrations.length > 0 && (
                    <div className="event-reg-list">
                      {registrations.map((reg, idx) => {
                        const age1 = playerAge(reg.player_id);
                        const age2 = reg.partner_id ? playerAge(reg.partner_id) : null;
                        return (
                          <div key={reg.id} className="event-reg-item">
                            <span className="event-reg-number">{idx + 1}</span>
                            <span className="event-reg-name">
                              {playerName(reg.player_id)}
                              {age1 != null && <span style={{ color: '#888', fontSize: 11 }}> ({age1}y)</span>}
                              {reg.partner_id && (
                                <span className="event-reg-partner">
                                  {' & '}{playerName(reg.partner_id)}
                                  {age2 != null && <span style={{ color: '#888', fontSize: 11 }}> ({age2}y)</span>}
                                </span>
                              )}
                            </span>
                            <button className="admin-btn small danger" onClick={() => handleUnregister(reg.id)} style={{ padding: '3px 8px', fontSize: 11 }}>{'\u2715'}</button>
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