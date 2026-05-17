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

  // Draw swap mode
  const [drawSwapSource, setDrawSwapSource] = useState(null);

  // Move player mode
  const [moveSource, setMoveSource] = useState(null); // { playerId, groupId }

  // Late addition
  const [latePlayerWarning, setLatePlayerWarning] = useState(null);

  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try { const data = await TournamentService.getAll(); setTournaments(data); }
    catch (err) { setError('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };

  const selectTournament = async (tournament) => {
    setSelectedTournament(tournament); setSelectedEvent(null); setDrawData(null);
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
    setSelectedEvent(event); setError(''); setSuccess('');
    setSwapSource(null); setDrawSwapSource(null); setMoveSource(null); setLatePlayerWarning(null);
    const regs = await loadRegs(event.id);
    await loadDraw(event.id, regs);
    if (event.type === 'doubles' || event.type === 'mixed_doubles') buildPairingState(regs);
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
      if (data.matches?.length > 0 && regs) {
        const drawnPlayerIds = new Set();
        data.matches.forEach(m => {
          (m.side_a || []).forEach(id => drawnPlayerIds.add(id));
          (m.side_b || []).forEach(id => drawnPlayerIds.add(id));
        });
        const undrawn = regs.filter(r => !drawnPlayerIds.has(r.player_id));
        setLatePlayerWarning(undrawn.length > 0 ? { count: undrawn.length, players: undrawn } : null);
      }
    } catch (err) { setError('Failed to load draw: ' + err.message); }
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
    } catch (err) { setError('Failed to swap: ' + err.message); }
  };

  const savePairToDb = async (pair) => {
    await supabase.from('player_registrations').update({ partner_id: pair.player2Id })
      .eq('player_id', pair.player1Id).eq('event_id', selectedEvent.id);
    await supabase.from('player_registrations').update({ partner_id: pair.player1Id })
      .eq('player_id', pair.player2Id).eq('event_id', selectedEvent.id);
  };

  // ── Draw Generation ──
  const handleGenerate = async () => {
    if (!selectedEvent) return;
    const isDoublesEvent = selectedEvent.type === 'doubles' || selectedEvent.type === 'mixed_doubles';
    if (registrations.length < 2) { setError('Need at least 2 players.'); return; }
    if (isDoublesEvent && unpaired.length > 1) { setError('Pair all players first.'); return; }
    if (drawData?.matches?.length > 0) {
      if (!window.confirm('Clear existing draw and regenerate?')) return;
      try { await DrawService.clearDraw(selectedEvent.id); } catch (err) { setError(err.message); return; }
    }
    setGenerating(true); setError(''); setSuccess('');
    try {
      await DrawService.generate(selectedEvent.id);
      setSuccess('Draw generated!');
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
      setSuccess('Draw cleared.'); setDrawData(null); setLatePlayerWarning(null); setDrawSwapSource(null); setMoveSource(null);
      const evts = await TournamentService.getEvents(selectedTournament.id);
      setEvents(evts);
      setSelectedEvent(evts.find(e => e.id === selectedEvent.id) || selectedEvent);
    } catch (err) { setError('Failed: ' + err.message); }
  };

  // ── Draw Swap ──
  const handleDrawSwapClick = (playerId, matchId, side) => {
    if (!drawSwapSource) {
      setDrawSwapSource({ playerId, matchId, side });
      setSuccess('Now click another player to swap with.');
    } else if (drawSwapSource.playerId === playerId) {
      setDrawSwapSource(null); setSuccess('');
    } else {
      performDrawSwap(drawSwapSource.matchId, drawSwapSource.side, matchId, side);
    }
  };

  const performDrawSwap = async (matchIdA, sideA, matchIdB, sideB) => {
    try {
      await DrawService.swapPlayers(selectedEvent.id, matchIdA, sideA, matchIdB, sideB);
      setSuccess('Players swapped.'); setDrawSwapSource(null);
      const regs = await loadRegs(selectedEvent.id);
      await loadDraw(selectedEvent.id, regs);
    } catch (err) { setError('Swap failed: ' + err.message); setDrawSwapSource(null); }
  };

  // ── Move Player Between Groups ──
  const handleMovePlayerClick = (playerId, groupId) => {
    if (!moveSource) {
      setMoveSource({ playerId, groupId });
      setSuccess(`Selected ${playerName(playerId)}. Now click a group to move them to.`);
    } else if (moveSource.playerId === playerId) {
      setMoveSource(null); setSuccess('');
    }
  };

  const handleMoveToGroup = async (targetGroupId) => {
    if (!moveSource || moveSource.groupId === targetGroupId) return;
    try {
      await DrawService.movePlayerToGroup(selectedEvent.id, moveSource.playerId, moveSource.groupId, targetGroupId);
      setSuccess(`Moved ${playerName(moveSource.playerId)} to ${drawData.groups.find(g => g.id === targetGroupId)?.name || 'group'}.`);
      setMoveSource(null);
      const regs = await loadRegs(selectedEvent.id);
      await loadDraw(selectedEvent.id, regs);
    } catch (err) { setError('Move failed: ' + err.message); setMoveSource(null); }
  };

  // ── Late Addition ──
  const handleLateAddAuto = async () => {
    if (!latePlayerWarning) return;
    try {
      setError('');
      const groups = drawData.groups || [];
      const lateRegs = latePlayerWarning.players;

      if (selectedEvent.format === 'elimination') {
        const firstStage = drawData.matches.reduce((earliest, curr) => {
          const order = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];
          return order.indexOf(curr.stage) < order.indexOf(earliest.stage) ? curr : earliest;
        }, drawData.matches[0]).stage;
        const emptySlots = drawData.matches.filter(m => m.stage === firstStage && (!m.side_a || !m.side_b));
        for (const reg of lateRegs) {
          if (emptySlots.length > 0) {
            const match = emptySlots.shift();
            const side = !match.side_a ? 'side_a' : 'side_b';
            await supabase.from('matches').update({ [side]: [reg.player_id], status: 'pending', winner: null }).eq('id', match.id);
          }
        }
      } else if (groups.length > 0) {
        const groupSizes = {};
        for (const g of groups) {
          const gMatches = drawData.matches.filter(m => m.group_id === g.id);
          const pSet = new Set();
          gMatches.forEach(m => { (m.side_a || []).forEach(id => pSet.add(id)); (m.side_b || []).forEach(id => pSet.add(id)); });
          groupSizes[g.id] = { group: g, size: pSet.size, playerIds: pSet };
        }
        for (const reg of lateRegs) {
          const sorted = Object.values(groupSizes).sort((a, b) => a.size - b.size);
          const target = sorted[0];
          const newMatches = [];
          for (const existingId of target.playerIds) {
            newMatches.push({ event_id: selectedEvent.id, group_id: target.group.id, stage: 'group', side_a: [reg.player_id], side_b: [existingId], status: 'pending' });
          }
          if (newMatches.length > 0) await supabase.from('matches').insert(newMatches);
          target.size++; target.playerIds.add(reg.player_id);
        }
      }
      setSuccess(`Added ${lateRegs.length} late player(s).`);
      setLatePlayerWarning(null);
      const regs = await loadRegs(selectedEvent.id);
      await loadDraw(selectedEvent.id, regs);
    } catch (err) { setError('Failed: ' + err.message); }
  };

  // ── Helpers ──
  const playerName = (id) => !id ? 'BYE' : allPlayers.find(p => p.id === id)?.name || id.substring(0, 8);
  const sideLabel = (sideArr) => (!sideArr || sideArr.length === 0) ? 'TBD' : sideArr.map(playerName).join(' & ');
  const formatLabel = (f) => ({ round_robin: 'Round Robin', elimination: 'Elimination', group_to_knockout: 'Group → Knockout' }[f] || f);
  const stageLabel = (s) => ({ group: 'Group', round_of_32: 'R32', round_of_16: 'R16', quarterfinal: 'QF', semifinal: 'SF', final: 'Final' }[s] || s);

  const isDoubles = selectedEvent?.type === 'doubles' || selectedEvent?.type === 'mixed_doubles';
  const hasDrawn = drawData?.matches?.length > 0;
  const isLocked = selectedEvent?.status === 'in_progress' || selectedEvent?.status === 'completed';

  // Get players per group
  const getGroupPlayers = (groupId) => {
    if (!drawData) return [];
    const gMatches = drawData.matches.filter(m => m.group_id === groupId);
    const pIds = new Set();
    gMatches.forEach(m => { (m.side_a || []).forEach(id => pIds.add(id)); (m.side_b || []).forEach(id => pIds.add(id)); });
    return Array.from(pIds);
  };

  // Active mode label
  const activeMode = drawSwapSource ? 'swap' : moveSource ? 'move' : null;

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
          <button className="admin-btn secondary" onClick={() => { setSelectedTournament(null); setSelectedEvent(null); setDrawData(null); }} style={{ marginBottom: 8 }}>← Back</button>
          <h2>{selectedTournament.name} — Draws</h2>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
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
          {/* Late player warning */}
          {latePlayerWarning && (
            <div className="draw-late-warning">
              <div className="draw-late-text">
                ⚠️ {latePlayerWarning.count} player(s) added after draw:
                <strong> {latePlayerWarning.players.map(r => playerName(r.player_id)).join(', ')}</strong>
              </div>
              <div className="draw-late-actions">
                <button className="admin-btn primary" onClick={handleLateAddAuto} style={{ fontSize: 12, padding: '5px 12px' }}>Auto-slot into draw</button>
                <button className="admin-btn secondary" onClick={handleClear} style={{ fontSize: 12, padding: '5px 12px' }}>Regenerate entire draw</button>
              </div>
            </div>
          )}

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

          {/* ── Doubles Pairing Step ── */}
          {isDoubles && !hasDrawn && (
            <div className="pairing-section">
              <div className="pairing-header">
                <h3 className="draw-section-title">Step 1: Partner Pairing</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn primary" onClick={autoGeneratePairs} style={{ fontSize: 12 }}>
                    🎲 Auto-Pair{pairs.length > 0 ? ' Remaining' : ' All'}
                  </button>
                  {swapSource && <button className="admin-btn secondary" onClick={() => { setSwapSource(null); setSuccess(''); }} style={{ fontSize: 12 }}>Cancel Swap</button>}
                </div>
              </div>
              {pairs.length > 0 && (
                <div className="pairing-list">
                  {pairs.map((pair, idx) => (
                    <div key={idx} className="pairing-card">
                      <span className="pairing-number">Pair {idx + 1}</span>
                      <div className="pairing-players">
                        <span className={`pairing-player ${swapSource?.pairIndex === idx && swapSource?.position === 1 ? 'swap-selected' : ''}`}
                          onClick={() => swapSource ? handlePartnerSwap(pair.player1Id) : (setSwapSource({ pairIndex: idx, position: 1 }), setSuccess('Click another player to swap with.'))}>
                          {playerName(pair.player1Id)}
                        </span>
                        <span className="pairing-and">&</span>
                        <span className={`pairing-player ${swapSource?.pairIndex === idx && swapSource?.position === 2 ? 'swap-selected' : ''}`}
                          onClick={() => swapSource ? handlePartnerSwap(pair.player2Id) : (setSwapSource({ pairIndex: idx, position: 2 }), setSuccess('Click another player to swap with.'))}>
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
              {pairs.length > 0 && unpaired.length <= 1 && <p style={{ color: '#4ecb71', fontSize: 13, marginTop: 12 }}>✓ All paired. Ready to generate draw.</p>}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="draw-actions-bar">
            <h3 className="draw-section-title">{isDoubles && !hasDrawn ? 'Step 2: Generate Draw' : 'Draw'}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isLocked && (
                <button className="admin-btn primary" onClick={handleGenerate}
                  disabled={generating || registrations.length < 2 || (isDoubles && unpaired.length > 1)}>
                  {generating ? 'Generating...' : hasDrawn ? '↻ Regenerate' : '🎲 Generate Draw'}
                </button>
              )}
              {hasDrawn && !isLocked && (
                <>
                  <button className="admin-btn secondary" onClick={handleClear}>Clear</button>
                  <button className={`admin-btn ${activeMode === 'swap' ? 'primary' : 'secondary'}`}
                    onClick={() => {
                      if (activeMode === 'swap') { setDrawSwapSource(null); setSuccess(''); }
                      else { setDrawSwapSource(null); setMoveSource(null); setSuccess('Click a player in the draw, then click who to swap with.'); setDrawSwapSource({}); }
                    }}>
                    {activeMode === 'swap' ? '✕ Cancel Swap' : '↔ Swap'}
                  </button>
                  {drawData.groups?.length > 1 && (
                    <button className={`admin-btn ${activeMode === 'move' ? 'primary' : 'secondary'}`}
                      onClick={() => {
                        if (activeMode === 'move') { setMoveSource(null); setSuccess(''); }
                        else { setMoveSource(null); setDrawSwapSource(null); setSuccess('Click a player to select them, then click a group header to move them there.'); setMoveSource({}); }
                      }}>
                      {activeMode === 'move' ? '✕ Cancel Move' : '→ Move'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Draw Visualization ── */}
          {hasDrawn ? (
            <div className="draw-visualization">
              {drawData.groups?.length > 0 && (
                <div className="draw-groups">
                  <div className="draw-groups-grid">
                    {drawData.groups.map(group => {
                      const groupPlayerIds = getGroupPlayers(group.id);
                      const gMatches = drawData.matches.filter(m => m.group_id === group.id);
                      const isTargetable = moveSource?.playerId && moveSource?.groupId !== group.id;

                      return (
                        <div key={group.id} className={`draw-group-card ${isTargetable ? 'move-target' : ''}`}>
                          <h4 className={`draw-group-name ${isTargetable ? 'clickable' : ''}`}
                            onClick={() => isTargetable && handleMoveToGroup(group.id)}>
                            {group.name} ({groupPlayerIds.length})
                            {isTargetable && <span style={{ fontSize: 11, color: '#d4a843', marginLeft: 6 }}>← click to move here</span>}
                          </h4>
                          <div className="draw-group-players">
                            {groupPlayerIds.map(pid => {
                              const isSwapActive = activeMode === 'swap';
                              const isMoveActive = activeMode === 'move';
                              const isSwapSelected = drawSwapSource?.playerId === pid;
                              const isMoveSelected = moveSource?.playerId === pid;

                              // Find a match containing this player (for swap source reference)
                              const pMatch = gMatches.find(m => (m.side_a || []).includes(pid));
                              const pSide = pMatch ? ((pMatch.side_a || []).includes(pid) ? 'side_a' : 'side_b') : null;

                              return (
                                <div key={pid} className={`draw-group-player ${isSwapSelected ? 'swap-highlight' : ''} ${isMoveSelected ? 'move-highlight' : ''} ${(isSwapActive || isMoveActive) && !isLocked ? 'clickable' : ''}`}
                                  onClick={() => {
                                    if (isLocked) return;
                                    if (isSwapActive && pMatch && pSide) handleDrawSwapClick(pid, pMatch.id, pSide);
                                    else if (isMoveActive) handleMovePlayerClick(pid, group.id);
                                  }}>
                                  {playerName(pid)}
                                </div>
                              );
                            })}
                          </div>
                          <div className="draw-group-matches">
                            {gMatches.map(m => (
                              <div key={m.id} className="draw-match-row">
                                <span className="draw-match-side">{sideLabel(m.side_a)}</span>
                                <span className="draw-match-vs">vs</span>
                                <span className="draw-match-side">{sideLabel(m.side_b)}</span>
                              </div>
                            ))}
                          </div>
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
                              <div className={`draw-bracket-side ${m.winner === 'side_a' ? 'winner' : ''} ${drawSwapSource?.playerId && (m.side_a || []).includes(drawSwapSource.playerId) ? 'swap-highlight' : ''}`}
                                onClick={() => !isLocked && activeMode === 'swap' && m.side_a && handleDrawSwapClick((m.side_a || [])[0], m.id, 'side_a')}
                                style={{ cursor: !isLocked && activeMode === 'swap' ? 'pointer' : 'default' }}>
                                {sideLabel(m.side_a)}
                              </div>
                              <div className={`draw-bracket-side ${m.winner === 'side_b' ? 'winner' : ''} ${drawSwapSource?.playerId && (m.side_b || []).includes(drawSwapSource.playerId) ? 'swap-highlight' : ''}`}
                                onClick={() => !isLocked && activeMode === 'swap' && m.side_b && handleDrawSwapClick((m.side_b || [])[0], m.id, 'side_b')}
                                style={{ cursor: !isLocked && activeMode === 'swap' ? 'pointer' : 'default' }}>
                                {sideLabel(m.side_b)}
                              </div>
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