import { useState, useEffect } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { PlayerService } from '../../services/PlayerService';
import { supabase } from '../../lib/supabase';
import './AdminComponents.css';

export default function EventManager() {
  // Tournament selection
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);

  // Events for selected tournament
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Event form
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState({
    name: '',
    category: 'adult',
    type: 'singles',
    format: 'elimination',
    group_size: 4,
    advancement_count: 2,
  });

  // Registration
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [registrations, setRegistrations] = useState([]);  // for expanded event
  const [allPlayers, setAllPlayers] = useState([]);
  const [showRegForm, setShowRegForm] = useState(false);
  const [regPlayerId, setRegPlayerId] = useState('');
  const [regPartnerId, setRegPartnerId] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');

  // Load tournaments on mount
  useEffect(() => {
    loadTournaments();
  }, []);

  const loadTournaments = async () => {
    try {
      const data = await TournamentService.getAll();
      setTournaments(data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load tournaments: ' + err.message);
      setLoading(false);
    }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament);
    setExpandedEventId(null);
    await loadEvents(tournament.id);
  };

  const loadEvents = async (tournamentId) => {
    try {
      setLoading(true);
      const data = await TournamentService.getEvents(tournamentId);
      setEvents(data);
    } catch (err) {
      setError('Failed to load events: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Event CRUD ──
  const resetEventForm = () => {
    setEventForm({
      name: '',
      category: 'adult',
      type: 'singles',
      format: 'elimination',
      group_size: 4,
      advancement_count: 2,
    });
    setEditingEventId(null);
    setShowEventForm(false);
  };

  const handleEditEvent = (event) => {
    setEventForm({
      name: event.name,
      category: event.category,
      type: event.type,
      format: event.format,
      group_size: event.group_size,
      advancement_count: event.advancement_count,
    });
    setEditingEventId(event.id);
    setShowEventForm(true);
  };

  const handleSubmitEvent = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (editingEventId) {
        await TournamentService.updateEvent(editingEventId, eventForm);
      } else {
        await TournamentService.createEvent(selectedTournament.id, eventForm);
      }
      resetEventForm();
      await loadEvents(selectedTournament.id);
    } catch (err) {
      setError('Failed to save event: ' + err.message);
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Delete this event and all its registrations, draws, and matches?')) return;
    try {
      await TournamentService.deleteEvent(id);
      await loadEvents(selectedTournament.id);
    } catch (err) {
      setError('Failed to delete: ' + err.message);
    }
  };

  // ── Registration ──
  const toggleEventExpand = async (eventId) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(eventId);
    await loadRegistrations(eventId);
    // Load all players for the registration dropdown
    if (allPlayers.length === 0) {
      const players = await PlayerService.getAll();
      setAllPlayers(players);
    }
  };

  const loadRegistrations = async (eventId) => {
    try {
      // Make sure we have players loaded first
      if (allPlayers.length === 0) {
        const players = await PlayerService.getAll();
        setAllPlayers(players);
      }
      // Fetch registrations without the players join (avoids ambiguous FK error)
      const { data, error } = await supabase
        .from('player_registrations')
        .select('id, player_id, partner_id, event_id, created_at')
        .eq('event_id', eventId);
      if (error) throw error;
      setRegistrations(data || []);
    } catch (err) {
      setError('Failed to load registrations: ' + err.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (!regPlayerId) {
      setError('Please select a player');
      return;
    }

    try {
      const currentEvent = events.find(ev => ev.id === expandedEventId);
      const partnerId = (currentEvent?.type === 'doubles' || currentEvent?.type === 'mixed_doubles') && regPartnerId
        ? regPartnerId
        : null;

      await TournamentService.registerPlayer(regPlayerId, expandedEventId, partnerId);
      setRegPlayerId('');
      setRegPartnerId('');
      setShowRegForm(false);
      setPlayerSearch('');
      await loadRegistrations(expandedEventId);
    } catch (err) {
      setError('Failed to register player: ' + err.message);
    }
  };

  const handleUnregister = async (registrationId) => {
    try {
      await TournamentService.unregisterPlayer(registrationId);
      await loadRegistrations(expandedEventId);
    } catch (err) {
      setError('Failed to unregister: ' + err.message);
    }
  };

  // ── Helpers ──
  const typeLabel = (type) => {
    switch (type) {
      case 'singles': return 'Singles';
      case 'doubles': return 'Doubles';
      case 'mixed_doubles': return 'Mixed Doubles';
      default: return type;
    }
  };

  const formatLabel = (format) => {
    switch (format) {
      case 'round_robin': return 'Round Robin';
      case 'elimination': return 'Elimination';
      case 'group_to_knockout': return 'Group → Knockout';
      default: return format;
    }
  };

  const categoryLabel = (cat) => {
    switch (cat) {
      case 'u8': return 'U-8';
      case 'u12': return 'U-12';
      case 'u18': return 'U-18';
      case 'adult': return 'Adult';
      case 'senior': return 'Senior';
      default: return cat;
    }
  };

  // Registered player IDs (to filter them out of the dropdown)
  const registeredPlayerIds = new Set();
  registrations.forEach(r => {
    if (r.player_id) registeredPlayerIds.add(r.player_id);
    if (r.partner_id) registeredPlayerIds.add(r.partner_id);
  });

  // Available players (not yet registered in this event)
  const availablePlayers = allPlayers
    .filter(p => !registeredPlayerIds.has(p.id))
    .filter(p => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()));

  // ── Render ──

  if (loading && !selectedTournament) {
    return <div className="admin-loading">Loading tournaments...</div>;
  }

  // Step 1: Select a tournament
  if (!selectedTournament) {
    return (
      <div className="admin-section">
        <div className="admin-section-header">
          <h2>Events</h2>
        </div>
        <p style={{ color: '#888', marginBottom: 16 }}>Select a tournament to manage its events:</p>
        {tournaments.length === 0 ? (
          <div className="admin-empty">
            <p>No tournaments yet. Create one in the Tournaments section first.</p>
          </div>
        ) : (
          <div className="admin-list">
            {tournaments.map((t) => (
              <div
                key={t.id}
                className="admin-list-item"
                style={{ cursor: 'pointer' }}
                onClick={() => selectTournament(t)}
              >
                <div className="admin-list-main">
                  <div className="admin-list-title">{t.name}</div>
                  <div className="admin-list-meta">
                    {t.venue && <span>{t.venue}</span>}
                    {t.start_date && <span>{t.start_date}</span>}
                  </div>
                </div>
                <div className="admin-list-right">
                  <span style={{ color: '#d4a843', fontSize: 18 }}>→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 2: Manage events for selected tournament
  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <button
            className="admin-btn secondary"
            onClick={() => setSelectedTournament(null)}
            style={{ marginBottom: 8 }}
          >
            ← Back to Tournaments
          </button>
          <h2>{selectedTournament.name} — Events</h2>
        </div>
        <button
          className="admin-btn primary"
          onClick={() => {
            resetEventForm();
            setShowEventForm(true);
          }}
        >
          + New Event
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {/* Event Create/Edit Form */}
      {showEventForm && (
        <div className="admin-form-card">
          <h3>{editingEventId ? 'Edit Event' : 'New Event'}</h3>
          <form onSubmit={handleSubmitEvent} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Event Name</label>
                <input
                  type="text"
                  value={eventForm.name}
                  onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                  placeholder="e.g. Men's Singles"
                  required
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Age Category</label>
                <select
                  value={eventForm.category}
                  onChange={(e) => setEventForm({ ...eventForm, category: e.target.value })}
                >
                  <option value="u8">U-8</option>
                  <option value="u12">U-12</option>
                  <option value="u18">U-18</option>
                  <option value="adult">Adult</option>
                  <option value="senior">Senior (45+)</option>
                </select>
              </div>
              <div className="admin-field">
                <label>Type</label>
                <select
                  value={eventForm.type}
                  onChange={(e) => setEventForm({ ...eventForm, type: e.target.value })}
                >
                  <option value="singles">Singles</option>
                  <option value="doubles">Doubles</option>
                  <option value="mixed_doubles">Mixed Doubles</option>
                </select>
              </div>
              <div className="admin-field">
                <label>Format</label>
                <select
                  value={eventForm.format}
                  onChange={(e) => setEventForm({ ...eventForm, format: e.target.value })}
                >
                  <option value="elimination">Elimination</option>
                  <option value="round_robin">Round Robin</option>
                  <option value="group_to_knockout">Group → Knockout</option>
                </select>
              </div>
            </div>
            {(eventForm.format === 'round_robin' || eventForm.format === 'group_to_knockout') && (
              <div className="admin-form-row">
                <div className="admin-field">
                  <label>Group Size</label>
                  <input
                    type="number"
                    min="3"
                    max="8"
                    value={eventForm.group_size}
                    onChange={(e) => setEventForm({ ...eventForm, group_size: parseInt(e.target.value) || 4 })}
                  />
                </div>
                {eventForm.format === 'group_to_knockout' && (
                  <div className="admin-field">
                    <label>Advance per Group</label>
                    <input
                      type="number"
                      min="1"
                      max="4"
                      value={eventForm.advancement_count}
                      onChange={(e) => setEventForm({ ...eventForm, advancement_count: parseInt(e.target.value) || 2 })}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">
                {editingEventId ? 'Save Changes' : 'Create Event'}
              </button>
              <button type="button" className="admin-btn secondary" onClick={resetEventForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Event List */}
      {loading ? (
        <div className="admin-loading">Loading events...</div>
      ) : events.length === 0 && !showEventForm ? (
        <div className="admin-empty">
          <p>No events yet. Create your first event for this tournament!</p>
        </div>
      ) : (
        <div className="admin-list">
          {events.map((ev) => (
            <div key={ev.id}>
              <div className="admin-list-item">
                <div
                  className="admin-list-main"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleEventExpand(ev.id)}
                >
                  <div className="admin-list-title">
                    {expandedEventId === ev.id ? '▾' : '▸'} {ev.name}
                  </div>
                  <div className="admin-list-meta">
                    <span className="admin-category-badge">{categoryLabel(ev.category)}</span>
                    <span>{typeLabel(ev.type)}</span>
                    <span>{formatLabel(ev.format)}</span>
                    <span className="admin-status-badge" style={{
                      color: ev.status === 'draft' ? '#888' : '#4ecb71',
                      borderColor: ev.status === 'draft' ? '#888' : '#4ecb71',
                    }}>
                      {ev.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="admin-list-right">
                  <button className="admin-btn small" onClick={() => handleEditEvent(ev)}>
                    Edit
                  </button>
                  <button className="admin-btn small danger" onClick={() => handleDeleteEvent(ev.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Expanded: Player Registrations */}
              {expandedEventId === ev.id && (
                <div className="event-registrations">
                  <div className="event-reg-header">
                    <span className="event-reg-count">
                      {registrations.length} player{registrations.length !== 1 ? 's' : ''} registered
                    </span>
                    <button
                      className="admin-btn primary"
                      onClick={() => setShowRegForm(true)}
                      style={{ padding: '5px 12px', fontSize: 12 }}
                    >
                      + Register Player
                    </button>
                  </div>

                  {/* Registration Form */}
                  {showRegForm && (
                    <div className="event-reg-form">
                      <form onSubmit={handleRegister} className="admin-form">
                        <div className="admin-form-row">
                          <div className="admin-field">
                            <label>Search Player</label>
                            <input
                              type="text"
                              placeholder="Type to filter..."
                              value={playerSearch}
                              onChange={(e) => setPlayerSearch(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="admin-form-row">
                          <div className="admin-field">
                            <label>Player</label>
                            <select
                              value={regPlayerId}
                              onChange={(e) => setRegPlayerId(e.target.value)}
                              required
                            >
                              <option value="">— Select a player —</option>
                              {availablePlayers.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({categoryLabel(p.age_category)})
                                </option>
                              ))}
                            </select>
                          </div>
                          {(ev.type === 'doubles' || ev.type === 'mixed_doubles') && (
                            <div className="admin-field">
                              <label>Partner</label>
                              <select
                                value={regPartnerId}
                                onChange={(e) => setRegPartnerId(e.target.value)}
                              >
                                <option value="">— Select partner —</option>
                                {allPlayers
                                  .filter(p => p.id !== regPlayerId && !registeredPlayerIds.has(p.id))
                                  .map(p => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({categoryLabel(p.age_category)})
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="admin-form-actions">
                          <button type="submit" className="admin-btn primary" style={{ fontSize: 12, padding: '5px 12px' }}>
                            Register
                          </button>
                          <button
                            type="button"
                            className="admin-btn secondary"
                            onClick={() => { setShowRegForm(false); setPlayerSearch(''); }}
                            style={{ fontSize: 12, padding: '5px 12px' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Registered Players List */}
                  {registrations.length > 0 && (
                    <div className="event-reg-list">
                      {registrations.map((reg, idx) => {
                        const player = allPlayers.find(p => p.id === reg.player_id);
                        const partner = reg.partner_id ? allPlayers.find(p => p.id === reg.partner_id) : null;
                        return (
                          <div key={reg.id} className="event-reg-item">
                            <span className="event-reg-number">{idx + 1}</span>
                            <span className="event-reg-name">
                              {player?.name || reg.player_id}
                              {partner && <span className="event-reg-partner"> & {partner.name}</span>}
                            </span>
                            <button
                              className="admin-btn small danger"
                              onClick={() => handleUnregister(reg.id)}
                              style={{ padding: '3px 8px', fontSize: 11 }}
                            >
                              ✕
                            </button>
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