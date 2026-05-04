// ─── MatchService ────────────────────────────────────────────
// Manages match records, court assignments, referee assignments.
// Swap this file to change data providers.

import { supabase } from '../lib/supabase';

export const MatchService = {
  async getById(matchId) {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events(name, type, format, tournament_id)
      `)
      .eq('id', matchId)
      .single();
    if (error) throw error;
    return data;
  },

  async getByEvent(eventId) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('event_id', eventId)
      .order('stage')
      .order('bracket_position');
    if (error) throw error;
    return data;
  },

  async getByDate(tournamentId, date) {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events!inner(name, type, tournament_id)
      `)
      .eq('event.tournament_id', tournamentId)
      .eq('scheduled_date', date)
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async getByTournament(tournamentId) {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events!inner(name, type, format, display_order, tournament_id)
      `)
      .eq('event.tournament_id', tournamentId)
      .order('event(display_order)')
      .order('stage')
      .order('bracket_position');
    if (error) throw error;
    return data;
  },

  async getByReferee(refereeId) {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events(name, type, format)
      `)
      .eq('referee_id', refereeId)
      .order('scheduled_date')
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async assignReferee(matchId, refereeId) {
    const { data, error } = await supabase
      .from('matches')
      .update({ referee_id: refereeId })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async assignCourt(matchId, courtId) {
    const { data, error } = await supabase
      .from('matches')
      .update({ court_id: courtId })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async assignDate(matchId, date) {
    const { data, error } = await supabase
      .from('matches')
      .update({ scheduled_date: date })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async assignDateBulk(matchIds, date) {
    const { data, error } = await supabase
      .from('matches')
      .update({ scheduled_date: date })
      .in('id', matchIds)
      .select();
    if (error) throw error;
    return data;
  },

  // Get matches missing referee assignments for a tournament
  async getUnassigned(tournamentId) {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        event:events!inner(name, tournament_id)
      `)
      .eq('event.tournament_id', tournamentId)
      .is('referee_id', null)
      .in('status', ['pending'])
      .order('scheduled_date');
    if (error) throw error;
    return data;
  },
};

// ─── ScoreService ────────────────────────────────────────────
// Handles live scoring, match finish, lock, and admin overrides.

export const ScoreService = {
  // ── Check if match can start ───────────────────────────────
  async canStartMatch(matchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) return { allowed: false, reason: 'Match not found' };
    if (!match.referee_id) return { allowed: false, reason: 'No referee assigned' };
    if (!match.side_a || match.side_a.length === 0) return { allowed: false, reason: 'Side A not yet determined' };
    if (!match.side_b || match.side_b.length === 0) return { allowed: false, reason: 'Side B not yet determined' };
    if (match.status !== 'pending') return { allowed: false, reason: `Match is already ${match.status}` };

    return { allowed: true };
  },

  // ── Start Match ────────────────────────────────────────────
  async startMatch(matchId) {
    const canStart = await this.canStartMatch(matchId);
    if (!canStart.allowed) throw new Error(canStart.reason);

    const initialScore = {
      sets: [{ side_a_points: 0, side_b_points: 0, point_log: [] }],
      current_set: 0,
    };

    const { data, error } = await supabase
      .from('matches')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        score_data: initialScore,
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;

    // Update event status to in_progress if not already
    await supabase
      .from('events')
      .update({ status: 'in_progress' })
      .eq('id', data.event_id)
      .in('status', ['draft', 'draw_generated']);

    return data;
  },

  // ── Add Point ──────────────────────────────────────────────
  async addPoint(matchId, side) {
    // side = 'side_a' or 'side_b'
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');
    if (match.status !== 'in_progress' && match.status !== 'finished') {
      throw new Error('Match is not active');
    }

    const scoreData = { ...match.score_data };
    const currentSet = scoreData.sets[scoreData.current_set];

    // Add point
    const pointKey = side === 'side_a' ? 'side_a_points' : 'side_b_points';
    currentSet[pointKey]++;
    currentSet.point_log.push({
      scorer: side,
      timestamp: new Date().toISOString(),
    });

    // Check if winner needs recalculating (for finished matches being edited)
    let winner = match.winner;
    if (match.status === 'finished') {
      winner = this._calculateWinner(scoreData);
    }

    const { data, error } = await supabase
      .from('matches')
      .update({ score_data: scoreData, winner })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Undo Last Point ────────────────────────────────────────
  async undoLastPoint(matchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');
    if (match.status !== 'in_progress' && match.status !== 'finished') {
      throw new Error('Match is not active');
    }

    const scoreData = { ...match.score_data };
    const currentSet = scoreData.sets[scoreData.current_set];

    if (currentSet.point_log.length === 0) {
      throw new Error('No points to undo');
    }

    const lastPoint = currentSet.point_log.pop();
    const pointKey = lastPoint.scorer === 'side_a' ? 'side_a_points' : 'side_b_points';
    currentSet[pointKey] = Math.max(0, currentSet[pointKey] - 1);

    // Recalculate winner if match is finished
    let winner = match.winner;
    if (match.status === 'finished') {
      winner = this._calculateWinner(scoreData);
    }

    const { data, error } = await supabase
      .from('matches')
      .update({ score_data: scoreData, winner })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── New Set ────────────────────────────────────────────────
  async newSet(matchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');

    const scoreData = { ...match.score_data };
    scoreData.sets.push({ side_a_points: 0, side_b_points: 0, point_log: [] });
    scoreData.current_set = scoreData.sets.length - 1;

    const { data, error } = await supabase
      .from('matches')
      .update({ score_data: scoreData })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Switch Current Set ─────────────────────────────────────
  async switchSet(matchId, setIndex) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');
    if (setIndex < 0 || setIndex >= match.score_data.sets.length) {
      throw new Error('Invalid set index');
    }

    const scoreData = { ...match.score_data, current_set: setIndex };

    const { data, error } = await supabase
      .from('matches')
      .update({ score_data: scoreData })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Finish Match ───────────────────────────────────────────
  async finishMatch(matchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');
    if (match.status !== 'in_progress') throw new Error('Match is not in progress');

    // Calculate winner
    const winner = this._calculateWinner(match.score_data);
    if (winner === 'tied') {
      throw new Error('Result is tied — add another set before finishing');
    }
    if (winner === 'no_data') {
      throw new Error('No score data recorded');
    }

    const finishedAt = new Date().toISOString();
    const durationSeconds = match.started_at
      ? Math.floor((new Date(finishedAt) - new Date(match.started_at)) / 1000)
      : null;

    const { data, error } = await supabase
      .from('matches')
      .update({
        status: 'finished',
        winner,
        finished_at: finishedAt,
        duration_seconds: durationSeconds,
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;

    // Schedule auto-lock after 5 minutes (handled by client polling or edge function)
    return data;
  },

  // ── Lock Match (called after 5-minute grace period) ────────
  async lockMatch(matchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) throw new Error('Match not found');
    if (match.status !== 'finished') throw new Error('Match is not finished');

    // Verify 5 minutes have passed
    if (match.finished_at) {
      const elapsed = Date.now() - new Date(match.finished_at).getTime();
      if (elapsed < 5 * 60 * 1000) {
        throw new Error('Grace period has not expired yet');
      }
    }

    const { data, error } = await supabase
      .from('matches')
      .update({ status: 'locked', locked_at: new Date().toISOString() })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;

    // Winner auto-advances via the database trigger (advance_match_winner)
    return data;
  },

  // ── Admin Override ─────────────────────────────────────────
  async adminOverride(matchId, overridePassword, changes, reason) {
    // Verify override password
    const { data: config } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'override_password_hash')
      .single();

    // In production, compare hashed password
    // For now, simple comparison (replace with bcrypt in production)
    if (!config || config.value === 'CHANGE_ME_TO_BCRYPT_HASH') {
      throw new Error('Override password not configured');
    }

    // TODO: Add proper bcrypt comparison here
    // if (!await bcrypt.compare(overridePassword, config.value)) {
    //   throw new Error('Invalid override password');
    // }

    // Get current match for audit log
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    // Build audit log entry
    const logEntry = {
      admin_id: (await supabase.auth.getUser()).data.user?.id,
      timestamp: new Date().toISOString(),
      changes,
      reason,
      previous_state: {
        score_data: match.score_data,
        winner: match.winner,
        status: match.status,
      },
    };

    const overrideLog = [...(match.override_log || []), logEntry];

    // Apply changes and re-lock
    const { data, error } = await supabase
      .from('matches')
      .update({
        ...changes,
        override_log: overrideLog,
        status: 'locked',
        locked_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Get Live Score ─────────────────────────────────────────
  async getMatchScore(matchId) {
    const { data, error } = await supabase
      .from('matches')
      .select('score_data, winner, status, started_at, finished_at')
      .eq('id', matchId)
      .single();
    if (error) throw error;
    return data;
  },

  // ── Winner Calculation (internal) ──────────────────────────
  _calculateWinner(scoreData) {
    if (!scoreData || !scoreData.sets || scoreData.sets.length === 0) {
      return 'no_data';
    }

    const sets = scoreData.sets;
    let sideASets = 0;
    let sideBSets = 0;

    for (const set of sets) {
      if (set.side_a_points > set.side_b_points) sideASets++;
      else if (set.side_b_points > set.side_a_points) sideBSets++;
    }

    if (sets.length === 1) {
      if (sideASets > sideBSets) return 'side_a';
      if (sideBSets > sideASets) return 'side_b';
      return 'tied';
    }

    if (sideASets > sideBSets) return 'side_a';
    if (sideBSets > sideASets) return 'side_b';
    return 'tied';
  },
};
