import { supabase } from '../lib/supabase';

// ── Utility Functions ───────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Round-robin schedule using circle method — returns rounds of pairs */
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
      if (a !== -1 && b !== -1 && a < n && b < n) round.push([Math.min(a, b), Math.max(a, b)]);
    }
    rounds.push(round);
    const last = items.pop();
    items.splice(1, 0, last);
  }
  return rounds;
}

/** Distribute participants into groups respecting targetSize (min group size 3) */
function distributeIntoGroups(participants, targetSize = 4) {
  const n = participants.length;
  if (n <= Math.max(5, targetSize + 1)) return [participants];

  const numGroups = Math.max(1, Math.round(n / targetSize));
  const baseSize = Math.floor(n / numGroups);
  const extras = n % numGroups;

  const assignments = [];
  let idx = 0;
  for (let i = 0; i < numGroups; i++) {
    const size = baseSize + (i < extras ? 1 : 0);
    assignments.push(participants.slice(idx, idx + size));
    idx += size;
  }

  // Merge any group smaller than 3 into its neighbor
  for (let i = assignments.length - 1; i >= 0; i--) {
    if (assignments[i].length < 3 && assignments.length > 1) {
      const mergeTarget = i > 0 ? i - 1 : i + 1;
      assignments[mergeTarget].push(...assignments[i]);
      assignments.splice(i, 1);
    }
  }
  return assignments;
}

/** Separate previously-grouped players into different new groups */
function distributeWithCrossover(participants, targetSize, previousGroupMap) {
  if (!previousGroupMap || previousGroupMap.size === 0) {
    return distributeIntoGroups(shuffle(participants), targetSize);
  }
  const groups = distributeIntoGroups(participants, targetSize);
  if (groups.length <= 1) return groups;

  for (let attempts = 0; attempts < 50; attempts++) {
    let swapped = false;
    for (let g = 0; g < groups.length && !swapped; g++) {
      for (let i = 0; i < groups[g].length && !swapped; i++) {
        for (let j = i + 1; j < groups[g].length && !swapped; j++) {
          const kI = participantKey(groups[g][i]), kJ = participantKey(groups[g][j]);
          if (previousGroupMap.get(kI) === previousGroupMap.get(kJ)) {
            for (let og = 0; og < groups.length && !swapped; og++) {
              if (og === g) continue;
              for (let ok = 0; ok < groups[og].length && !swapped; ok++) {
                const kK = participantKey(groups[og][ok]);
                const clashG = groups[g].some((p, pi) => pi !== j && previousGroupMap.get(participantKey(p)) === previousGroupMap.get(kK));
                const clashOG = groups[og].some((p, pi) => pi !== ok && previousGroupMap.get(participantKey(p)) === previousGroupMap.get(kJ));
                if (!clashG && !clashOG) {
                  [groups[g][j], groups[og][ok]] = [groups[og][ok], groups[g][j]];
                  swapped = true;
                }
              }
            }
          }
        }
      }
    }
    if (!swapped) break;
  }
  return groups;
}

function participantKey(p) { return (p.playerIds || p).slice().sort().join(','); }

function getMatchPoints(match) {
  const sets = match.score_data?.sets || [];
  let aPoints = 0, bPoints = 0;
  for (const set of sets) { aPoints += set.side_a_points || 0; bPoints += set.side_b_points || 0; }
  return { aPoints, bPoints };
}

function arraysEqual(a, b) {
  if (!a || !b) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** Interleave matches from multiple groups by round */
function interleaveMatches(groupMatchArrays) {
  const maxLen = Math.max(...groupMatchArrays.map(g => g.length));
  const result = [];
  for (let r = 0; r < maxLen; r++) {
    for (const gMatches of groupMatchArrays) {
      if (r < gMatches.length) result.push(gMatches[r]);
    }
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
export const DrawService = {

  // ── Stage CRUD ────────────────────────────────────────────

  async getStages(eventId) {
    const { data, error } = await supabase.from('event_stages').select('*').eq('event_id', eventId).order('stage_number');
    if (error) throw error;
    return data || [];
  },

  async createStage(eventId, stageNumber, stageType, config = {}) {
    const { data, error } = await supabase.from('event_stages')
      .insert({ event_id: eventId, stage_number: stageNumber, stage_type: stageType, config }).select().single();
    if (error) throw error;
    return data;
  },

  async updateStageConfig(stageId, config) {
    const { data, error } = await supabase.from('event_stages').update({ config }).eq('id', stageId).select().single();
    if (error) throw error;
    return data;
  },

  async deleteStage(stageId) {
    await supabase.from('matches').delete().eq('stage_id', stageId);
    await supabase.from('groups').delete().eq('stage_id', stageId);
    await supabase.from('stage_byes').delete().eq('stage_id', stageId);
    const { error } = await supabase.from('event_stages').delete().eq('id', stageId);
    if (error) throw error;
  },

  async setStageStatus(stageId, status) {
    const { error } = await supabase.from('event_stages').update({ status }).eq('id', stageId);
    if (error) throw error;
  },

  // ── Byes ──────────────────────────────────────────────────

  async getStageByes(stageId) {
    const { data, error } = await supabase.from('stage_byes').select('*').eq('stage_id', stageId);
    if (error) throw error;
    return data || [];
  },

  async addBye(stageId, playerId, partnerId = null) {
    const { data, error } = await supabase.from('stage_byes')
      .insert({ stage_id: stageId, player_id: playerId, partner_id: partnerId }).select().single();
    if (error) throw error;
    return data;
  },

  async removeBye(byeId) {
    const { error } = await supabase.from('stage_byes').delete().eq('id', byeId);
    if (error) throw error;
  },

  // ── Participants ──────────────────────────────────────────

  async getParticipants(eventId) {
    const { data: event } = await supabase.from('events').select('type').eq('id', eventId).single();
    const { data: regs } = await supabase.from('player_registrations').select('player_id, partner_id').eq('event_id', eventId);
    const allIds = new Set();
    (regs || []).forEach(r => { if (r.player_id) allIds.add(r.player_id); if (r.partner_id) allIds.add(r.partner_id); });
    const { data: players } = await supabase.from('players').select('id, name').in('id', [...allIds]);
    const pMap = new Map((players || []).map(p => [p.id, p]));

    return (regs || []).map(r => {
      if (event.type === 'doubles' && r.partner_id) {
        return { playerIds: [r.player_id, r.partner_id], label: (pMap.get(r.player_id)?.name || '?') + ' & ' + (pMap.get(r.partner_id)?.name || '?') };
      }
      return { playerIds: [r.player_id], label: pMap.get(r.player_id)?.name || '?' };
    });
  },

  async getStageParticipants(eventId, stageNumber, stages) {
    if (stageNumber === 1) {
      const allParticipants = await this.getParticipants(eventId);
      const stage1 = stages.find(s => s.stage_number === 1);
      if (!stage1) return allParticipants;
      const byes = await this.getStageByes(stage1.id);
      const byeKeys = new Set(byes.map(b => b.partner_id ? [b.player_id, b.partner_id].sort().join(',') : b.player_id));
      return allParticipants.filter(p => !byeKeys.has(participantKey(p)));
    }

    const prevStage = stages.find(s => s.stage_number === stageNumber - 1);
    if (!prevStage) return [];
    const advancing = await this.getAdvancingParticipants(prevStage);
    const byes = await this.getStageByes(prevStage.id);
    const byeParticipants = byes.map(b => ({
      playerIds: b.partner_id ? [b.player_id, b.partner_id] : [b.player_id],
      label: 'Bye', fromBye: true,
    }));
    const currentStage = stages.find(s => s.stage_number === stageNumber);
    let currentByes = [];
    if (currentStage) currentByes = await this.getStageByes(currentStage.id);
    const currentByeKeys = new Set(currentByes.map(b => b.partner_id ? [b.player_id, b.partner_id].sort().join(',') : b.player_id));

    const allForStage = [...advancing, ...byeParticipants].filter(p => !currentByeKeys.has(participantKey(p)));
    const allIds = new Set();
    allForStage.forEach(p => p.playerIds.forEach(id => allIds.add(id)));
    if (allIds.size > 0) {
      const { data: players } = await supabase.from('players').select('id, name').in('id', [...allIds]);
      const pMap = new Map((players || []).map(p => [p.id, p]));
      allForStage.forEach(p => { p.label = p.playerIds.map(id => pMap.get(id)?.name || '?').join(' & '); });
    }
    return allForStage;
  },

  // ── Match Generation ──────────────────────────────────────

  async generateGroupStage(eventId, stage, participants, config) {
    const { games_per_match = 1, target_group_size = 4 } = config;

    let prevGroupMap = new Map();
    if (stage.stage_number > 1) {
      const { data: prevMatches } = await supabase.from('matches').select('side_a, side_b, group_id')
        .eq('event_id', eventId).not('group_id', 'is', null);
      for (const m of (prevMatches || [])) {
        if (m.side_a) prevGroupMap.set(m.side_a.sort().join(','), m.group_id);
        if (m.side_b) prevGroupMap.set(m.side_b.sort().join(','), m.group_id);
      }
    }

    const assignments = distributeWithCrossover(participants, target_group_size, prevGroupMap);
    const allGroupMatchArrays = [];
    const groups = [];

    for (let g = 0; g < assignments.length; g++) {
      const groupParticipants = assignments[g];
      const groupName = 'Group ' + String.fromCharCode(65 + g);
      const { data: group, error } = await supabase.from('groups')
        .insert({ event_id: eventId, name: groupName, stage_id: stage.id }).select().single();
      if (error) throw error;

      const rounds = circleSchedule(groupParticipants.length);
      const groupMatches = [];
      for (const round of rounds) {
        for (const [a, b] of round) {
          groupMatches.push({
            event_id: eventId, group_id: group.id, stage: 'group', stage_id: stage.id,
            side_a: groupParticipants[a].playerIds, side_b: groupParticipants[b].playerIds,
            games_per_match, status: 'pending',
          });
        }
      }
      allGroupMatchArrays.push(groupMatches);
      groups.push({ group, participants: groupParticipants });
    }

    // Interleave matches across groups
    const interleaved = interleaveMatches(allGroupMatchArrays);
    if (interleaved.length > 0) {
      const { error: mErr } = await supabase.from('matches').insert(interleaved);
      if (mErr) throw mErr;
    }
    return { groups };
  },

  async generateRoundRobin(eventId, stage, participants, config) {
    const { games_per_match = 1 } = config;
    const rounds = circleSchedule(participants.length);
    const matches = [];
    for (const round of rounds) {
      for (const [a, b] of round) {
        matches.push({
          event_id: eventId, stage: 'round_robin', stage_id: stage.id,
          side_a: participants[a].playerIds, side_b: participants[b].playerIds,
          games_per_match, status: 'pending',
        });
      }
    }
    if (matches.length > 0) {
      const { error } = await supabase.from('matches').insert(matches);
      if (error) throw error;
    }
    return { matches };
  },

  async generateElimination(eventId, stage, participants, config) {
    const { games_per_match = 3, third_place_match = false } = config;
    const n = participants.length;
    if (n < 2) throw new Error('Need at least 2 participants');
    if (![2, 4, 8].includes(n)) throw new Error('Elimination requires 2, 4, or 8 participants (got ' + n + ')');

    const allMatches = [];

    if (n === 2) {
      const { data } = await supabase.from('matches').insert({
        event_id: eventId, stage: 'final', stage_id: stage.id, bracket_position: 1,
        side_a: participants[0].playerIds, side_b: participants[1].playerIds,
        games_per_match, status: 'pending',
      }).select();
      allMatches.push(...data);
    } else if (n === 4) {
      const semiRows = [
        { side_a: participants[0].playerIds, side_b: participants[3].playerIds, bracket_position: 1 },
        { side_a: participants[1].playerIds, side_b: participants[2].playerIds, bracket_position: 2 },
      ].map(s => ({ event_id: eventId, stage: 'semifinal', stage_id: stage.id, ...s, games_per_match, status: 'pending' }));
      const { data: semiData } = await supabase.from('matches').insert(semiRows).select();
      allMatches.push(...semiData);

      const { data: finalData } = await supabase.from('matches').insert({
        event_id: eventId, stage: 'final', stage_id: stage.id, bracket_position: 1,
        source_match_a: semiData[0].id, source_match_b: semiData[1].id,
        games_per_match, status: 'pending',
      }).select();
      allMatches.push(...finalData);

      if (third_place_match) {
        const { data: tpData } = await supabase.from('matches').insert({
          event_id: eventId, stage: 'third_place', stage_id: stage.id, bracket_position: 1,
          source_match_a: semiData[0].id, source_match_b: semiData[1].id,
          games_per_match, status: 'pending',
        }).select();
        allMatches.push(...tpData);
      }
    } else if (n === 8) {
      const qPairs = [[0,7],[1,6],[2,5],[3,4]];
      const qRows = qPairs.map(([a, b], i) => ({
        event_id: eventId, stage: 'quarterfinal', stage_id: stage.id, bracket_position: i + 1,
        side_a: participants[a].playerIds, side_b: participants[b].playerIds,
        games_per_match: 1, status: 'pending',
      }));
      const { data: qData } = await supabase.from('matches').insert(qRows).select();
      allMatches.push(...qData);

      const semiRows = [
        { source_match_a: qData[0].id, source_match_b: qData[1].id, bracket_position: 1 },
        { source_match_a: qData[2].id, source_match_b: qData[3].id, bracket_position: 2 },
      ].map(s => ({ event_id: eventId, stage: 'semifinal', stage_id: stage.id, ...s, games_per_match, status: 'pending' }));
      const { data: semiData } = await supabase.from('matches').insert(semiRows).select();
      allMatches.push(...semiData);

      const { data: finalData } = await supabase.from('matches').insert({
        event_id: eventId, stage: 'final', stage_id: stage.id, bracket_position: 1,
        source_match_a: semiData[0].id, source_match_b: semiData[1].id,
        games_per_match, status: 'pending',
      }).select();
      allMatches.push(...finalData);

      if (third_place_match) {
        const { data: tpData } = await supabase.from('matches').insert({
          event_id: eventId, stage: 'third_place', stage_id: stage.id, bracket_position: 1,
          source_match_a: semiData[0].id, source_match_b: semiData[1].id,
          games_per_match, status: 'pending',
        }).select();
        allMatches.push(...tpData);
      }
    }
    return { bracket: allMatches };
  },

  async generateStageMatches(eventId, stage, participants) {
    await supabase.from('matches').delete().eq('stage_id', stage.id);
    await supabase.from('groups').delete().eq('stage_id', stage.id);
    const config = stage.config || {};
    if (stage.stage_type === 'group') return this.generateGroupStage(eventId, stage, shuffle(participants), config);
    if (stage.stage_type === 'round_robin') return this.generateRoundRobin(eventId, stage, shuffle(participants), config);
    if (stage.stage_type === 'elimination') return this.generateElimination(eventId, stage, participants, config);
  },

  // ── Group Editing ─────────────────────────────────────────

  /** Save edited groups: update group memberships and regenerate matches */
  async saveGroupEdits(eventId, stageId, groupAssignments, config) {
    // groupAssignments = [{ groupId, groupName, participants: [{playerIds},...] }, ...]
    // Validate
    for (const ga of groupAssignments) {
      if (ga.participants.length < 3) throw new Error(ga.groupName + ' has fewer than 3 participants');
    }

    // Delete old matches for this stage
    await supabase.from('matches').delete().eq('stage_id', stageId);

    // Delete old groups and recreate
    await supabase.from('groups').delete().eq('stage_id', stageId);

    const allGroupMatchArrays = [];
    const games_per_match = config.games_per_match || 1;

    for (const ga of groupAssignments) {
      const { data: group, error } = await supabase.from('groups')
        .insert({ event_id: eventId, name: ga.groupName, stage_id: stageId }).select().single();
      if (error) throw error;

      const rounds = circleSchedule(ga.participants.length);
      const groupMatches = [];
      for (const round of rounds) {
        for (const [a, b] of round) {
          groupMatches.push({
            event_id: eventId, group_id: group.id, stage: 'group', stage_id: stageId,
            side_a: ga.participants[a].playerIds, side_b: ga.participants[b].playerIds,
            games_per_match, status: 'pending',
          });
        }
      }
      allGroupMatchArrays.push(groupMatches);
    }

    const interleaved = interleaveMatches(allGroupMatchArrays);
    if (interleaved.length > 0) {
      const { error: mErr } = await supabase.from('matches').insert(interleaved);
      if (mErr) throw mErr;
    }
  },

  /** Swap two participants in elimination bracket */
  async swapEliminationParticipants(matchId1, side1, matchId2, side2) {
    const { data: m1 } = await supabase.from('matches').select('side_a, side_b').eq('id', matchId1).single();
    const { data: m2 } = await supabase.from('matches').select('side_a, side_b').eq('id', matchId2).single();
    const val1 = side1 === 'side_a' ? m1.side_a : m1.side_b;
    const val2 = side2 === 'side_a' ? m2.side_a : m2.side_b;
    await supabase.from('matches').update({ [side1]: val2 }).eq('id', matchId1);
    await supabase.from('matches').update({ [side2]: val1 }).eq('id', matchId2);
  },

  // ── Advancement ───────────────────────────────────────────

  /** Manually advance winners from completed elimination matches */
  async advanceEliminationWinners(stageId) {
    const { data: matches } = await supabase.from('matches').select('*').eq('stage_id', stageId);
    if (!matches) return;

    let advanced = 0;
    for (const m of matches) {
      if (!m.winner || (m.status !== 'finished' && m.status !== 'locked')) continue;
      const winnerSide = m.winner === 'side_a' ? m.side_a : m.side_b;
      const loserSide = m.winner === 'side_a' ? m.side_b : m.side_a;

      // Find matches that source from this match
      const { data: nextMatches } = await supabase.from('matches').select('id, stage, side_a, side_b, source_match_a, source_match_b')
        .eq('stage_id', stageId).or('source_match_a.eq.' + m.id + ',source_match_b.eq.' + m.id);

      for (const nm of (nextMatches || [])) {
        if (nm.stage === 'third_place') {
          // Third place gets losers
          if (nm.source_match_a === m.id && !arraysEqual(nm.side_a, loserSide)) {
            await supabase.from('matches').update({ side_a: loserSide }).eq('id', nm.id);
            advanced++;
          }
          if (nm.source_match_b === m.id && !arraysEqual(nm.side_b, loserSide)) {
            await supabase.from('matches').update({ side_b: loserSide }).eq('id', nm.id);
            advanced++;
          }
        } else {
          // Regular matches get winners
          if (nm.source_match_a === m.id && !arraysEqual(nm.side_a, winnerSide)) {
            await supabase.from('matches').update({ side_a: winnerSide }).eq('id', nm.id);
            advanced++;
          }
          if (nm.source_match_b === m.id && !arraysEqual(nm.side_b, winnerSide)) {
            await supabase.from('matches').update({ side_b: winnerSide }).eq('id', nm.id);
            advanced++;
          }
        }
      }
    }
    return advanced;
  },

  // ── Standings ─────────────────────────────────────────────

  async calculateStandings(stageId, groupId = null, manualRankings = null) {
    let query = supabase.from('matches').select('*').eq('stage_id', stageId);
    if (groupId) query = query.eq('group_id', groupId);
    const { data: matches } = await query;
    if (!matches || matches.length === 0) return [];

    const stats = new Map();
    const getOrCreate = (sideArr) => {
      const key = sideArr.slice().sort().join(',');
      if (!stats.has(key)) stats.set(key, { playerIds: sideArr, key, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0 });
      return stats.get(key);
    };

    for (const m of matches) {
      if (!m.side_a || !m.side_b) continue;
      if (m.status !== 'finished' && m.status !== 'locked') continue;
      const sA = getOrCreate(m.side_a), sB = getOrCreate(m.side_b);
      sA.played++; sB.played++;
      if (m.winner === 'side_a') { sA.wins++; sB.losses++; }
      else if (m.winner === 'side_b') { sB.wins++; sA.losses++; }
      const { aPoints, bPoints } = getMatchPoints(m);
      sA.pointsFor += aPoints; sA.pointsAgainst += bPoints;
      sB.pointsFor += bPoints; sB.pointsAgainst += aPoints;
    }

    for (const s of stats.values()) s.pointDiff = s.pointsFor - s.pointsAgainst;

    if (groupId) {
      const groupMatches = matches.filter(m => m.group_id === groupId);
      for (const m of groupMatches) { if (m.side_a) getOrCreate(m.side_a); if (m.side_b) getOrCreate(m.side_b); }
    }

    const sorted = [...stats.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return 0;
    });

    // Head-to-head for exactly 2 tied
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].wins === sorted[i + 1].wins && sorted[i].pointDiff === sorted[i + 1].pointDiff) {
        let tieEnd = i + 1;
        while (tieEnd + 1 < sorted.length && sorted[tieEnd + 1].wins === sorted[i].wins && sorted[tieEnd + 1].pointDiff === sorted[i].pointDiff) tieEnd++;
        if (tieEnd - i === 1) {
          const h2h = matches.find(m => m.winner && (
            (arraysEqual(m.side_a, sorted[i].playerIds) && arraysEqual(m.side_b, sorted[i + 1].playerIds)) ||
            (arraysEqual(m.side_a, sorted[i + 1].playerIds) && arraysEqual(m.side_b, sorted[i].playerIds))
          ));
          if (h2h) {
            const wIds = h2h.winner === 'side_a' ? h2h.side_a : h2h.side_b;
            if (arraysEqual(wIds, sorted[i + 1].playerIds)) [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
          }
        }
      }
    }

    // Apply manual rankings for remaining ties
    if (manualRankings) {
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].wins === sorted[i + 1].wins && sorted[i].pointDiff === sorted[i + 1].pointDiff) {
          const rI = manualRankings[sorted[i].key];
          const rJ = manualRankings[sorted[i + 1].key];
          if (rI != null && rJ != null && rI > rJ) {
            [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
          }
        }
      }
    }

    // Mark ties — always flag when underlying stats are equal (arrows stay visible)
    sorted.forEach((s, i) => {
      s.rank = i + 1;
      s.tied = false;
      if (i > 0 && sorted[i - 1].wins === s.wins && sorted[i - 1].pointDiff === s.pointDiff) {
        s.tied = true;
        sorted[i - 1].tied = true;
      }
    });

    return sorted;
  },

  async getAdvancingParticipants(stage) {
    const config = stage.config || {};
    const manualRankings = config.manual_rankings || {};
    const advancing = [];

    if (stage.stage_type === 'group') {
      const { data: groups } = await supabase.from('groups').select('*').eq('stage_id', stage.id).order('name');
      const advCfg = config.advancement_counts || {};
      const uniformCount = advCfg.uniform !== false ? (advCfg.count || 2) : null;
      for (const group of (groups || [])) {
        const count = uniformCount || advCfg[group.id] || 2;
        const standings = await this.calculateStandings(stage.id, group.id, manualRankings[group.id]);
        standings.slice(0, count).forEach(s => {
          advancing.push({ playerIds: s.playerIds, label: '', fromGroup: group.name, rank: s.rank });
        });
      }
    } else if (stage.stage_type === 'round_robin') {
      const count = config.advancement_count || 2;
      const standings = await this.calculateStandings(stage.id, null, manualRankings['_all']);
      standings.slice(0, count).forEach(s => { advancing.push({ playerIds: s.playerIds, label: '', rank: s.rank }); });
    }
    return advancing;
  },

  // ── Helpers ───────────────────────────────────────────────

  async isStageComplete(stageId) {
    const { data: pending } = await supabase.from('matches').select('id').eq('stage_id', stageId).in('status', ['pending', 'in_progress']).limit(1);
    const { data: any } = await supabase.from('matches').select('id').eq('stage_id', stageId).limit(1);
    return any && any.length > 0 && (!pending || pending.length === 0);
  },

  async getDrawForEvent(eventId) {
    const { data: groups } = await supabase.from('groups').select('*').eq('event_id', eventId).order('name');
    const { data: matches } = await supabase.from('matches').select('*').eq('event_id', eventId).order('stage_id').order('stage').order('bracket_position');
    const stages = await this.getStages(eventId);
    return { groups: groups || [], matches: matches || [], stages };
  },

  async clearEventDraw(eventId) {
    await supabase.from('matches').delete().eq('event_id', eventId);
    await supabase.from('groups').delete().eq('event_id', eventId);
    const stgs = await this.getStages(eventId);
    for (const s of stgs) await supabase.from('stage_byes').delete().eq('stage_id', s.id);
    await supabase.from('event_stages').delete().eq('event_id', eventId);
    await supabase.from('events').update({ status: 'draft' }).eq('id', eventId);
  },
};