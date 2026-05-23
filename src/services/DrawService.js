import { supabase } from '../lib/supabase';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextPowerOf2(n) { let p = 1; while (p < n) p *= 2; return p; }

/**
 * Schedule round-robin matches using circle method.
 * Returns match pairs as [[idx_a, idx_b], ...] ordered so
 * no player plays 3+ in a row.
 */
function circleSchedule(n) {
  if (n < 2) return [];
  const items = [...Array(n).keys()];
  if (n % 2 !== 0) items.push(-1);
  const total = items.length;
  const rounds = [];
  for (let r = 0; r < total - 1; r++) {
    const round = [];
    for (let i = 0; i < total / 2; i++) {
      const a = items[i], b = items[total - 1 - i];
      if (a !== -1 && b !== -1 && a < n && b < n) {
        round.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    rounds.push(round);
    const last = items.pop();
    items.splice(1, 0, last);
  }
  return rounds;
}

/**
 * Build group assignments from player list.
 * Returns array of arrays: [[p1,p2,p3,p4], [p5,p6,p7,p8], ...]
 */
function distributeIntoGroups(participants, groupSize) {
  const n = participants.length;
  let numGroups = Math.max(1, Math.floor(n / groupSize));
  if (n - numGroups * groupSize >= groupSize) numGroups++;
  const assignments = [];
  let idx = 0;
  for (let g = 0; g < numGroups; g++) {
    let size = Math.floor(n / numGroups);
    if (g < n % numGroups) size++;
    assignments.push(participants.slice(idx, idx + size));
    idx += size;
  }
  return assignments;
}

export const DrawService = {
  // ── Generate Draw ──
  async generate(eventId) {
    const { data: event, error: eventError } = await supabase
      .from('events').select('*').eq('id', eventId).single();
    if (eventError) throw eventError;

    const { data: registrations, error: regError } = await supabase
      .from('player_registrations').select('id, player_id, partner_id, event_id').eq('event_id', eventId);
    if (regError) throw regError;

    const playerIds = new Set();
    registrations.forEach(r => { if (r.player_id) playerIds.add(r.player_id); if (r.partner_id) playerIds.add(r.partner_id); });
    const { data: playerRecords } = await supabase.from('players').select('id, name').in('id', Array.from(playerIds));
    const playerMap = new Map((playerRecords || []).map(p => [p.id, p]));

    let participants;
    if (event.type === 'singles') {
      participants = registrations.map(r => ({
        playerIds: [r.player_id],
        label: playerMap.get(r.player_id)?.name || 'Unknown',
      }));
    } else {
      const seen = new Set();
      const pairList = [];
      for (const r of registrations) {
        if (seen.has(r.player_id)) continue;
        seen.add(r.player_id);
        if (r.partner_id && !seen.has(r.partner_id)) {
          seen.add(r.partner_id);
          pairList.push({
            playerIds: [r.player_id, r.partner_id],
            label: `${playerMap.get(r.player_id)?.name || '?'} & ${playerMap.get(r.partner_id)?.name || '?'}`,
          });
        } else if (!r.partner_id) {
          pairList.push({ playerIds: [r.player_id], label: playerMap.get(r.player_id)?.name || '?' });
        }
      }
      participants = pairList;
    }

    participants = shuffle(participants);

    let result;
    if (event.format === 'round_robin') result = await this._generateRoundRobin(event, participants);
    else if (event.format === 'elimination') result = await this._generateElimination(event, participants);
    else if (event.format === 'group_to_knockout') result = await this._generateGroupToKnockout(event, participants);

    await supabase.from('events').update({ status: 'draw_generated' }).eq('id', eventId);
    return result;
  },

  // ── Round Robin ──
  async _generateRoundRobin(event, participants) {
    const groupSize = event.group_size || 4;
    const assignments = distributeIntoGroups(participants, groupSize);
    const groups = [];

    for (let g = 0; g < assignments.length; g++) {
      const groupParticipants = assignments[g];
      const groupName = `Group ${String.fromCharCode(65 + g)}`;
      const { data: group, error } = await supabase
        .from('groups').insert({ event_id: event.id, name: groupName }).select().single();
      if (error) throw error;

      const rounds = circleSchedule(groupParticipants.length);
      const matches = [];
      for (const round of rounds) {
        for (const [a, b] of round) {
          matches.push({
            event_id: event.id, group_id: group.id, stage: 'group',
            side_a: groupParticipants[a].playerIds,
            side_b: groupParticipants[b].playerIds,
            status: 'pending',
          });
        }
      }
      const { data: createdMatches, error: matchError } = await supabase
        .from('matches').insert(matches).select();
      if (matchError) throw matchError;
      groups.push({ group, participants: groupParticipants, matches: createdMatches });
    }
    return { groups };
  },

  // ── Elimination ──
  async _generateElimination(event, participants) {
    const n = participants.length;
    const bracketSize = nextPowerOf2(n);
    const stageMap = { 2: 'final', 4: 'semifinal', 8: 'quarterfinal', 16: 'round_of_16', 32: 'round_of_32' };
    const firstRoundStage = stageMap[bracketSize] || 'round_of_32';
    const stages = Object.entries(stageMap).filter(([size]) => parseInt(size) <= bracketSize)
      .sort(([a], [b]) => parseInt(b) - parseInt(a)).map(([, stage]) => stage);

    const firstRoundMatches = [];
    let position = 1;
    const withByes = [...participants];
    while (withByes.length < bracketSize) withByes.push(null);
    for (let i = 0; i < bracketSize; i += 2) {
      const sideA = withByes[i], sideB = withByes[i + 1];
      firstRoundMatches.push({
        event_id: event.id, stage: firstRoundStage, bracket_position: position++,
        side_a: sideA ? sideA.playerIds : null, side_b: sideB ? sideB.playerIds : null, status: 'pending',
        ...((!sideA || !sideB) && sideA ? { winner: 'side_a', status: 'locked' } : {}),
        ...((!sideA || !sideB) && sideB ? { winner: 'side_b', status: 'locked' } : {}),
      });
    }
    const { data: round1, error: r1Error } = await supabase.from('matches').insert(firstRoundMatches).select();
    if (r1Error) throw r1Error;

    let previousRound = round1;
    const allMatches = [...round1];
    for (let stageIdx = 1; stageIdx < stages.length; stageIdx++) {
      const stage = stages[stageIdx];
      const roundMatches = [];
      let pos = 1;
      for (let i = 0; i < previousRound.length; i += 2) {
        roundMatches.push({
          event_id: event.id, stage, bracket_position: pos++,
          source_match_a: previousRound[i].id, source_match_b: previousRound[i + 1]?.id || null, status: 'pending',
        });
      }
      const { data: roundData, error } = await supabase.from('matches').insert(roundMatches).select();
      if (error) throw error;
      previousRound = roundData;
      allMatches.push(...roundData);
    }
    return { bracket: allMatches };
  },

  // ── Group → Knockout ──
  async _generateGroupToKnockout(event, participants) {
    const rrResult = await this._generateRoundRobin(event, participants);
    return { groups: rrResult.groups, knockoutPending: true };
  },

  // ── Get Draw ──
  async getDrawForEvent(eventId) {
    const groups = await supabase.from('groups').select('*').eq('event_id', eventId).order('name');
    const matches = await supabase.from('matches').select('*').eq('event_id', eventId).order('stage').order('bracket_position');
    return { groups: groups.data || [], matches: matches.data || [] };
  },

  // ── Save Staged Group Changes ──
  // Takes the new groupPlayerMap { groupId: [playerId, ...] } and rebuilds
  // all group-stage matches from scratch for the given groups.
  async saveGroupChanges(eventId, groupPlayerMap, groupsToDelete) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    // 1. Delete all group-stage matches for this event
    await supabase.from('matches').delete().eq('event_id', eventId).eq('stage', 'group');

    // 2. Delete empty groups
    for (const gid of (groupsToDelete || [])) {
      await supabase.from('groups').delete().eq('id', gid);
    }

    // 3. Create new groups if needed and rebuild matches
    for (const [groupId, playerIds] of Object.entries(groupPlayerMap)) {
      if (playerIds.length < 2) continue; // skip groups with 0-1 players

      // Build participants as singles (each ID is a solo array)
      const participants = playerIds.map(pid => ({ playerIds: [pid] }));
      const rounds = circleSchedule(participants.length);
      const matches = [];
      for (const round of rounds) {
        for (const [a, b] of round) {
          matches.push({
            event_id: eventId, group_id: groupId, stage: 'group',
            side_a: participants[a].playerIds,
            side_b: participants[b].playerIds,
            status: 'pending',
          });
        }
      }
      if (matches.length > 0) {
        const { error } = await supabase.from('matches').insert(matches);
        if (error) throw error;
      }
    }
  },

  // ── Lock Check ──
  async isDrawLocked(eventId) {
    const { data } = await supabase.from('matches').select('id').eq('event_id', eventId)
      .in('status', ['in_progress', 'finished', 'locked']).limit(1);
    return data && data.length > 0;
  },

  // ── Clear Draw ──
  async clearDraw(eventId) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');
    await supabase.from('matches').delete().eq('event_id', eventId);
    await supabase.from('groups').delete().eq('event_id', eventId);
    await supabase.from('events').update({ status: 'draft' }).eq('id', eventId);
  },
};