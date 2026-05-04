// ─── DrawService ─────────────────────────────────────────────
// Generates and manages draws (groups/brackets) for events.
// Swap this file to change data providers.

import { supabase } from '../lib/supabase';

// ── Utility: Shuffle array (Fisher-Yates) ────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Utility: Calculate byes for elimination ──────────────────
function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export const DrawService = {
  // ── Generate Draw ──────────────────────────────────────────
  async generate(eventId) {
    // 1. Get event config
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();
    if (eventError) throw eventError;

    // 2. Get registered players (avoid ambiguous FK join)
    const { data: registrations, error: regError } = await supabase
      .from('player_registrations')
      .select('id, player_id, partner_id, event_id')
      .eq('event_id', eventId);
    if (regError) throw regError;

    // Fetch all players separately for name lookups
    const playerIds = new Set();
    registrations.forEach(r => {
      if (r.player_id) playerIds.add(r.player_id);
      if (r.partner_id) playerIds.add(r.partner_id);
    });
    const { data: playerRecords } = await supabase
      .from('players')
      .select('id, name')
      .in('id', Array.from(playerIds));
    const playerMap = new Map((playerRecords || []).map(p => [p.id, p]));

    // Build participant list (singles: individual players, doubles: pairs)
    let participants;
    if (event.type === 'singles') {
      participants = registrations.map(r => ({
        playerIds: [r.player_id],
        label: playerMap.get(r.player_id)?.name || 'Unknown',
      }));
    } else {
      // Doubles: build pairs from registrations
      // First, build a map of player_id -> partner_id from all registrations
      const partnerLookup = new Map();
      for (const r of registrations) {
        if (r.partner_id) {
          partnerLookup.set(r.player_id, r.partner_id);
        }
      }

      // Also check the reverse: if A has partner_id=B but B doesn't have partner_id=A,
      // fill it in from the other side
      for (const r of registrations) {
        if (!partnerLookup.has(r.player_id)) {
          // Check if someone else listed this player as their partner
          for (const [pid, partnerId] of partnerLookup.entries()) {
            if (partnerId === r.player_id) {
              partnerLookup.set(r.player_id, pid);
              break;
            }
          }
        }
      }

      // Build unique pairs, skipping players already accounted for
      const seen = new Set();
      const pairList = [];

      for (const r of registrations) {
        if (seen.has(r.player_id)) continue;

        const partnerId = partnerLookup.get(r.player_id);
        if (partnerId && !seen.has(partnerId)) {
          // This is a proper pair
          seen.add(r.player_id);
          seen.add(partnerId);
          const name1 = playerMap.get(r.player_id)?.name || 'Unknown';
          const name2 = playerMap.get(partnerId)?.name || 'Unknown';
          pairList.push({
            playerIds: [r.player_id, partnerId],
            label: `${name1} & ${name2}`,
          });
        } else if (!partnerId) {
          // Unpaired player — include as solo (shouldn't happen if admin paired everyone)
          seen.add(r.player_id);
          pairList.push({
            playerIds: [r.player_id],
            label: playerMap.get(r.player_id)?.name || 'Unknown',
          });
        }
      }

      participants = pairList;
    }

    // Shuffle randomly
    participants = shuffle(participants);

    // 3. Generate based on format
    let result;
    if (event.format === 'round_robin') {
      result = await this._generateRoundRobin(event, participants);
    } else if (event.format === 'elimination') {
      result = await this._generateElimination(event, participants);
    } else if (event.format === 'group_to_knockout') {
      result = await this._generateGroupToKnockout(event, participants);
    }

    // 4. Update event status
    await supabase
      .from('events')
      .update({ status: 'draw_generated' })
      .eq('id', eventId);

    return result;
  },

  // ── Round Robin ────────────────────────────────────────────
  async _generateRoundRobin(event, participants) {
    const groupSize = event.group_size || 4;
    const groups = [];

    // Split into groups
    for (let i = 0; i < participants.length; i += groupSize) {
      const groupParticipants = participants.slice(i, i + groupSize);
      const groupName = `Group ${String.fromCharCode(65 + groups.length)}`;

      // Create group record
      const { data: group, error } = await supabase
        .from('groups')
        .insert({ event_id: event.id, name: groupName })
        .select()
        .single();
      if (error) throw error;

      // Generate all pairwise matches within the group
      const matches = [];
      for (let a = 0; a < groupParticipants.length; a++) {
        for (let b = a + 1; b < groupParticipants.length; b++) {
          matches.push({
            event_id: event.id,
            group_id: group.id,
            stage: 'group',
            side_a: groupParticipants[a].playerIds,
            side_b: groupParticipants[b].playerIds,
            status: 'pending',
          });
        }
      }

      const { data: createdMatches, error: matchError } = await supabase
        .from('matches')
        .insert(matches)
        .select();
      if (matchError) throw matchError;

      groups.push({ group, participants: groupParticipants, matches: createdMatches });
    }

    return { groups };
  },

  // ── Single Elimination ─────────────────────────────────────
  async _generateElimination(event, participants) {
    const n = participants.length;
    const bracketSize = nextPowerOf2(n);

    // Determine the stage name for the first round
    const stageMap = {
      2: 'final',
      4: 'semifinal',
      8: 'quarterfinal',
      16: 'round_of_16',
      32: 'round_of_32',
    };
    const firstRoundStage = stageMap[bracketSize] || 'round_of_32';
    const stages = Object.entries(stageMap)
      .filter(([size]) => parseInt(size) <= bracketSize)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .map(([, stage]) => stage);

    // Create first round matches
    const firstRoundMatches = [];
    let position = 1;

    // Place byes: participants at the end get byes
    const withByes = [...participants];
    while (withByes.length < bracketSize) {
      withByes.push(null); // null = bye
    }

    for (let i = 0; i < bracketSize; i += 2) {
      const sideA = withByes[i];
      const sideB = withByes[i + 1];

      firstRoundMatches.push({
        event_id: event.id,
        stage: firstRoundStage,
        bracket_position: position++,
        side_a: sideA ? sideA.playerIds : null,
        side_b: sideB ? sideB.playerIds : null,
        status: 'pending',
        // If one side is a bye, auto-advance the other
        ...((!sideA || !sideB) && sideA ? { winner: 'side_a', status: 'locked' } : {}),
        ...((!sideA || !sideB) && sideB ? { winner: 'side_b', status: 'locked' } : {}),
      });
    }

    const { data: round1, error: r1Error } = await supabase
      .from('matches')
      .insert(firstRoundMatches)
      .select();
    if (r1Error) throw r1Error;

    // Create subsequent rounds with source_match references
    let previousRound = round1;
    const allMatches = [...round1];

    for (let stageIdx = 1; stageIdx < stages.length; stageIdx++) {
      const stage = stages[stageIdx];
      const roundMatches = [];
      let pos = 1;

      for (let i = 0; i < previousRound.length; i += 2) {
        roundMatches.push({
          event_id: event.id,
          stage,
          bracket_position: pos++,
          source_match_a: previousRound[i].id,
          source_match_b: previousRound[i + 1]?.id || null,
          status: 'pending',
        });
      }

      const { data: roundData, error } = await supabase
        .from('matches')
        .insert(roundMatches)
        .select();
      if (error) throw error;

      previousRound = roundData;
      allMatches.push(...roundData);
    }

    return { bracket: allMatches };
  },

  // ── Group → Knockout ───────────────────────────────────────
  async _generateGroupToKnockout(event, participants) {
    // First generate groups (round robin phase)
    const rrResult = await this._generateRoundRobin(event, participants);

    // The knockout bracket will be created after group stage completes
    // For now, create placeholder bracket matches with null sides
    // that reference "1st in Group A vs 2nd in Group B" etc.

    return { groups: rrResult.groups, knockoutPending: true };
  },

  // ── Get Draw ───────────────────────────────────────────────
  async getDrawForEvent(eventId) {
    const groups = await supabase
      .from('groups')
      .select('*')
      .eq('event_id', eventId)
      .order('name');

    const matches = await supabase
      .from('matches')
      .select('*')
      .eq('event_id', eventId)
      .order('stage')
      .order('bracket_position');

    return {
      groups: groups.data || [],
      matches: matches.data || [],
    };
  },

  // ── Swap Players ───────────────────────────────────────────
  async swapPlayers(eventId, matchIdA, sideA, matchIdB, sideB) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    const { data: matchA } = await supabase
      .from('matches').select('*').eq('id', matchIdA).single();
    const { data: matchB } = await supabase
      .from('matches').select('*').eq('id', matchIdB).single();

    const playersA = matchA[sideA];
    const playersB = matchB[sideB];

    await supabase.from('matches').update({ [sideA]: playersB }).eq('id', matchIdA);
    await supabase.from('matches').update({ [sideB]: playersA }).eq('id', matchIdB);
  },

  // ── Lock Check ─────────────────────────────────────────────
  async isDrawLocked(eventId) {
    const { data } = await supabase
      .from('matches')
      .select('id')
      .eq('event_id', eventId)
      .in('status', ['in_progress', 'finished', 'locked'])
      .limit(1);

    return data && data.length > 0;
  },

  // ── Clear Draw (regenerate) ────────────────────────────────
  async clearDraw(eventId) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    // Delete all matches and groups for this event
    await supabase.from('matches').delete().eq('event_id', eventId);
    await supabase.from('groups').delete().eq('event_id', eventId);

    // Reset event status
    await supabase.from('events').update({ status: 'draft' }).eq('id', eventId);
  },
};