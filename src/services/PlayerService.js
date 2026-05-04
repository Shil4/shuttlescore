// ─── PlayerService ───────────────────────────────────────────
// Manages the global player registry (persistent across tournaments).
// Swap this file to change data providers.

import { supabase } from '../lib/supabase';

export const PlayerService = {
  // ── Read ───────────────────────────────────────────────────
  async getAll(filters = {}) {
    let query = supabase.from('players').select('*').order('name');

    if (filters.age_category) {
      query = query.eq('age_category', filters.age_category);
    }
    if (filters.search) {
      query = query.ilike('name', `%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async search(query) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name')
      .limit(20);
    if (error) throw error;
    return data;
  },

  // ── Write ──────────────────────────────────────────────────
  async create(playerData) {
    const { data, error } = await supabase
      .from('players')
      .insert(playerData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── CSV Import ─────────────────────────────────────────────
  async importFromCSV(rows) {
    // rows is an array of { name, age_category, events[] }
    // parsed by the UI before calling this
    const results = { imported: [], errors: [] };

    for (const row of rows) {
      try {
        // Check if player already exists (by name match)
        const { data: existing } = await supabase
          .from('players')
          .select('id, name')
          .ilike('name', row.name.trim())
          .limit(1);

        if (existing && existing.length > 0) {
          // Return existing player for admin to review
          results.imported.push({ ...existing[0], status: 'existing' });
        } else {
          // Create new player
          const { data, error } = await supabase
            .from('players')
            .insert({
              name: row.name.trim(),
              age_category: row.age_category || 'adult',
            })
            .select()
            .single();

          if (error) {
            results.errors.push({ row, error: error.message });
          } else {
            results.imported.push({ ...data, status: 'new' });
          }
        }
      } catch (err) {
        results.errors.push({ row, error: err.message });
      }
    }

    return results;
  },

  // ── History ────────────────────────────────────────────────
  async getMatchHistory(playerId) {
    // Find all matches where this player is in side_a or side_b
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events(name, tournament_id, type, 
          tournament:tournaments(name)
        )
      `)
      .or(`side_a.cs.{${playerId}},side_b.cs.{${playerId}}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getTournamentHistory(playerId) {
    // Get all tournaments this player has participated in
    const { data, error } = await supabase
      .from('player_registrations')
      .select(`
        *,
        event:events(
          tournament_id,
          tournament:tournaments(id, name, start_date, status)
        )
      `)
      .eq('player_id', playerId);

    if (error) throw error;

    // Deduplicate tournaments
    const seen = new Set();
    const tournaments = [];
    for (const reg of data || []) {
      const t = reg.event?.tournament;
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        tournaments.push(t);
      }
    }
    return tournaments;
  },

  // ── Stats ──────────────────────────────────────────────────
  async getStats(playerId) {
    const matches = await this.getMatchHistory(playerId);
    const lockedMatches = matches.filter(m => m.status === 'locked');

    let wins = 0;
    let losses = 0;
    for (const m of lockedMatches) {
      const isInA = m.side_a?.includes(playerId);
      const isInB = m.side_b?.includes(playerId);
      if ((isInA && m.winner === 'side_a') || (isInB && m.winner === 'side_b')) {
        wins++;
      } else if (m.winner) {
        losses++;
      }
    }

    const tournaments = await this.getTournamentHistory(playerId);

    return {
      tournaments: tournaments.length,
      matches_played: lockedMatches.length,
      wins,
      losses,
      win_rate: lockedMatches.length > 0
        ? Math.round((wins / lockedMatches.length) * 100)
        : 0,
    };
  },
};
