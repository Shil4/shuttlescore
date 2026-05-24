import { supabase } from '../lib/supabase';

export const RealtimeService = {
  // Subscribe to all match changes (for admin, referee, and spectator views)
  subscribeToMatches(callback) {
    const channel = supabase
      .channel('matches-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        (payload) => { callback(payload.eventType, payload.new, payload.old); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  },

  // Subscribe to a specific match (for scoring view)
  subscribeToMatch(matchId, callback) {
    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => { callback(payload.new); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  },

  // Subscribe to referee changes (for admin referee management)
  subscribeToReferees(callback) {
    const channel = supabase
      .channel('referees-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referees' },
        (payload) => { callback(payload.eventType, payload.new, payload.old); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  },
};