import { useState, useEffect, useMemo } from 'react';
import { TournamentService } from '../../services/TournamentService';
import { DrawService } from '../../services/DrawService';
import { supabase } from '../../lib/supabase';
import './AdminComponents.css';

const STAGE_TYPE_LABELS = { group: 'Group Stage', round_robin: 'Round Robin', elimination: 'Elimination' };
const STATUS_COLORS = { pending: '#888', configuring: '#5b9bd5', in_progress: '#4ecb71', completed: '#d4a843' };
const GROUP_LETTERS_2 = 'IJKLMNOP'.split('');

export default function DrawManager() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stages, setStages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [stageMatches, setStageMatches] = useState({});
  const [stageGroups, setStageGroups] = useState({});
  const [stageStandings, setStageStandings] = useState({});
  const [stageByes, setStageByes] = useState({});
  const [allPlayers, setAllPlayers] = useState([]);

  // New stage form
  const [addingStage, setAddingStage] = useState(false);
  const [newStageType, setNewStageType] = useState('group');
  const [newStageConfig, setNewStageConfig] = useState({ games_per_match: 1, target_group_size: 4, advancement_counts: { uniform: true, count: 2 }, advancement_count: 2, third_place_match: false });

  // Group editing
  const [editingStageId, setEditingStageId] = useState(null);
  const [editGroups, setEditGroups] = useState([]); // [{groupName, participants: [{playerIds},...]}]
  const [selectedPlayerKey, setSelectedPlayerKey] = useState(null); // participantKey for move/swap
  const [selectedGroupIdx, setSelectedGroupIdx] = useState(null);

  // Byes
  const [showByeSelector, setShowByeSelector] = useState(null);
  const [byeSearch, setByeSearch] = useState('');
  const [expandedStageId, setExpandedStageId] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTournaments(); }, []);

  const loadTournaments = async () => {
    try { setTournaments(await TournamentService.getAll()); } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const selectTournament = async (t) => {
    setSelectedTournament(t); setSelectedEvent(null);
    setEvents(await TournamentService.getEvents(t.id));
    const { data: tp } = await supabase.from('tournament_players').select('player_id').eq('tournament_id', t.id);
    const ids = (tp || []).map(r => r.player_id);
    if (ids.length > 0) { const { data } = await supabase.from('players').select('id, name, gender').in('id', ids); setAllPlayers(data || []); }
  };

  const selectEvent = async (ev) => {
    setSelectedEvent(ev); setLoading(true); setError('');
    try { setParticipants(await DrawService.getParticipants(ev.id)); await loadStageData(ev.id); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const loadStageData = async (eventId) => {
    const stgs = await DrawService.getStages(eventId);
    setStages(stgs);
    const matchMap = {}, groupMap = {}, standingsMap = {}, byeMap = {};
    for (const s of stgs) {
      const { data: m } = await supabase.from('matches').select('*').eq('stage_id', s.id).order('created_at');
      matchMap[s.id] = m || [];
      const { data: g } = await supabase.from('groups').select('*').eq('stage_id', s.id).order('name');
      groupMap[s.id] = g || [];
      byeMap[s.id] = await DrawService.getStageByes(s.id);
      if (s.stage_type !== 'elimination' && (m || []).length > 0) {
        const sMap = {};
        const mr = s.config?.manual_rankings || {};
        if (s.stage_type === 'group' && (g || []).length > 0) { for (const grp of g) sMap[grp.id] = await DrawService.calculateStandings(s.id, grp.id, mr[grp.id]); }
        else sMap['_all'] = await DrawService.calculateStandings(s.id, null, mr['_all']);
        standingsMap[s.id] = sMap;
      }
    }
    setStageMatches(matchMap); setStageGroups(groupMap); setStageStandings(standingsMap); setStageByes(byeMap);
  };

  const pName = (id) => allPlayers.find(p => p.id === id)?.name || id?.substring(0, 6) || '?';
  const sideLabel = (arr) => (!arr || !arr.length) ? 'TBD' : arr.map(pName).join(' & ');
  const pKey = (p) => p.playerIds.slice().sort().join(',');

  // ── Expected counts ──
  const getExpectedCount = (stageNumber) => {
    if (stageNumber === 1) { const s1 = stages.find(s => s.stage_number === 1); return participants.length - (s1 ? (stageByes[s1.id] || []).length : 0); }
    const prev = stages.find(s => s.stage_number === stageNumber - 1);
    if (!prev) return 0;
    const cfg = prev.config || {};
    let adv = 0;
    if (prev.stage_type === 'group') {
      const perGroup = cfg.advancement_counts?.count || 2;
      const gc = (stageGroups[prev.id] || []).length || Math.max(1, Math.round(getExpectedCount(stageNumber - 1) / (cfg.target_group_size || 4)));
      adv = perGroup * gc;
    } else if (prev.stage_type === 'round_robin') { adv = cfg.advancement_count || 2; }
    return adv + (stageByes[prev.id] || []).length;
  };

  const getPlaceholderLabels = (stageNumber) => {
    const prev = stages.find(s => s.stage_number === stageNumber - 1);
    if (!prev) return Array.from({ length: getExpectedCount(stageNumber) }, (_, i) => 'P' + (i + 1));
    const cfg = prev.config || {};
    const labels = [];
    if (prev.stage_type === 'group') {
      const groups = stageGroups[prev.id] || [];
      const perGroup = cfg.advancement_counts?.count || 2;
      const gNames = groups.length > 0 ? groups.map(g => g.name.replace('Group ', '')) : Array.from({ length: Math.ceil(getExpectedCount(stageNumber - 1) / (cfg.target_group_size || 4)) }, (_, i) => String.fromCharCode(65 + i));
      for (const gn of gNames) for (let r = 1; r <= perGroup; r++) labels.push(gn + r);
    } else if (prev.stage_type === 'round_robin') { for (let i = 1; i <= (cfg.advancement_count || 2); i++) labels.push('#' + i); }
    (stageByes[prev.id] || []).forEach((b, i) => labels.push('Bye' + ((stageByes[prev.id] || []).length > 1 ? (i + 1) : '')));
    return labels;
  };

  // ── Stage Actions ──
  const handleAddStage = async () => {
    if (!selectedEvent) return; setError(''); setSuccess('');
    const sn = stages.length + 1;
    const config = {};
    if (newStageType === 'group') { config.games_per_match = newStageConfig.games_per_match; config.target_group_size = newStageConfig.target_group_size; config.advancement_counts = { ...newStageConfig.advancement_counts }; }
    else if (newStageType === 'round_robin') { config.games_per_match = newStageConfig.games_per_match; config.advancement_count = newStageConfig.advancement_count; }
    else if (newStageType === 'elimination') { config.games_per_match = newStageConfig.games_per_match; config.third_place_match = newStageConfig.third_place_match; }
    try { const c = await DrawService.createStage(selectedEvent.id, sn, newStageType, config); setAddingStage(false); await loadStageData(selectedEvent.id); setExpandedStageId(c.id); setSuccess('Stage ' + sn + ' added'); }
    catch (err) { setError(err.message); }
  };

  const handleGenerateMatches = async (stage) => {
    setError(''); setSuccess('');
    try {
      let sp;
      if (stage.stage_number === 1) sp = await DrawService.getStageParticipants(selectedEvent.id, 1, stages);
      else {
        const prev = stages.find(s => s.stage_number === stage.stage_number - 1);
        if (!prev || prev.status !== 'completed') { setError('Complete previous stage first'); return; }
        sp = await DrawService.getStageParticipants(selectedEvent.id, stage.stage_number, stages);
      }
      if (sp.length < 2) { setError('Not enough participants (' + sp.length + ')'); return; }
      if (stage.stage_type === 'elimination' && ![2, 4, 8].includes(sp.length)) { setError('Elimination needs 2, 4, or 8 (have ' + sp.length + ')'); return; }
      await DrawService.generateStageMatches(selectedEvent.id, stage, sp);
      await loadStageData(selectedEvent.id); setSuccess('Matches generated');
    } catch (err) { setError(err.message); }
  };

  const handleDeleteStage = async (sid) => {
    if (!window.confirm('Delete this stage?')) return;
    try { await DrawService.deleteStage(sid); await loadStageData(selectedEvent.id); } catch (err) { setError(err.message); }
  };

  const handleCompleteStage = async (stage) => {
    const ms = stageMatches[stage.id] || [];
    const inc = ms.filter(m => m.status !== 'finished' && m.status !== 'locked');
    if (inc.length > 0) { setError(inc.length + ' match(es) not finished'); return; }
    try { await DrawService.setStageStatus(stage.id, 'completed'); await loadStageData(selectedEvent.id); setSuccess('Stage completed'); }
    catch (err) { setError(err.message); }
  };

  const handleAdvanceWinners = async (stage) => {
    setError('');
    try {
      const count = await DrawService.advanceEliminationWinners(stage.id);
      await loadStageData(selectedEvent.id);
      setSuccess(count + ' advancement(s) applied');
    } catch (err) { setError(err.message); }
  };

  const handleAddBye = async (sid, p) => { try { await DrawService.addBye(sid, p.playerIds[0], p.playerIds.length > 1 ? p.playerIds[1] : null); await loadStageData(selectedEvent.id); } catch (err) { setError(err.message); } };
  const handleRemoveBye = async (bid) => { try { await DrawService.removeBye(bid); await loadStageData(selectedEvent.id); } catch (err) { setError(err.message); } };
  const handleClearAll = async () => { if (!window.confirm('Clear ALL draws?')) return; try { await DrawService.clearEventDraw(selectedEvent.id); await loadStageData(selectedEvent.id); setSuccess('Cleared'); } catch (err) { setError(err.message); } };

  // ── Group Editing ──
  const startEditGroups = (stageId) => {
    const groups = stageGroups[stageId] || [];
    const matches = stageMatches[stageId] || [];
    const eg = groups.map(g => {
      const playerSet = new Map();
      matches.filter(m => m.group_id === g.id).forEach(m => {
        if (m.side_a) playerSet.set(m.side_a.sort().join(','), { playerIds: m.side_a });
        if (m.side_b) playerSet.set(m.side_b.sort().join(','), { playerIds: m.side_b });
      });
      return { groupName: g.name, participants: [...playerSet.values()] };
    });
    setEditGroups(eg); setEditingStageId(stageId); setSelectedPlayerKey(null);
  };

  const handlePlayerClick = (groupIdx, playerKey) => {
    if (selectedPlayerKey === null) { setSelectedPlayerKey(playerKey); setSelectedGroupIdx(groupIdx); return; }
    if (selectedGroupIdx === groupIdx && selectedPlayerKey === playerKey) { setSelectedPlayerKey(null); setSelectedGroupIdx(null); return; }

    // If clicking in same group: deselect. If different group: swap.
    if (selectedGroupIdx !== groupIdx) {
      const newGroups = editGroups.map(g => ({ ...g, participants: [...g.participants] }));
      const srcGroup = newGroups[selectedGroupIdx];
      const dstGroup = newGroups[groupIdx];
      const srcIdx = srcGroup.participants.findIndex(p => pKey(p) === selectedPlayerKey);
      const dstIdx = dstGroup.participants.findIndex(p => pKey(p) === playerKey);
      if (srcIdx >= 0 && dstIdx >= 0) [srcGroup.participants[srcIdx], dstGroup.participants[dstIdx]] = [dstGroup.participants[dstIdx], srcGroup.participants[srcIdx]];
      setEditGroups(newGroups);
    }
    setSelectedPlayerKey(null); setSelectedGroupIdx(null);
  };

  const handleMoveToGroup = (targetGroupIdx) => {
    if (selectedPlayerKey === null || selectedGroupIdx === null || selectedGroupIdx === targetGroupIdx) return;
    const newGroups = editGroups.map(g => ({ ...g, participants: [...g.participants] }));
    const srcGroup = newGroups[selectedGroupIdx];
    const srcIdx = srcGroup.participants.findIndex(p => pKey(p) === selectedPlayerKey);
    if (srcIdx >= 0) {
      const [player] = srcGroup.participants.splice(srcIdx, 1);
      newGroups[targetGroupIdx].participants.push(player);
    }
    setEditGroups(newGroups); setSelectedPlayerKey(null); setSelectedGroupIdx(null);
  };

  const handleAddGroup = () => { setEditGroups([...editGroups, { groupName: 'Group ' + String.fromCharCode(65 + editGroups.length), participants: [] }]); };

  const handleRemoveGroup = (idx) => {
    if (editGroups[idx].participants.length > 0) { setError('Move all players out first'); return; }
    const ng = [...editGroups]; ng.splice(idx, 1);
    ng.forEach((g, i) => { g.groupName = 'Group ' + String.fromCharCode(65 + i); });
    setEditGroups(ng);
  };

  const handleSaveGroupEdits = async () => {
    setError('');
    for (const g of editGroups) { if (g.participants.length < 3) { setError(g.groupName + ' has only ' + g.participants.length + ' participants (minimum 3)'); return; } }
    if (editGroups.some(g => g.participants.length === 0)) { setError('Remove empty groups first'); return; }
    const stage = stages.find(s => s.id === editingStageId);
    if (!stage) return;
    try {
      await DrawService.saveGroupEdits(selectedEvent.id, editingStageId, editGroups, stage.config || {});
      setEditingStageId(null); setEditGroups([]); await loadStageData(selectedEvent.id); setSuccess('Groups saved & matches regenerated');
    } catch (err) { setError(err.message); }
  };

  // ── Manual tiebreaker ──
  const handleManualRank = async (stageId, groupId, playerKey, direction) => {
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return;
    const cfg = { ...stage.config };
    if (!cfg.manual_rankings) cfg.manual_rankings = {};
    const gKey = groupId || '_all';
    if (!cfg.manual_rankings[gKey]) cfg.manual_rankings[gKey] = {};

    const standings = stageStandings[stageId]?.[groupId || '_all'] || [];
    // Assign numeric ranks to all players in this group
    standings.forEach((s, i) => { if (cfg.manual_rankings[gKey][s.key] == null) cfg.manual_rankings[gKey][s.key] = i; });

    const currentRank = cfg.manual_rankings[gKey][playerKey];
    const swapRank = currentRank + direction;
    // Find who has swapRank
    const swapKey = Object.entries(cfg.manual_rankings[gKey]).find(([k, r]) => r === swapRank)?.[0];
    if (swapKey) {
      cfg.manual_rankings[gKey][swapKey] = currentRank;
      cfg.manual_rankings[gKey][playerKey] = swapRank;
    }

    try {
      await DrawService.updateStageConfig(stageId, cfg);
      await loadStageData(selectedEvent.id);
    } catch (err) { setError(err.message); }
  };

  // ── Standings table ──
  const renderStandings = (standings, advCount, stageId, groupId) => {
    if (!standings || !standings.length) return null;
    const hasTies = standings.some(s => s.tied);
    return (
      <div>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
          <thead><tr style={{ color: '#888', borderBottom: '1px solid #2a2a3a' }}>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>#</th><th style={{ textAlign: 'left', padding: '4px 6px' }}>Player/Team</th>
            <th style={{ padding: '4px 6px', textAlign: 'center' }}>W</th><th style={{ padding: '4px 6px', textAlign: 'center' }}>L</th>
            <th style={{ padding: '4px 6px', textAlign: 'center' }}>PD</th>
            {hasTies && <th style={{ padding: '4px 6px' }}></th>}
          </tr></thead>
          <tbody>{standings.map((s, i) => (
            <tr key={s.key} style={{ background: advCount && i < advCount ? '#152a15' : 'transparent', borderBottom: '1px solid #1a1a2e' }}>
              <td style={{ padding: '4px 6px', color: advCount && i < advCount ? '#4ecb71' : '#888' }}>
                {s.rank}{s.tied && <span style={{ color: '#e85454', marginLeft: 2 }} title="Tied — resolve manually">*</span>}
              </td>
              <td style={{ padding: '4px 6px', color: '#ddd' }}>{sideLabel(s.playerIds)}</td>
              <td style={{ padding: '4px 6px', textAlign: 'center', color: '#4ecb71' }}>{s.wins}</td>
              <td style={{ padding: '4px 6px', textAlign: 'center', color: '#e85454' }}>{s.losses}</td>
              <td style={{ padding: '4px 6px', textAlign: 'center', color: s.pointDiff >= 0 ? '#4ecb71' : '#e85454' }}>{s.pointDiff >= 0 ? '+' : ''}{s.pointDiff}</td>
              {hasTies && <td style={{ padding: '2px 4px', whiteSpace: 'nowrap' }}>
                {s.tied && i > 0 && <button onClick={() => handleManualRank(stageId, groupId, s.key, -1)}
                  style={{ background: 'none', border: '1px solid #555', borderRadius: 3, color: '#888', cursor: 'pointer', fontSize: 10, padding: '1px 4px', marginRight: 2 }}>{'\u25B2'}</button>}
                {s.tied && i < standings.length - 1 && <button onClick={() => handleManualRank(stageId, groupId, s.key, 1)}
                  style={{ background: 'none', border: '1px solid #555', borderRadius: 3, color: '#888', cursor: 'pointer', fontSize: 10, padding: '1px 4px' }}>{'\u25BC'}</button>}
              </td>}
            </tr>
          ))}</tbody>
        </table>
        {hasTies && <div style={{ fontSize: 11, color: '#e85454', marginTop: 4 }}>{'\u26A0'} Tied players marked with * — use arrows to resolve</div>}
      </div>
    );
  };

  // ── Placeholder preview ──
  const renderPlaceholderPreview = (stage) => {
    const count = getExpectedCount(stage.stage_number);
    const labels = getPlaceholderLabels(stage.stage_number);
    const cfg = stage.config || {};

    if (stage.stage_type === 'group') {
      const gs = cfg.target_group_size || 4;
      let ng = Math.max(1, Math.round(count / gs));
      while (ng > 1 && Math.floor(count / ng) < 3) ng--;
      const gLetters = Array.from({ length: ng }, (_, i) => GROUP_LETTERS_2[i] || String.fromCharCode(73 + i));
      let li = 0;
      return (<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{gLetters.map((gl, gi) => {
        const sz = Math.floor(count / ng) + (gi < count % ng ? 1 : 0);
        const members = labels.slice(li, li + sz); li += sz;
        return (<div key={gi} style={{ background: '#14141f', borderRadius: 8, border: '1px dashed #2a2a3e', padding: 12, minWidth: 160 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#5b9bd5', marginBottom: 6 }}>Group {gl}</div>
          {members.map((l, i) => <div key={i} style={{ padding: '3px 0', fontSize: 12, color: '#888', fontStyle: 'italic', borderBottom: '1px solid #1a1a2e' }}>{l}</div>)}
        </div>);
      })}</div>);
    }
    if (stage.stage_type === 'round_robin') {
      return (<div style={{ background: '#14141f', borderRadius: 8, border: '1px dashed #2a2a3e', padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#5b9bd5', marginBottom: 6 }}>Round Robin ({count})</div>
        {labels.map((l, i) => <div key={i} style={{ padding: '2px 0', fontSize: 12, color: '#888', fontStyle: 'italic' }}>{l}</div>)}
      </div>);
    }
    if (stage.stage_type === 'elimination') {
      const ml = [];
      if (count === 8) { for (let i = 0; i < 4; i++) ml.push({ s: 'QF' + (i + 1), a: labels[i * 2] || '?', b: labels[i * 2 + 1] || '?' }); ml.push({ s: 'SF1', a: 'W-QF1', b: 'W-QF2' }); ml.push({ s: 'SF2', a: 'W-QF3', b: 'W-QF4' }); ml.push({ s: 'Final', a: 'W-SF1', b: 'W-SF2' }); if (cfg.third_place_match) ml.push({ s: 'Bronze', a: 'L-SF1', b: 'L-SF2' }); }
      else if (count === 4) { ml.push({ s: 'SF1', a: labels[0] || '?', b: labels[3] || '?' }); ml.push({ s: 'SF2', a: labels[1] || '?', b: labels[2] || '?' }); ml.push({ s: 'Final', a: 'W-SF1', b: 'W-SF2' }); if (cfg.third_place_match) ml.push({ s: 'Bronze', a: 'L-SF1', b: 'L-SF2' }); }
      else if (count === 2) { ml.push({ s: 'Final', a: labels[0] || '?', b: labels[1] || '?' }); }
      return (<div style={{ background: '#14141f', borderRadius: 8, border: '1px dashed #2a2a3e', padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#5b9bd5', marginBottom: 8 }}>Elimination Bracket</div>
        {ml.map((m, i) => <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #1a1a2e', fontSize: 12 }}>
          <span style={{ color: '#d4a843', fontWeight: 600, minWidth: 50 }}>{m.s}</span><span style={{ color: '#888', fontStyle: 'italic' }}>{m.a} vs {m.b}</span>
        </div>)}
      </div>);
    }
    return null;
  };

  // ── Selectors ──
  if (loading && !selectedTournament) return <div className="admin-loading">Loading...</div>;
  if (!selectedTournament) return (
    <div className="admin-section"><div className="admin-section-header"><h2>Draws</h2></div><p style={{ color: '#888', marginBottom: 16 }}>Select a tournament:</p>
      <div className="admin-list">{tournaments.map(t => (<div key={t.id} className="admin-list-item" style={{ cursor: 'pointer' }} onClick={() => selectTournament(t)}>
        <div className="admin-list-main"><div className="admin-list-title">{t.name}</div></div><span style={{ color: '#d4a843', fontSize: 18 }}>{'\u2192'}</span></div>))}</div></div>
  );
  if (!selectedEvent) return (
    <div className="admin-section"><div className="admin-section-header"><div><button className="admin-btn secondary" onClick={() => setSelectedTournament(null)} style={{ marginBottom: 8 }}>{'\u2190'} Back</button>
      <h2>{selectedTournament.name} {'\u2014'} Draws</h2></div></div>
      {events.length === 0 ? <div className="admin-empty"><p>No events.</p></div> : <div className="admin-list">{events.map(ev => (
        <div key={ev.id} className="admin-list-item" style={{ cursor: 'pointer' }} onClick={() => selectEvent(ev)}>
          <div className="admin-list-main"><div className="admin-list-title">{ev.name}</div><div className="admin-list-meta"><span>{ev.type}</span>{ev.gender && <span>{ev.gender}</span>}</div></div>
          <span style={{ color: '#d4a843', fontSize: 18 }}>{'\u2192'}</span></div>))}</div>}</div>
  );

  const canAddStage = stages.length === 0 || stages[stages.length - 1].stage_type !== 'elimination';

  // ── Main wizard ──
  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div><button className="admin-btn secondary" onClick={() => setSelectedEvent(null)} style={{ marginBottom: 8 }}>{'\u2190'} Back</button>
          <h2>{selectedEvent.name} {'\u2014'} Draw Configuration</h2></div>
        {stages.length > 0 && <button className="admin-btn small danger" onClick={handleClearAll}>Clear All</button>}
      </div>
      {error && <div className="admin-error">{error}</div>}
      {success && <div style={{ background: '#152a15', border: '1px solid #2a4a2a', color: '#4ecb71', padding: '8px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{success}</div>}
      <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>{participants.length} {selectedEvent.type === 'doubles' ? 'pairs' : 'players'} registered{participants.length < 4 && <span style={{ color: '#e85454' }}> (min 4)</span>}</div>

      {/* Stage cards */}
      {stages.map((stage) => {
        const matches = stageMatches[stage.id] || [];
        const groups = stageGroups[stage.id] || [];
        const standings = stageStandings[stage.id] || {};
        const byes = stageByes[stage.id] || [];
        const isExpanded = expandedStageId === stage.id;
        const hasMatches = matches.length > 0;
        const cfg = stage.config || {};
        const advCount = stage.stage_type === 'group' ? (cfg.advancement_counts?.count || 2) : (cfg.advancement_count || 2);
        const stageStarted = matches.some(m => m.status !== 'pending');
        const prevComplete = !stages.find(s => s.stage_number === stage.stage_number - 1) || stages.find(s => s.stage_number === stage.stage_number - 1)?.status === 'completed';
        const canGen = stage.stage_number === 1 || prevComplete;
        const isEditing = editingStageId === stage.id;
        const hasFinishedUnlocked = matches.some(m => m.status === 'finished');
        const hasTBD = stage.stage_type === 'elimination' && matches.some(m => (!m.side_a || !m.side_b) && m.source_match_a);

        return (
          <div key={stage.id} style={{ marginBottom: 16, background: '#0d0d14', borderRadius: 10, border: '1px solid #1e1e2e', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', background: '#14141f' }}
              onClick={() => setExpandedStageId(isExpanded ? null : stage.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#ddd' }}>{isExpanded ? '\u25BE' : '\u25B8'} Stage {stage.stage_number}: {STAGE_TYPE_LABELS[stage.stage_type]}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, border: '1px solid ' + (STATUS_COLORS[stage.status] || '#888'), color: STATUS_COLORS[stage.status] }}>{hasMatches ? stage.status : 'planned'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#555' }}>{getExpectedCount(stage.stage_number)} participants</span>
                {!stageStarted && <button className="admin-btn small danger" onClick={(e) => { e.stopPropagation(); handleDeleteStage(stage.id); }} style={{ fontSize: 10, padding: '2px 8px' }}>{'\u2715'}</button>}
              </div>
            </div>

            {isExpanded && (
              <div style={{ padding: '12px 16px' }}>
                {/* Config */}
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {stage.stage_type === 'group' && <span>Groups of {cfg.target_group_size || 4} | Advance top {advCount}</span>}
                  {stage.stage_type === 'round_robin' && <span>Advance top {cfg.advancement_count || 2}</span>}
                  {stage.stage_type === 'elimination' && cfg.third_place_match && <span>3rd place match</span>}
                </div>

                {/* Byes */}
                {byes.length > 0 && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1a1a2e', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#d4a843', marginBottom: 4 }}>Byes:</div>
                    {byes.map(b => <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#2a2215', borderRadius: 4, marginRight: 6, fontSize: 11, color: '#ddd' }}>
                      {pName(b.player_id)}{b.partner_id && ' & ' + pName(b.partner_id)}
                      {!stageStarted && <span style={{ cursor: 'pointer', color: '#888' }} onClick={() => handleRemoveBye(b.id)}>{'\u2715'}</span>}
                    </span>)}
                  </div>
                )}

                {/* Bye selector */}
                {!stageStarted && stage.stage_number === 1 && (
                  <div style={{ marginBottom: 12 }}>
                    {showByeSelector === stage.id ? (
                      <div style={{ padding: 8, background: '#1a1a2e', borderRadius: 6 }}>
                        <input type="text" placeholder="Search..." value={byeSearch} onChange={e => setByeSearch(e.target.value)} className="pool-search-input" style={{ marginBottom: 4, fontSize: 12 }} />
                        <div style={{ maxHeight: 120, overflow: 'auto' }}>{participants.filter(p => !byes.some(b => b.player_id === p.playerIds[0])).filter(p => !byeSearch || p.label.toLowerCase().includes(byeSearch.toLowerCase())).map(p => (
                          <div key={p.playerIds.join(',')} onClick={() => { handleAddBye(stage.id, p); setByeSearch(''); }} className="pool-check-item" style={{ cursor: 'pointer', padding: '4px 8px', fontSize: 12 }}>{p.label}</div>
                        ))}</div>
                        <button className="admin-btn small secondary" onClick={() => { setShowByeSelector(null); setByeSearch(''); }} style={{ marginTop: 4, fontSize: 10 }}>Done</button>
                      </div>
                    ) : <button className="admin-btn small secondary" onClick={() => setShowByeSelector(stage.id)} style={{ fontSize: 11 }}>+ Assign Bye</button>}
                  </div>
                )}

                {/* Generate / Edit / Advance buttons */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {!stageStarted && canGen && <button className="admin-btn primary" onClick={() => handleGenerateMatches(stage)} style={{ fontSize: 12 }}>{hasMatches ? '\u21BB Regenerate' : '\u25B6 Generate Matches'}</button>}
                  {hasMatches && !stageStarted && stage.stage_type === 'group' && !isEditing && <button className="admin-btn secondary" onClick={() => startEditGroups(stage.id)} style={{ fontSize: 12 }}>{'\u270E'} Edit Groups</button>}
                  {stage.stage_type === 'elimination' && hasTBD && <button className="admin-btn primary" onClick={() => handleAdvanceWinners(stage)} style={{ fontSize: 12, background: '#2a3a2a' }}>{'\u2191'} Advance Winners</button>}
                  {hasFinishedUnlocked && <span style={{ fontSize: 11, color: '#d4a843', alignSelf: 'center' }}>{'\u26A0'} Lock finished matches for auto-advancement</span>}
                </div>
                {!canGen && !hasMatches && <div style={{ fontSize: 12, color: '#d4a843', marginBottom: 12, padding: '6px 10px', background: '#2a2215', borderRadius: 6 }}>Waiting for Stage {stage.stage_number - 1} to complete</div>}

                {/* ── Group editing mode ── */}
                {isEditing && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: '#5b9bd5', marginBottom: 8 }}>Click a player to select, then click another to swap — or click a group header to move them there.</div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                      {editGroups.map((eg, gi) => (
                        <div key={gi} style={{ background: '#14141f', borderRadius: 8, border: '1px solid #2a2a3e', padding: 12, minWidth: 180 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#d4a843', cursor: selectedPlayerKey ? 'pointer' : 'default' }}
                              onClick={() => selectedPlayerKey && handleMoveToGroup(gi)}>{eg.groupName} ({eg.participants.length})</span>
                            {eg.participants.length === 0 && <button className="admin-btn small danger" onClick={() => handleRemoveGroup(gi)} style={{ fontSize: 10, padding: '1px 6px' }}>{'\u2715'}</button>}
                          </div>
                          {selectedPlayerKey && selectedGroupIdx !== gi && (
                            <div onClick={() => handleMoveToGroup(gi)} style={{ padding: '4px 8px', background: '#1a2a3a', borderRadius: 4, fontSize: 11, color: '#5b9bd5', cursor: 'pointer', marginBottom: 4, textAlign: 'center' }}>
                              {'\u2193'} Move here
                            </div>
                          )}
                          {eg.participants.map(p => {
                            const pk = pKey(p);
                            const isSel = selectedPlayerKey === pk;
                            return (<div key={pk} onClick={() => handlePlayerClick(gi, pk)}
                              style={{ padding: '4px 8px', margin: '2px 0', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#ddd',
                                background: isSel ? '#2a3a2a' : '#0d0d14', border: isSel ? '1px solid #4ecb71' : '1px solid transparent' }}>
                              {sideLabel(p.playerIds)}
                            </div>);
                          })}
                        </div>
                      ))}
                      <div onClick={handleAddGroup} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#14141f', borderRadius: 8, border: '1px dashed #2a2a3e', padding: 12, minWidth: 80, cursor: 'pointer', color: '#555', fontSize: 24 }}>+</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-btn primary" onClick={handleSaveGroupEdits} style={{ fontSize: 12 }}>{'\u2713'} Save Groups</button>
                      <button className="admin-btn secondary" onClick={() => { setEditingStageId(null); setEditGroups([]); }} style={{ fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* ── Actual group cards ── */}
                {!isEditing && hasMatches && stage.stage_type === 'group' && groups.length > 0 && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    {groups.map(g => {
                      const gm = matches.filter(m => m.group_id === g.id);
                      const ps = new Map();
                      gm.forEach(m => { if (m.side_a) ps.set(m.side_a.sort().join(','), m.side_a); if (m.side_b) ps.set(m.side_b.sort().join(','), m.side_b); });
                      return (
                        <div key={g.id} style={{ background: '#14141f', borderRadius: 8, border: '1px solid #1e1e2e', padding: 12, minWidth: 220 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#d4a843', marginBottom: 8 }}>{g.name} ({ps.size})</div>
                          {[...ps.values()].map((pIds, i) => <div key={i} style={{ padding: '3px 0', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a2e' }}>{sideLabel(pIds)}</div>)}
                          {standings[g.id] && renderStandings(standings[g.id], advCount, stage.id, g.id)}
                          <div style={{ marginTop: 8, fontSize: 11 }}>
                            {gm.map(m => {
                              const sc = (m.score_data?.sets || []).map(s => s.side_a_points + '-' + s.side_b_points).join(', ');
                              return (<div key={m.id} style={{ padding: '3px 0', borderBottom: '1px solid #0d0d14', display: 'flex', justifyContent: 'space-between' }}>
                                <span><span style={{ color: m.winner === 'side_a' ? '#4ecb71' : '#bbb' }}>{sideLabel(m.side_a)}</span><span style={{ color: '#444' }}> v </span><span style={{ color: m.winner === 'side_b' ? '#4ecb71' : '#bbb' }}>{sideLabel(m.side_b)}</span></span>
                                <span style={{ color: '#888' }}>{sc || '\u2014'}</span>
                              </div>);
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Round robin / Elimination display */}
                {!isEditing && hasMatches && stage.stage_type === 'round_robin' && (
                  <div style={{ marginBottom: 12 }}>
                    {standings['_all'] && renderStandings(standings['_all'], cfg.advancement_count || 2, stage.id, null)}
                    <div style={{ marginTop: 8, fontSize: 11 }}>{matches.map(m => {
                      const sc = (m.score_data?.sets || []).map(s => s.side_a_points + '-' + s.side_b_points).join(', ');
                      return (<div key={m.id} style={{ padding: '3px 0', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between' }}>
                        <span><span style={{ color: m.winner === 'side_a' ? '#4ecb71' : '#bbb' }}>{sideLabel(m.side_a)}</span><span style={{ color: '#444' }}> v </span><span style={{ color: m.winner === 'side_b' ? '#4ecb71' : '#bbb' }}>{sideLabel(m.side_b)}</span></span>
                        <span style={{ color: '#888' }}>{sc || '\u2014'}</span></div>);
                    })}</div>
                  </div>
                )}
                {!isEditing && hasMatches && stage.stage_type === 'elimination' && (
                  <div style={{ marginBottom: 12 }}>{[...matches].sort((a, b) => {
                    const order = { quarterfinal: 1, semifinal: 2, third_place: 3, final: 4 };
                    const oa = order[a.stage] || 0, ob = order[b.stage] || 0;
                    if (oa !== ob) return oa - ob;
                    return (a.bracket_position || 0) - (b.bracket_position || 0);
                  }).map(m => {
                    const sc = (m.score_data?.sets || []).map(s => s.side_a_points + '-' + s.side_b_points).join(', ');
                    return (<div key={m.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #1a1a2e', fontSize: 12 }}>
                      <span style={{ color: '#d4a843', fontWeight: 600, minWidth: 80 }}>{({ quarterfinal: 'QF', semifinal: 'Semi', third_place: 'Bronze', final: 'Final' }[m.stage]) || m.stage}</span>
                      <span style={{ flex: 1 }}><span style={{ color: m.winner === 'side_a' ? '#4ecb71' : (m.side_a ? '#bbb' : '#555') }}>{sideLabel(m.side_a)}</span><span style={{ color: '#444' }}> vs </span><span style={{ color: m.winner === 'side_b' ? '#4ecb71' : (m.side_b ? '#bbb' : '#555') }}>{sideLabel(m.side_b)}</span></span>
                      <span style={{ color: '#888' }}>{sc || (m.default_win ? 'W/O' : '\u2014')}</span>
                    </div>);
                  })}</div>
                )}

                {/* No matches: placeholder preview */}
                {!isEditing && !hasMatches && <div style={{ marginBottom: 12 }}>{renderPlaceholderPreview(stage)}</div>}

                {/* Complete / advancement */}
                {stage.status !== 'completed' && stage.stage_type !== 'elimination' && hasMatches && stageStarted && (
                  <button className="admin-btn primary" onClick={() => handleCompleteStage(stage)} style={{ marginTop: 8, fontSize: 12, background: '#2a4a2a', borderColor: '#4ecb71' }}>{'\u2713'} Mark Stage Complete</button>
                )}
                {stage.status === 'completed' && stage.stage_type !== 'elimination' && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#152a15', borderRadius: 6, fontSize: 12, color: '#4ecb71' }}>{'\u2713'} Complete {'\u2014'} {getExpectedCount(stage.stage_number + 1)} advancing</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {stages.length > 0 && canAddStage && <div style={{ textAlign: 'center', color: '#555', fontSize: 18, margin: '4px 0' }}>{'\u25BC'}</div>}

      {/* Add stage */}
      {canAddStage && participants.length >= 4 && (!addingStage ? (
        <button className="admin-btn primary" onClick={() => { setAddingStage(true); setNewStageType(stages.length === 0 ? 'group' : 'group'); setNewStageConfig({ games_per_match: 1, target_group_size: 4, advancement_counts: { uniform: true, count: 2 }, advancement_count: 2, third_place_match: false }); }}>+ Add Stage {stages.length + 1}</button>
      ) : (
        <div style={{ background: '#14141f', borderRadius: 10, border: '1px solid #2a2a3e', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', marginBottom: 12 }}>New Stage {stages.length + 1} <span style={{ fontWeight: 400, fontSize: 12, color: '#888' }}>({getExpectedCount(stages.length + 1)} participants)</span></div>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Format</label>
            <div style={{ display: 'flex', gap: 8 }}>{(stages.length === 0 ? ['group', 'round_robin'] : ['group', 'round_robin', 'elimination']).map(t => (
              <button key={t} className={'admin-btn ' + (newStageType === t ? 'primary' : 'secondary')} onClick={() => setNewStageType(t)} style={{ fontSize: 12, padding: '6px 14px' }}>{STAGE_TYPE_LABELS[t]}</button>
            ))}</div>
            {stages.length === 0 && <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>First stage must be Group or Round Robin</p>}</div>

          {newStageType === 'group' && (<>
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Target group size</label>
              <div style={{ display: 'flex', gap: 6 }}>{[3, 4, 5].map(n => <button key={n} className={'admin-btn ' + (newStageConfig.target_group_size === n ? 'primary' : 'secondary')} onClick={() => setNewStageConfig({ ...newStageConfig, target_group_size: n })} style={{ fontSize: 12, padding: '4px 12px' }}>{n}</button>)}</div></div>
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Advance per group</label>
              <div style={{ display: 'flex', gap: 6 }}>{[1, 2, 3].map(n => <button key={n} className={'admin-btn ' + (newStageConfig.advancement_counts.count === n ? 'primary' : 'secondary')} onClick={() => setNewStageConfig({ ...newStageConfig, advancement_counts: { uniform: true, count: n } })} style={{ fontSize: 12, padding: '4px 12px' }}>Top {n}</button>)}</div></div>
          </>)}
          {newStageType === 'round_robin' && (
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Advance count</label>
              <div style={{ display: 'flex', gap: 6 }}>{[2, 3, 4, 6, 8].map(n => <button key={n} className={'admin-btn ' + (newStageConfig.advancement_count === n ? 'primary' : 'secondary')} onClick={() => setNewStageConfig({ ...newStageConfig, advancement_count: n })} style={{ fontSize: 12, padding: '4px 12px' }}>Top {n}</button>)}</div></div>
          )}
          {newStageType === 'elimination' && (
            <div style={{ marginBottom: 12 }}><label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888', cursor: 'pointer' }}>
              <input type="checkbox" checked={newStageConfig.third_place_match} onChange={e => setNewStageConfig({ ...newStageConfig, third_place_match: e.target.checked })} /> Include 3rd place match</label></div>
          )}

          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#0d0d14', borderRadius: 6, fontSize: 12, color: '#888' }}>{(() => {
            const c = getExpectedCount(stages.length + 1);
            if (newStageType === 'elimination') return c + ' participants \u2192 ' + (c === 4 ? 'SF + Final' : c === 8 ? 'QF + SF + Final' : c === 2 ? 'Final' : '\u26A0 Need 2, 4, or 8');
            if (newStageType === 'group') { const ng = Math.max(1, Math.round(c / newStageConfig.target_group_size)); const adv = newStageConfig.advancement_counts.count; return c + ' \u2192 ' + ng + ' group(s) \u2192 top ' + adv + ' = ' + (ng * adv) + ' advancing'; }
            if (newStageType === 'round_robin') return c + ' \u2192 all play \u2192 top ' + newStageConfig.advancement_count + ' advance';
            return '';
          })()}</div>
          <div style={{ display: 'flex', gap: 8 }}><button className="admin-btn primary" onClick={handleAddStage} style={{ fontSize: 12 }}>Add Stage</button>
            <button className="admin-btn secondary" onClick={() => setAddingStage(false)} style={{ fontSize: 12 }}>Cancel</button></div>
        </div>
      ))}

      {stages.length === 0 && participants.length >= 4 && !addingStage && <div className="admin-empty"><p>No stages. Click "+ Add Stage 1" to begin.</p></div>}
      {participants.length < 4 && participants.length > 0 && <div className="admin-empty"><p>Need 4+ participants ({participants.length} registered).</p></div>}
    </div>
  );
}