// ─── RealtimeService ─────────────────────────────────────────
// Manages Supabase Realtime subscriptions for live updates.
// Swap this file to change realtime providers.

import { supabase } from '../lib/supabase';

export const RealtimeService = {
  // ── Subscribe to a single match (live scoring) ─────────────
  subscribeToMatch(matchId, callback) {
    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      supabase.removeChannel(channel);
    };
  },

  // ── Subscribe to all matches in a tournament ───────────────
  // (for live control / public schedule view)
  subscribeToTournamentMatches(tournamentId, callback) {
    // We subscribe to all match updates and filter client-side
    // since Supabase doesn't support JOIN-based filters in realtime
    const channel = supabase
      .channel(`tournament-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
        },
        (payload) => {
          callback(payload.eventType, payload.new, payload.old);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // ── Subscribe to specific event's matches ──────────────────
  subscribeToEvent(eventId, callback) {
    const channel = supabase
      .channel(`event-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
