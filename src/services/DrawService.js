// ─── DrawService ─────────────────────────────────────────────
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
 * Schedule round-robin matches within a group so no player plays 3+ in a row.
 * Uses a "circle method" for balanced round-robin scheduling.
 */
function scheduleGroupMatches(participants, eventId, groupId) {
  const n = participants.length;
  if (n < 2) return [];

  // Generate all pairwise matches
  const allPairs = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      allPairs.push([a, b]);
    }
  }

  // Use circle method to create balanced rounds
  // Each round, every player plays at most once
  const rounds = [];
  const items = [...Array(n).keys()]; // [0, 1, 2, ..., n-1]

  // For odd number of players, add a dummy (-1 = bye round)
  if (n % 2 !== 0) items.push(-1);
  const total = items.length;
  const numRounds = total - 1;

  for (let r = 0; r < numRounds; r++) {
    const round = [];
    for (let i = 0; i < total / 2; i++) {
      const a = items[i];
      const b = items[total - 1 - i];
      if (a !== -1 && b !== -1 && a < n && b < n) {
        round.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    rounds.push(round);
    // Rotate: fix first element, rotate the rest
    const last = items.pop();
    items.splice(1, 0, last);
  }

  // Flatten rounds into ordered match list
  // This guarantees no player plays more than 2 consecutive matches
  const scheduled = [];
  const usedPairs = new Set();
  for (const round of rounds) {
    for (const [a, b] of round) {
      const key = `${a}-${b}`;
      if (!usedPairs.has(key)) {
        usedPairs.add(key);
        scheduled.push({
          event_id: eventId,
          group_id: groupId,
          stage: 'group',
          side_a: participants[a].playerIds,
          side_b: participants[b].playerIds,
          status: 'pending',
        });
      }
    }
  }

  // Any pairs not yet scheduled (shouldn't happen with circle method, but safety net)
  for (const [a, b] of allPairs) {
    const key = `${a}-${b}`;
    if (!usedPairs.has(key)) {
      scheduled.push({
        event_id: eventId,
        group_id: groupId,
        stage: 'group',
        side_a: participants[a].playerIds,
        side_b: participants[b].playerIds,
        status: 'pending',
      });
    }
  }

  return scheduled;
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
      const partnerLookup = new Map();
      for (const r of registrations) { if (r.partner_id) partnerLookup.set(r.player_id, r.partner_id); }
      for (const r of registrations) {
        if (!partnerLookup.has(r.player_id)) {
          for (const [pid, partnerId] of partnerLookup.entries()) {
            if (partnerId === r.player_id) { partnerLookup.set(r.player_id, pid); break; }
          }
        }
      }
      const seen = new Set();
      const pairList = [];
      for (const r of registrations) {
        if (seen.has(r.player_id)) continue;
        const partnerId = partnerLookup.get(r.player_id);
        if (partnerId && !seen.has(partnerId)) {
          seen.add(r.player_id); seen.add(partnerId);
          pairList.push({ playerIds: [r.player_id, partnerId], label: `${playerMap.get(r.player_id)?.name || '?'} & ${playerMap.get(partnerId)?.name || '?'}` });
        } else if (!partnerId) {
          seen.add(r.player_id);
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

  // ── Round Robin with smart group distribution ──
  async _generateRoundRobin(event, participants) {
    const groupSize = event.group_size || 4;
    const n = participants.length;

    // Smart distribution: compute number of groups and distribute evenly
    // e.g., 41 players, group_size 4 → 11 groups (10×4 + 1×1 is bad)
    //   Instead: ceil(41/4) = 11 groups → distribute: 41/11 = 3.7
    //   So 8 groups of 4 and 3 groups of 3... OR
    //   Better: 10 groups of 4 and 1 group of 5 (minimize variance)
    //   Strategy: numGroups = floor(n / groupSize), remainder gets distributed
    let numGroups = Math.floor(n / groupSize);
    let remainder = n - numGroups * groupSize;

    if (remainder > 0) {
      // If remainder is too small (e.g., 1 player alone), distribute to existing groups
      if (numGroups === 0) {
        numGroups = 1; // All players in one group
        remainder = 0;
      } else if (remainder < Math.ceil(groupSize / 2)) {
        // Distribute remainder across existing groups (making some groups groupSize+1)
        // Keep numGroups the same, remainder players get added to groups
      } else {
        // Create one more group for the remainder
        numGroups++;
        remainder = 0;
      }
    }

    // Distribute participants into groups
    const groupAssignments = [];
    let idx = 0;
    for (let g = 0; g < numGroups; g++) {
      // Base size for this group
      let size = Math.floor(n / numGroups);
      // Distribute the extra players (n % numGroups) across the first few groups
      if (g < n % numGroups) size++;
      groupAssignments.push(participants.slice(idx, idx + size));
      idx += size;
    }

    const groups = [];
    for (let g = 0; g < groupAssignments.length; g++) {
      const groupParticipants = groupAssignments[g];
      const groupName = `Group ${String.fromCharCode(65 + g)}`;

      const { data: group, error } = await supabase
        .from('groups').insert({ event_id: event.id, name: groupName }).select().single();
      if (error) throw error;

      // Use balanced scheduling
      const matches = scheduleGroupMatches(groupParticipants, event.id, group.id);

      const { data: createdMatches, error: matchError } = await supabase
        .from('matches').insert(matches).select();
      if (matchError) throw matchError;

      groups.push({ group, participants: groupParticipants, matches: createdMatches });
    }

    return { groups };
  },

  // ── Single Elimination ──
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

  // ── Swap Players ──
  async swapPlayers(eventId, matchIdA, sideA, matchIdB, sideB) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    const { data: matchA } = await supabase.from('matches').select('*').eq('id', matchIdA).single();
    const { data: matchB } = await supabase.from('matches').select('*').eq('id', matchIdB).single();

    const playersA = matchA[sideA];
    const playersB = matchB[sideB];

    await supabase.from('matches').update({ [sideA]: playersB }).eq('id', matchIdA);
    await supabase.from('matches').update({ [sideB]: playersA }).eq('id', matchIdB);
  },

  // ── Move Player Between Groups ──
  async movePlayerToGroup(eventId, playerId, fromGroupId, toGroupId) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    // 1. Delete all matches involving this player in the source group
    const { data: fromMatches } = await supabase.from('matches').select('*')
      .eq('group_id', fromGroupId).eq('stage', 'group');

    const toDelete = (fromMatches || []).filter(m =>
      (m.side_a || []).includes(playerId) || (m.side_b || []).includes(playerId)
    );
    if (toDelete.length > 0) {
      await supabase.from('matches').delete().in('id', toDelete.map(m => m.id));
    }

    // 2. Get existing players in the target group
    const { data: toMatches } = await supabase.from('matches').select('*')
      .eq('group_id', toGroupId).eq('stage', 'group');

    const existingPlayerIds = new Set();
    (toMatches || []).forEach(m => {
      (m.side_a || []).forEach(id => existingPlayerIds.add(id));
      (m.side_b || []).forEach(id => existingPlayerIds.add(id));
    });

    // 3. Create matches between the moved player and every existing player in target group
    const newMatches = [];
    for (const existingId of existingPlayerIds) {
      newMatches.push({
        event_id: eventId, group_id: toGroupId, stage: 'group',
        side_a: [playerId], side_b: [existingId], status: 'pending',
      });
    }
    if (newMatches.length > 0) {
      await supabase.from('matches').insert(newMatches);
    }
  },

  // ── Remove Player From Group ──
  async removePlayerFromGroup(eventId, playerId, groupId) {
    const locked = await this.isDrawLocked(eventId);
    if (locked) throw new Error('Draw is locked — matches have started');

    const { data: matches } = await supabase.from('matches').select('*')
      .eq('group_id', groupId).eq('stage', 'group');

    const toDelete = (matches || []).filter(m =>
      (m.side_a || []).includes(playerId) || (m.side_b || []).includes(playerId)
    );
    if (toDelete.length > 0) {
      await supabase.from('matches').delete().in('id', toDelete.map(m => m.id));
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