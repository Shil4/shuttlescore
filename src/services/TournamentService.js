// ─── TournamentService ───────────────────────────────────────
// Manages tournaments, events, and player registrations.
// Swap this file to change data providers.

import { supabase } from '../lib/supabase';

export const TournamentService = {
  // ── Tournaments ────────────────────────────────────────────
  async getAll() {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(tournamentData) {
    const { data, error } = await supabase
      .from('tournaments')
      .insert(tournamentData)
      .select()
      .single();
    if (error) throw error;

    // Auto-create default courts
    const courts = [];
    for (let i = 1; i <= (tournamentData.court_count || 2); i++) {
      courts.push({ id: `Court ${i}`, tournament_id: data.id });
    }
    if (courts.length > 0) {
      await supabase.from('courts').insert(courts);
    }

    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── Events ─────────────────────────────────────────────────
  async getEvents(tournamentId) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('display_order');
    if (error) throw error;
    return data;
  },

  async createEvent(tournamentId, eventData) {
    const { data, error } = await supabase
      .from('events')
      .insert({ ...eventData, tournament_id: tournamentId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateEvent(eventId, updates) {
    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteEvent(eventId) {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);
    if (error) throw error;
  },

  async reorderEvents(eventIds) {
    // Update display_order for each event based on position in array
    const updates = eventIds.map((id, index) => ({
      id,
      display_order: index + 1,
    }));

    for (const update of updates) {
      await supabase
        .from('events')
        .update({ display_order: update.display_order })
        .eq('id', update.id);
    }
  },

  // ── Player Registration ────────────────────────────────────
  async getRegistrations(eventId) {
    const { data, error } = await supabase
      .from('player_registrations')
      .select(`
        *,
        player:players(*),
        partner:players!player_registrations_partner_id_fkey(*)
      `)
      .eq('event_id', eventId);
    if (error) throw error;
    return data;
  },

  async getPlayersByTournament(tournamentId) {
    // Get all players registered in any event of this tournament
    const { data, error } = await supabase
      .from('player_registrations')
      .select(`
        *,
        player:players(*),
        event:events(id, name, tournament_id)
      `)
      .eq('event.tournament_id', tournamentId);
    if (error) throw error;

    // Deduplicate players, aggregate their events
    const playerMap = new Map();
    for (const reg of data || []) {
      if (!reg.player) continue;
      const pid = reg.player.id;
      if (!playerMap.has(pid)) {
        playerMap.set(pid, { ...reg.player, events: [], registrations: [] });
      }
      playerMap.get(pid).events.push(reg.event);
      playerMap.get(pid).registrations.push(reg);
    }
    return Array.from(playerMap.values());
  },

  async registerPlayer(playerId, eventId, partnerId = null) {
    const { data, error } = await supabase
      .from('player_registrations')
      .insert({
        player_id: playerId,
        event_id: eventId,
        partner_id: partnerId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updatePartner(registrationId, partnerId) {
    const { data, error } = await supabase
      .from('player_registrations')
      .update({ partner_id: partnerId })
      .eq('id', registrationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async unregisterPlayer(registrationId) {
    const { error } = await supabase
      .from('player_registrations')
      .delete()
      .eq('id', registrationId);
    if (error) throw error;
  },

  // ── Courts ─────────────────────────────────────────────────
  async getCourts(tournamentId) {
    const { data, error } = await supabase
      .from('courts')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('id');
    if (error) throw error;
    return data;
  },

  async addCourt(tournamentId, courtName) {
    const { data, error } = await supabase
      .from('courts')
      .insert({ id: courtName, tournament_id: tournamentId });
    if (error) throw error;
    return data;
  },

  async removeCourt(tournamentId, courtId) {
    // Unassign any matches from this court first
    await supabase
      .from('matches')
      .update({ court_id: null })
      .eq('court_id', courtId);

    const { error } = await supabase
      .from('courts')
      .delete()
      .eq('id', courtId)
      .eq('tournament_id', tournamentId);
    if (error) throw error;
  },
};