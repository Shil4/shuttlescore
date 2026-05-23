import { useState, useEffect, useCallback } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { DrawService } from '../../services/DrawService';
import { supabase } from '../../lib/supabase';
import './AdminComponents.css';
import './DrawManager.css';

export default function DrawManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [drawData, setDrawData] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [registrations, setRegistrations] = useState([]);

  // Partner pairing (doubles)
  const [pairs, setPairs] = useState([]);
  const [unpaired, setUnpaired] = useState([]);
  const [swapSource, setSwapSource] = useState(null);

  // ── Staging state ──
  // staged = { groupId: [playerId, ...] } — local copy of group assignments
  // null means not editing
  const [staged, setStaged] = useState(null);
  const [stagedNewGroups, setStagedNewGroups] = useState([]); // IDs of groups created during staging
  const [editMode, setEditMode] = useState(null); // 'swap' | 'move' | null
  const [selectedPlayer, setSelectedPlayer] = useState(null); // { playerId, groupId }

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try { const data = await TournamentService.getAll(); setTournaments(data); }
    catch (err) { setError('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament); setSelectedEvent(null); setDrawData(null); exitStaging();
    try {
      setLoading(true);
      const evts = await TournamentService.getEvents(tournament.id);
      setEvents(evts);
      if (allPlayers.length === 0) {
        const { data } = await supabase.from('players').select('*').order('name');
        setAllPlayers(data || []);
      }
    } catch (err) { setError('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };

  const loadRegs = useCallback(async (eventId) => {
    const { data } = await supabase.from('player_registrations')
      .select('id, player_id, partner_id, event_id').eq('event_id', eventId);
    setRegistrations(data || []);
    return data || [];
  }, []);

  const selectEvent = async (event) => {
    setSelectedEvent(event); setError(''); setSuccess(''); exitStaging();
    const regs = await loadRegs(event.id);
    await loadDraw(event.id, regs);
    if (event.type === 'doubles' || event.type === 'mixed_doubles') buildPairingState(regs);
  };

  const exitStaging = () => {
    setStaged(null); setStagedNewGroups([]); setEditMode(null); setSelectedPlayer(null);
  };

  const buildPairingState = (regs) => {
    const paired = [], unpairedList = [], seen = new Set();
    for (const reg of regs) {
      if (seen.has(reg.player_id)) continue;
      seen.add(reg.player_id);
      if (reg.partner_id) {
        seen.add(reg.partner_id);
        paired.push({ regId: reg.id, player1Id: reg.player_id, player2Id: reg.partner_id });
      } else {
        unpairedList.push({ regId: reg.id, playerId: reg.player_id });
      }
    }
    setPairs(paired); setUnpaired(unpairedList);
  };

  const loadDraw = async (eventId, regs) => {
    try {
      const data = await DrawService.getDrawForEvent(eventId);
      setDrawData(data);
    } catch (err) { setError('Failed to load draw: ' + err.message); }
  };

  // ── Helpers ──
  const playerName = (id) => !id ? 'BYE' : allPlayers.find(p => p.id === id)?.name || id.substring(0, 8);
  const sideLabel = (sideArr) => (!sideArr || sideArr.length === 0) ? 'TBD' : sideArr.map(playerName).join(' & ');
  const formatLabel = (f) => ({ round_robin: 'Round Robin', elimination: 'Elimination', group_to_knockout: 'Group → Knockout' }[f] || f);
  const stageLabel = (s) => ({ group: 'Group', round_of_32: 'R32', round_of_16: 'R16', quarterfinal: 'QF', semifinal: 'SF', final: 'Final' }[s] || s);

  const isDoubles = selectedEvent?.type === 'doubles' || selectedEvent?.type === 'mixed_doubles';
  const hasDrawn = drawData?.matches?.length > 0;
  const isLocked = selectedEvent?.status === 'in_progress' || selectedEvent?.status === 'completed';

  // Get players in a group from drawData (for display when NOT staging)
  const getGroupPlayersFromDraw = (groupId) => {
    if (!drawData) return [];
    const gMatches = drawData.matches.filter(m => m.group_id === groupId);
    const pIds = new Set();
    gMatches.forEach(m => { (m.side_a || []).forEach(id => pIds.add(id)); (m.side_b || []).forEach(id => pIds.add(id)); });
    return Array.from(pIds);
  };

  // Get group players — from staged if editing, from draw data otherwise
  const getGroupPlayers = (groupId) => {
    if (staged) return staged[groupId] || [];
    return getGroupPlayersFromDraw(groupId);
  };

  // ── Enter Staging ──
  const enterStaging = () => {
    if (!drawData || !drawData.groups) return;
    const map = {};
    drawData.groups.forEach(g => { map[g.id] = getGroupPlayersFromDraw(g.id); });
    setStaged(map);
    setStagedNewGroups([]);
    setEditMode(null);
    setSelectedPlayer(null);
    setSuccess('Editing mode — make changes then Save.');
  };

  // ── Staging: Swap ──
  const handlePlayerClick = (playerId, groupId) => {
    if (!staged) return;
    if (!editMode) return;

    if (editMode === 'swap') {
      if (!selectedPlayer) {
        setSelectedPlayer({ playerId, groupId });
        setSuccess(`Selected ${playerName(playerId)}. Click another player to swap.`);
      } else if (selectedPlayer.playerId === playerId) {
        setSelectedPlayer(null); setSuccess('Swap cancelled.');
      } else {
        // Perform swap in staged state
        const newStaged = { ...staged };
        const fromGroup = selectedPlayer.groupId;
        const toGroup = groupId;

        // Replace player A with player B in their respective groups
        newStaged[fromGroup] = newStaged[fromGroup].map(id => id === selectedPlayer.playerId ? playerId : id);
        newStaged[toGroup] = newStaged[toGroup].map(id => id === playerId ? selectedPlayer.playerId : id);

        setStaged(newStaged);
        setSelectedPlayer(null);
        setSuccess(`Swapped ${playerName(selectedPlayer.playerId)} ↔ ${playerName(playerId)}.`);
      }
    } else if (editMode === 'move') {
      if (!selectedPlayer) {
        setSelectedPlayer({ playerId, groupId });
        setSuccess(`Selected ${playerName(playerId)}. Click a group header to move them.`);
      } else if (selectedPlayer.playerId === playerId) {
        setSelectedPlayer(null); setSuccess('Move cancelled.');
      } else {
        // Clicking another player = change selection
        setSelectedPlayer({ playerId, groupId });
        setSuccess(`Selected ${playerName(playerId)}. Click a group header to move them.`);
      }
    }
  };

  // ── Staging: Move to group ──
  const handleGroupHeaderClick = (targetGroupId) => {
    if (!staged || editMode !== 'move' || !selectedPlayer) return;
    if (selectedPlayer.groupId === targetGroupId) return;

    const newStaged = { ...staged };
    // Remove from source
    newStaged[selectedPlayer.groupId] = newStaged[selectedPlayer.groupId].filter(id => id !== selectedPlayer.playerId);
    // Add to target
    newStaged[targetGroupId] = [...(newStaged[targetGroupId] || []), selectedPlayer.playerId];

    setStaged(newStaged);
    const targetName = drawData.groups.find(g => g.id === targetGroupId)?.name || 'new group';
    setSuccess(`Moved ${playerName(selectedPlayer.playerId)} → ${targetName}.`);
    setSelectedPlayer(null);
  };

  // ── Staging: Create Group ──
  const handleCreateGroup = async () => {
    if (!selectedEvent) return;
    const existingNames = (drawData.groups || []).map(g => g.name);
    let letter = 65;
    while (existingNames.includes(`Group ${String.fromCharCode(letter)}`)) letter++;
    const groupName = `Group ${String.fromCharCode(letter)}`;
    try {
      const { data: group, error: err } = await supabase
        .from('groups').insert({ event_id: selectedEvent.id, name: groupName }).select().single();
      if (err) throw err;
      // Add to local draw data
      setDrawData(prev => ({ ...prev, groups: [...(prev.groups || []), group] }));
      setStaged(prev => ({ ...prev, [group.id]: [] }));
      setStagedNewGroups(prev => [...prev, group.id]);
      setSuccess(`Created ${groupName}. Move players into it.`);
    } catch (err) { setError('Failed: ' + err.message); }
  };

  // ── Staging: Validate ──
  const validateStaged = () => {
    if (!staged) return [];
    const errors = [];
    const allGroupSizes = Object.values(staged).filter(arr => arr.length > 0).map(arr => arr.length);
    if (allGroupSizes.length === 0) { errors.push('No groups with players.'); return errors; }

    const minSize = Math.min(...allGroupSizes);
    const maxSize = Math.max(...allGroupSizes);
    if (maxSize - minSize > 1) {
      errors.push(`Group sizes vary too much (${minSize}–${maxSize}). Max difference is 1.`);
    }
    if (minSize < 3) {
      const small = Object.entries(staged).filter(([, arr]) => arr.length > 0 && arr.length < 3);
      small.forEach(([gid, arr]) => {
        const name = drawData.groups.find(g => g.id === gid)?.name || 'group';
        errors.push(`${name} has only ${arr.length} player(s) — need at least 3.`);
      });
    }
    // Check for empty groups (not newly created — those can be deleted)
    Object.entries(staged).forEach(([gid, arr]) => {
      if (arr.length === 0 && !stagedNewGroups.includes(gid)) {
        const name = drawData.groups.find(g => g.id === gid)?.name || 'group';
        errors.push(`${name} is empty — move players in or delete it.`);
      }
    });
    return errors;
  };

  // ── Staging: Save ──
  const handleSave = async () => {
    const errors = validateStaged();
    if (errors.length > 0) { setError(errors.join('\n')); return; }
    try {
      setError('');
      // Find groups to delete (empty + newly created empty ones)
      const groupsToDelete = Object.entries(staged)
        .filter(([, arr]) => arr.length === 0)
        .map(([gid]) => gid);

      const groupPlayerMap = {};
      Object.entries(staged).forEach(([gid, arr]) => {
        if (arr.length > 0) groupPlayerMap[gid] = arr;
      });

      await DrawService.saveGroupChanges(selectedEvent.id, groupPlayerMap, groupsToDelete);
      setSuccess('Draw saved!');
      exitStaging();
      const regs = await loadRegs(selectedEvent.id);
      await loadDraw(selectedEvent.id, regs);
    } catch (err) { setError('Save failed: ' + err.message); }
  };

  // ── Staging: Cancel ──
  const handleCancelStaging = async () => {
    // Delete any newly created groups that won't be used
    for (const gid of stagedNewGroups) {
      await supabase.from('groups').delete().eq('id', gid);
    }
    exitStaging();
    setSuccess('');
    const regs = await loadRegs(selectedEvent.id);
    await loadDraw(selectedEvent.id, regs);
  };

  // ── Partner Pairing ──
  const autoGeneratePairs = async () => {
    if (unpaired.length < 2) { setError('Need at least 2 unpaired.'); return; }
    setError('');
    const shuffled = [...unpaired].sort(() => Math.random() - 0.5);
    const newPairs = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      newPairs.push({ regId: shuffled[i].regId, player1Id: shuffled[i].playerId, player2Id: shuffled[i + 1].playerId });
    }
    const leftover = shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : [];
    try {
      for (const pair of newPairs) {
        await supabase.from('player_registrations').update({ partner_id: pair.player2Id }).eq('id', pair.regId);
        const partnerReg = registrations.find(r => r.player_id === pair.player2Id);
        if (partnerReg) await supabase.from('player_registrations').update({ partner_id: pair.player1Id }).eq('id', partnerReg.id);
      }
      setPairs([...pairs, ...newPairs]); setUnpaired(leftover);
      setSuccess(`Generated ${newPairs.length} pair(s).${leftover.length ? ' 1 left unpaired.' : ''}`);
      await loadRegs(selectedEvent.id);
    } catch (err) { setError('Failed to save pairs: ' + err.message); }
  };

  const handlePartnerSwap = async (targetPlayerId) => {
    if (!swapSource) return;
    const sourcePair = pairs[swapSource.pairIndex];
    const sourcePlayerId = swapSource.position === 1 ? sourcePair.player1Id : sourcePair.player2Id;
    if (sourcePlayerId === targetPlayerId) { setSwapSource(null); setSuccess(''); return; }
    try {
      const newPairs = [...pairs];
      const targetPairIndex = pairs.findIndex(p => p.player1Id === targetPlayerId || p.player2Id === targetPlayerId);
      const targetIsUnpaired = unpaired.some(u => u.playerId === targetPlayerId);
      if (targetPairIndex >= 0) {
        const targetPair = newPairs[targetPairIndex];
        const targetPosition = targetPair.player1Id === targetPlayerId ? 1 : 2;
        if (swapSource.position === 1) newPairs[swapSource.pairIndex] = { ...newPairs[swapSource.pairIndex], player1Id: targetPlayerId };
        else newPairs[swapSource.pairIndex] = { ...newPairs[swapSource.pairIndex], player2Id: targetPlayerId };
        if (targetPosition === 1) newPairs[targetPairIndex] = { ...newPairs[targetPairIndex], player1Id: sourcePlayerId };
        else newPairs[targetPairIndex] = { ...newPairs[targetPairIndex], player2Id: sourcePlayerId };
        await savePairToDb(newPairs[swapSource.pairIndex]);
        await savePairToDb(newPairs[targetPairIndex]);
      } else if (targetIsUnpaired) {
        if (swapSource.position === 1) newPairs[swapSource.pairIndex] = { ...newPairs[swapSource.pairIndex], player1Id: targetPlayerId };
        else newPairs[swapSource.pairIndex] = { ...newPairs[swapSource.pairIndex], player2Id: targetPlayerId };
        const newUnpaired = unpaired.filter(u => u.playerId !== targetPlayerId);
        const unpairedEntry = unpaired.find(u => u.playerId === targetPlayerId);
        newUnpaired.push({ regId: unpairedEntry.regId, playerId: sourcePlayerId });
        await savePairToDb(newPairs[swapSource.pairIndex]);
        setUnpaired(newUnpaired);
      }
      setPairs(newPairs); setSwapSource(null); setSuccess('Partners swapped.');
      await loadRegs(selectedEvent.id);
    } catch (err) { setError('Failed: ' + err.message); }
  };

  const savePairToDb = async (pair) => {
    await supabase.from('player_registrations').update({ partner_id: pair.player2Id })
      .eq('player_id', pair.player1Id).eq('event_id', selectedEvent.id);
    await supabase.from('player_registrations').update({ partner_id: pair.player1Id })
      .eq('player_id', pair.player2Id).eq('event_id', selectedEvent.id);
  };

  // ── Generate / Clear ──
  const handleGenerate = async () => {
    if (!selectedEvent) return;
    if (registrations.length < 2) { setError('Need at least 2 players.'); return; }
    if (isDoubles && unpaired.length > 1) { setError('Pair all players first.'); return; }
    if (hasDrawn) {
      if (!window.confirm('Clear existing draw and regenerate?')) return;
      try { await DrawService.clearDraw(selectedEvent.id); } catch (err) { setError(err.message); return; }
    }
    setGenerating(true); setError(''); setSuccess('');
    try {
      await DrawService.generate(selectedEvent.id);
      setSuccess('Draw generated! Click Edit to adjust groups.');
      const regs = await loadRegs(selectedEvent.id);
      await loadDraw(selectedEvent.id, regs);
      const evts = await TournamentService.getEvents(selectedTournament.id);
      setEvents(evts);
      setSelectedEvent(evts.find(e => e.id === selectedEvent.id) || selectedEvent);
    } catch (err) { setError('Failed: ' + err.message); }
    finally { setGenerating(false); }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear draw? All matches deleted.')) return;
    try {
      await DrawService.clearDraw(selectedEvent.id);
      setSuccess('Draw cleared.'); setDrawData(null); exitStaging();
      const evts = await TournamentService.getEvents(selectedTournament.id);
      setEvents(evts);
      setSelectedEvent(evts.find(e => e.id === selectedEvent.id) || selectedEvent);
    } catch (err) { setError('Failed: ' + err.message); }
  };

  // ── Staging validation display ──
  const stagingErrors = staged ? validateStaged() : [];
  const canSave = staged && stagingErrors.length === 0;
  const isEditing = staged !== null;

  // ── Render ──
  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;

  if (!selectedTournament) {
    return (
      <div className="admin-section">
        <div className="admin-section-header"><h2>Draws</h2></div>
        <p style={{ color: '#888', marginBottom: 16 }}>Select a tournament:</p>
        {tournaments.length === 0 ? <div className="admin-empty"><p>No tournaments yet.</p></div> : (
          <div className="admin-list">
            {tournaments.map(t => (
              <div key={t.id} className="admin-list-item" style={{ cursor: 'pointer' }} onClick={() => selectTournament(t)}>
                <div className="admin-list-main"><div className="admin-list-title">{t.name}</div><div className="admin-list-meta">{t.venue && <span>{t.venue}</span>}</div></div>
                <span style={{ color: '#d4a843', fontSize: 18 }}>→</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <button className="admin-btn secondary" onClick={() => { setSelectedTournament(null); setSelectedEvent(null); setDrawData(null); exitStaging(); }} style={{ marginBottom: 8 }}>← Back</button>
          <h2>{selectedTournament.name} — Draws</h2>
        </div>
      </div>

      {error && <div className="admin-error" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      {/* Event tabs */}
      <div className="draw-event-tabs">
        {events.map(ev => (
          <button key={ev.id} className={`draw-event-tab ${selectedEvent?.id === ev.id ? 'active' : ''}`} onClick={() => selectEvent(ev)}>
            {ev.name}
            <span className={`draw-tab-status ${ev.status}`}>
              {ev.status === 'draw_generated' ? '✓' : ev.status === 'in_progress' ? '▶' : '○'}
            </span>
          </button>
        ))}
      </div>

      {selectedEvent && (
        <div className="draw-content">
          {/* Info bar */}
          <div className="draw-info-bar">
            <div className="draw-info-item"><span className="draw-info-label">Format</span><span className="draw-info-value">{formatLabel(selectedEvent.format)}</span></div>
            <div className="draw-info-item"><span className="draw-info-label">Players</span><span className="draw-info-value">{registrations.length}</span></div>
            {isDoubles && <div className="draw-info-item"><span className="draw-info-label">Pairs</span><span className="draw-info-value">{pairs.length} paired, {unpaired.length} unpaired</span></div>}
            <div className="draw-info-item"><span className="draw-info-label">Status</span><span className="draw-info-value">{selectedEvent.status.replace(/_/g, ' ')}</span></div>
            {hasDrawn && drawData.groups?.length > 0 && (
              <div className="draw-info-item">
                <span className="draw-info-label">Groups</span>
                <span className="draw-info-value">{drawData.groups.length} ({drawData.groups.map(g => getGroupPlayers(g.id).length).join(', ')})</span>
              </div>
            )}
          </div>

          {/* ── Doubles Pairing ── */}
          {isDoubles && !hasDrawn && (
            <div className="pairing-section">
              <div className="pairing-header">
                <h3 className="draw-section-title">Step 1: Partner Pairing</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn primary" onClick={autoGeneratePairs} style={{ fontSize: 12 }}>🎲 Auto-Pair</button>
                  {swapSource && <button className="admin-btn secondary" onClick={() => { setSwapSource(null); setSuccess(''); }} style={{ fontSize: 12 }}>Cancel</button>}
                </div>
              </div>
              {pairs.length > 0 && (
                <div className="pairing-list">
                  {pairs.map((pair, idx) => (
                    <div key={idx} className="pairing-card">
                      <span className="pairing-number">Pair {idx + 1}</span>
                      <div className="pairing-players">
                        <span className={`pairing-player ${swapSource?.pairIndex === idx && swapSource?.position === 1 ? 'swap-selected' : ''}`}
                          onClick={() => swapSource ? handlePartnerSwap(pair.player1Id) : (setSwapSource({ pairIndex: idx, position: 1 }), setSuccess('Click another player to swap.'))}>
                          {playerName(pair.player1Id)}
                        </span>
                        <span className="pairing-and">&</span>
                        <span className={`pairing-player ${swapSource?.pairIndex === idx && swapSource?.position === 2 ? 'swap-selected' : ''}`}
                          onClick={() => swapSource ? handlePartnerSwap(pair.player2Id) : (setSwapSource({ pairIndex: idx, position: 2 }), setSuccess('Click another player to swap.'))}>
                          {playerName(pair.player2Id)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {unpaired.length > 0 && (
                <div className="unpaired-section">
                  <div className="unpaired-label">Unpaired ({unpaired.length})</div>
                  <div className="unpaired-list">
                    {unpaired.map(u => (
                      <span key={u.playerId} className={`unpaired-player ${swapSource ? 'clickable' : ''}`}
                        onClick={() => swapSource && handlePartnerSwap(u.playerId)}>{playerName(u.playerId)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="draw-actions-bar">
            <h3 className="draw-section-title">{isDoubles && !hasDrawn ? 'Step 2: Generate Draw' : 'Draw'}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isLocked && !isEditing && (
                <button className="admin-btn primary" onClick={handleGenerate}
                  disabled={generating || registrations.length < 2 || (isDoubles && unpaired.length > 1)}>
                  {generating ? 'Generating...' : hasDrawn ? '↻ Regenerate' : '🎲 Generate Draw'}
                </button>
              )}
              {hasDrawn && !isLocked && !isEditing && (
                <>
                  <button className="admin-btn secondary" onClick={enterStaging}>✏️ Edit Groups</button>
                  <button className="admin-btn secondary" onClick={handleClear}>Clear</button>
                </>
              )}
              {isEditing && (
                <>
                  <button className={`admin-btn ${editMode === 'swap' ? 'primary' : 'secondary'}`}
                    onClick={() => { setEditMode(editMode === 'swap' ? null : 'swap'); setSelectedPlayer(null); setSuccess(editMode === 'swap' ? '' : 'Click a player, then click another to swap.'); }}>
                    {editMode === 'swap' ? '✕ Stop Swap' : '↔ Swap'}
                  </button>
                  <button className={`admin-btn ${editMode === 'move' ? 'primary' : 'secondary'}`}
                    onClick={() => { setEditMode(editMode === 'move' ? null : 'move'); setSelectedPlayer(null); setSuccess(editMode === 'move' ? '' : 'Click a player, then click a group header.'); }}>
                    {editMode === 'move' ? '✕ Stop Move' : '→ Move'}
                  </button>
                  <button className="admin-btn secondary" onClick={handleCreateGroup}>+ Group</button>
                  <button className="admin-btn primary" onClick={handleSave} disabled={!canSave}>
                    💾 Save
                  </button>
                  <button className="admin-btn secondary" onClick={handleCancelStaging}>Cancel</button>
                </>
              )}
            </div>
          </div>

          {/* Staging validation errors */}
          {isEditing && stagingErrors.length > 0 && (
            <div className="admin-error" style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
              {stagingErrors.join('\n')}
            </div>
          )}

          {/* ── Draw Visualization ── */}
          {hasDrawn ? (
            <div className="draw-visualization">
              {drawData.groups?.length > 0 && (
                <div className="draw-groups">
                  <div className="draw-groups-grid">
                    {drawData.groups.map(group => {
                      const groupPlayerIds = getGroupPlayers(group.id);
                      const isTargetable = isEditing && editMode === 'move' && selectedPlayer && selectedPlayer.groupId !== group.id;

                      return (
                        <div key={group.id} className={`draw-group-card ${isTargetable ? 'move-target' : ''} ${isEditing ? 'editing' : ''}`}>
                          <h4 className={`draw-group-name ${isTargetable ? 'clickable' : ''}`}
                            onClick={() => isTargetable && handleGroupHeaderClick(group.id)}>
                            {group.name} ({groupPlayerIds.length})
                            {isTargetable && <span style={{ fontSize: 11, color: '#4ecb71', marginLeft: 6 }}>← move here</span>}
                          </h4>
                          <div className="draw-group-players">
                            {groupPlayerIds.map(pid => {
                              const isSelected = selectedPlayer?.playerId === pid;
                              const isClickable = isEditing && editMode;
                              return (
                                <div key={pid}
                                  className={`draw-group-player ${isSelected ? (editMode === 'swap' ? 'swap-highlight' : 'move-highlight') : ''} ${isClickable ? 'clickable' : ''}`}
                                  onClick={() => isClickable && handlePlayerClick(pid, group.id)}>
                                  {playerName(pid)}
                                </div>
                              );
                            })}
                            {groupPlayerIds.length === 0 && (
                              <div style={{ color: '#555', fontSize: 12, padding: '4px 8px', fontStyle: 'italic' }}>Empty</div>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="draw-group-matches">
                              {drawData.matches.filter(m => m.group_id === group.id).map(m => (
                                <div key={m.id} className="draw-match-row">
                                  <span className="draw-match-side">{sideLabel(m.side_a)}</span>
                                  <span className="draw-match-vs">vs</span>
                                  <span className="draw-match-side">{sideLabel(m.side_b)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Knockout bracket */}
              {(() => {
                const knockout = drawData.matches.filter(m => m.stage !== 'group');
                if (!knockout.length) return null;
                const order = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];
                const byStage = {};
                knockout.forEach(m => { if (!byStage[m.stage]) byStage[m.stage] = []; byStage[m.stage].push(m); });
                return (
                  <div className="draw-bracket">
                    <h3 className="draw-section-title">{drawData.groups?.length > 0 ? 'Knockout Stage' : 'Bracket'}</h3>
                    <div className="draw-bracket-rounds">
                      {order.filter(s => byStage[s]).map(stage => (
                        <div key={stage} className="draw-bracket-round">
                          <div className="draw-round-title">{stageLabel(stage)}</div>
                          {byStage[stage].sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0)).map(m => (
                            <div key={m.id} className="draw-bracket-match">
                              <div className={`draw-bracket-side ${m.winner === 'side_a' ? 'winner' : ''}`}>{sideLabel(m.side_a)}</div>
                              <div className={`draw-bracket-side ${m.winner === 'side_b' ? 'winner' : ''}`}>{sideLabel(m.side_b)}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="admin-empty">
              <p>
                {registrations.length < 2 ? 'Register at least 2 players in Events first.'
                  : isDoubles && unpaired.length > 1 ? 'Pair all players above first.'
                  : 'Click "Generate Draw" to create the draw.'}
              </p>
            </div>
          )}
        </div>
      )}

      {!selectedEvent && <div className="admin-empty"><p>Select an event above.</p></div>}
    </div>
  );
}