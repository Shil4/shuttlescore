import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useShiftSelect } from '../../hooks/useShiftSelect';
import './AdminComponents.css';
import './PlayerManager.css';

// ── Helpers ──
function computeAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getPlayerAge(player) {
  if (player.date_of_birth) return computeAge(player.date_of_birth);
  if (player.age_override != null && player.age_as_of) {
    const yearsDiff = new Date().getFullYear() - new Date(player.age_as_of).getFullYear();
    return player.age_override + yearsDiff;
  }
  if (player.age_override != null) return player.age_override;
  return null;
}

function parseDOB(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const slash = str.split('/');
  if (slash.length === 3) {
    const m = parseInt(slash[0], 10), d = parseInt(slash[1], 10), y = parseInt(slash[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const dash = str.split(/[-\.]/);
  if (dash.length === 3) {
    const a = parseInt(dash[0], 10), b = parseInt(dash[1], 10), c = parseInt(dash[2], 10);
    if (a >= 1900 && a <= 2100 && b >= 1 && b <= 12 && c >= 1 && c <= 31)
      return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
    if (c >= 1900 && c <= 2100 && b >= 1 && b <= 12 && a >= 1 && a <= 31)
      return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString().split('T')[0];
  return null;
}

function getDOBWarnings(dobStr) {
  const w = [];
  if (!dobStr) { w.push('No DOB'); return w; }
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) { w.push('Invalid date'); return w; }
  const age = computeAge(dobStr);
  if (dob > new Date()) w.push('Future date');
  if (age !== null && age < 3) w.push(`Age ${age} — too young?`);
  if (age !== null && age > 80) w.push(`Age ${age} — very old?`);
  const year = dob.getFullYear(), cur = new Date().getFullYear();
  if (year >= cur - 2 && year <= cur) w.push('Born very recently — typo?');
  if (year > cur) w.push('Future year');
  return w;
}

function fuzzyMatch(name, candidates) {
  const lower = name.toLowerCase().trim();
  const results = [];
  for (const c of candidates) {
    const cl = c.name.toLowerCase().trim();
    if (cl === lower) { results.push({ ...c, score: 1.0 }); continue; }
    const wA = new Set(lower.split(/\s+/)), wB = new Set(cl.split(/\s+/));
    const shared = [...wA].filter(w => wB.has(w)).length;
    const score = shared / Math.max(wA.size, wB.size);
    if (score >= 0.5) results.push({ ...c, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

function findColumnIndex(headers, ...names) {
  for (const n of names) {
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(n.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ',') { result.push(cur.trim()); cur = ''; } else cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

export default function PlayerManager() {
  const [players, setPlayers] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Folder management
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState(new Set());

  // Player form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', gender: 'male', date_of_birth: '', age_override: '', folder_id: '' });

  // Multi-select mode (for delete + move folder)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [moveToFolderId, setMoveToFolderId] = useState('__none__');

  // CSV import
  const [csvReviewData, setCsvReviewData] = useState(null);
  const [csvSelected, setCsvSelected] = useState(new Set());
  const [csvImportFolderId, setCsvImportFolderId] = useState('');
  const [linkingIndex, setLinkingIndex] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [{ data: p }, { data: f }] = await Promise.all([
        supabase.from('players').select('*').order('name'),
        supabase.from('player_folders').select('*').order('sort_order').order('name'),
      ]);
      setPlayers(p || []);
      setFolders(f || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ── Folder CRUD ──
  const handleFolderSubmit = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    try {
      if (editingFolderId) {
        await supabase.from('player_folders').update({ name: folderName.trim() }).eq('id', editingFolderId);
      } else {
        await supabase.from('player_folders').insert({ name: folderName.trim(), sort_order: folders.length });
      }
      setFolderName(''); setEditingFolderId(null); setShowFolderForm(false);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  const handleDeleteFolder = async (folderId) => {
    const playersInFolder = players.filter(p => p.folder_id === folderId);
    if (!window.confirm(`Delete this folder? ${playersInFolder.length} player(s) will be moved to "Unfiled".`)) return;
    try {
      await supabase.from('players').update({ folder_id: null }).eq('folder_id', folderId);
      await supabase.from('player_folders').delete().eq('id', folderId);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => { const n = new Set(prev); if (n.has(folderId)) n.delete(folderId); else n.add(folderId); return n; });
  };

  // ── Player CRUD ──
  const resetForm = () => { setForm({ name: '', gender: 'male', date_of_birth: '', age_override: '', folder_id: '' }); setEditingId(null); setShowForm(false); };

  const handleEdit = (player) => {
    setForm({
      name: player.name, gender: player.gender || 'male',
      date_of_birth: player.date_of_birth || '',
      age_override: player.age_override != null ? String(player.age_override) : '',
      folder_id: player.folder_id || '',
    });
    setEditingId(player.id); setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.date_of_birth && !form.age_override) { setError('Enter either Date of Birth or Age.'); return; }
    const payload = { name: form.name.trim(), gender: form.gender, folder_id: form.folder_id || null };
    if (form.date_of_birth) { payload.date_of_birth = form.date_of_birth; payload.age_override = null; payload.age_as_of = null; }
    else if (form.age_override) { payload.date_of_birth = null; payload.age_override = parseInt(form.age_override, 10); payload.age_as_of = new Date().toISOString().split('T')[0]; }
    try {
      if (editingId) await supabase.from('players').update(payload).eq('id', editingId);
      else await supabase.from('players').insert(payload);
      resetForm(); await loadAll();
    } catch (err) { setError('Failed to save: ' + err.message); }
  };

  const handleDelete = async (id) => {
    const { data: regs } = await supabase.from('player_registrations').select('id').or(`player_id.eq.${id},partner_id.eq.${id}`).limit(1);
    if (regs && regs.length > 0) { alert('Player is in events — cannot delete.'); return; }
    if (!window.confirm('Delete this player?')) return;
    try {
      await supabase.from('tournament_players').delete().eq('player_id', id);
      await supabase.from('players').delete().eq('id', id);
      await loadAll();
    } catch (err) { setError(err.message); }
  };

  // ── Bulk operations ──
  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const orFilter = ids.map(id => `player_id.eq.${id},partner_id.eq.${id}`).join(',');
    const { data: regs } = await supabase.from('player_registrations').select('player_id, partner_id').or(orFilter);
    const blockedIds = new Set();
    (regs || []).forEach(r => { if (selected.has(r.player_id)) blockedIds.add(r.player_id); if (r.partner_id && selected.has(r.partner_id)) blockedIds.add(r.partner_id); });
    const deletable = ids.filter(id => !blockedIds.has(id));
    let msg = `Delete ${deletable.length} player(s)?`;
    if (blockedIds.size > 0) msg += `\n\n${blockedIds.size} in events will be skipped.`;
    if (deletable.length === 0) { alert('All selected are in events.'); return; }
    if (!window.confirm(msg)) return;
    try {
      await supabase.from('tournament_players').delete().in('player_id', deletable);
      await supabase.from('players').delete().in('id', deletable);
      setSelected(new Set()); setSelectMode(false); await loadAll();
    } catch (err) { setError(err.message); }
  };

  const handleBulkMoveFolder = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const folderId = moveToFolderId === '__none__' ? null : moveToFolderId;
    const folderLabel = folderId ? folders.find(f => f.id === folderId)?.name || 'folder' : 'Unfiled';
    if (!window.confirm(`Move ${ids.length} player(s) to "${folderLabel}"?`)) return;
    try {
      const { error: err } = await supabase.from('players').update({ folder_id: folderId }).in('id', ids);
      if (err) throw err;
      setSelected(new Set()); await loadAll();
    } catch (err) { setError(err.message); }
  };

  // ── CSV Import ──
  const handleCSVUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return; e.target.value = '';
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { setError('CSV has no data rows.'); return; }
      const headers = parseCSVLine(lines[0]);
      const nameIdx = findColumnIndex(headers, 'name');
      const dobIdx = findColumnIndex(headers, 'date of birth', 'dob', 'birth');
      const genderIdx = findColumnIndex(headers, 'sex', 'gender');
      if (nameIdx < 0) { setError('CSV must have a "Name" column.'); return; }
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const rawName = (values[nameIdx] || '').trim();
        if (!rawName) continue;
        const rawDob = dobIdx >= 0 ? (values[dobIdx] || '').trim() : '';
        const rawGender = genderIdx >= 0 ? (values[genderIdx] || '').trim().toLowerCase() : '';
        const parsedDob = parseDOB(rawDob);
        const age = parsedDob ? computeAge(parsedDob) : null;
        const dobWarnings = parsedDob ? getDOBWarnings(parsedDob) : (rawDob ? ['Could not parse'] : []);
        const gender = rawGender.startsWith('f') ? 'female' : 'male';
        const matches = fuzzyMatch(rawName, players);
        rows.push({ rawName, name: rawName, rawDob, dob: parsedDob, age, gender, dobWarnings, matches, linkedPlayerId: null,
          status: matches.length > 0 && matches[0].score >= 0.8 ? 'duplicate_likely' : 'new' });
      }
      setCsvReviewData(rows);
      const auto = new Set();
      rows.forEach((row, i) => { if (!isNameBlocked(row.name, i, rows)) auto.add(i); });
      setCsvSelected(auto);
      setError('');
    } catch (err) { setError('Failed to parse CSV: ' + err.message); }
  };

  const isNameBlocked = (name, rowIndex, allRows) => {
    const lower = name.toLowerCase().trim();
    if (players.some(p => p.name.toLowerCase().trim() === lower)) return 'exists_in_registry';
    if (allRows) { for (let j = 0; j < rowIndex; j++) { if (allRows[j].name.toLowerCase().trim() === lower) return 'duplicate_in_csv'; } }
    return false;
  };

  const csvBlockStatus = useMemo(() => {
    if (!csvReviewData) return [];
    return csvReviewData.map((row, i) => row.linkedPlayerId ? false : isNameBlocked(row.name, i, csvReviewData));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvReviewData, players]);

  useEffect(() => {
    if (!csvReviewData) return;
    setCsvSelected(prev => { const n = new Set(prev); csvBlockStatus.forEach((b, i) => { if (b) n.delete(i); }); return n; });
  }, [csvBlockStatus, csvReviewData]);

  const toggleAllCsv = () => {
    if (!csvReviewData) return;
    const selectable = csvReviewData.map((_, i) => i).filter(i => !csvBlockStatus[i]);
    const allSel = selectable.every(i => csvSelected.has(i));
    setCsvSelected(allSel ? new Set() : new Set(selectable));
  };

  const updateCsvRow = (index, field, value) => {
    setCsvReviewData(prev => {
      const n = [...prev]; n[index] = { ...n[index], [field]: value };
      if (field === 'dob') { n[index].age = computeAge(value); n[index].dobWarnings = getDOBWarnings(value); }
      return n;
    });
  };

  const linkToExisting = (csvIndex, playerId) => {
    setCsvReviewData(prev => { const n = [...prev]; n[csvIndex] = { ...n[csvIndex], linkedPlayerId: playerId, status: 'linked' }; return n; });
    setLinkingIndex(null); setLinkSearch('');
  };

  const unlinkPlayer = (csvIndex) => {
    setCsvReviewData(prev => { const n = [...prev]; const m = fuzzyMatch(n[csvIndex].name, players);
      n[csvIndex] = { ...n[csvIndex], linkedPlayerId: null, status: m.length > 0 && m[0].score >= 0.8 ? 'duplicate_likely' : 'new' }; return n; });
  };

  const handleImportConfirm = async () => {
    setError(''); let linked = 0;
    const toInsert = [];
    try {
      for (const idx of csvSelected) {
        const row = csvReviewData[idx];
        if (row.linkedPlayerId) { linked++; continue; }
        if (csvBlockStatus[idx]) continue;
        const payload = { name: row.name.trim(), gender: row.gender, folder_id: csvImportFolderId || null };
        if (row.dob && row.dobWarnings.length === 0) payload.date_of_birth = row.dob;
        else if (row.age != null && row.dobWarnings.length === 0) { payload.age_override = row.age; payload.age_as_of = new Date().toISOString().split('T')[0]; }
        toInsert.push(payload);
      }
      if (toInsert.length > 0) { const { error: err } = await supabase.from('players').insert(toInsert); if (err) throw err; }
      alert(`Import complete: ${toInsert.length} new, ${linked} linked.`);
      setCsvReviewData(null); setCsvSelected(new Set()); setCsvImportFolderId(''); await loadAll();
    } catch (err) { setError('Import failed: ' + err.message); }
  };

  // ── Computed lists ──
  const filteredPlayers = useMemo(() =>
    players.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [players, search]);

  // Group players by folder for display
  const playersByFolder = useMemo(() => {
    const map = new Map(); // folderId -> players[]
    map.set(null, []); // unfiled
    folders.forEach(f => map.set(f.id, []));
    filteredPlayers.forEach(p => {
      const fid = p.folder_id || null;
      if (!map.has(fid)) map.set(null, [...(map.get(null) || []), p]);
      else map.get(fid).push(p);
    });
    return map;
  }, [filteredPlayers, folders]);

  // Flat ordered list for shift-select (folder order, then unfiled)
  const orderedPlayers = useMemo(() => {
    const result = [];
    folders.forEach(f => {
      if (expandedFolders.has(f.id) || selectMode) {
        (playersByFolder.get(f.id) || []).forEach(p => result.push(p));
      }
    });
    // Unfiled always visible
    (playersByFolder.get(null) || []).forEach(p => result.push(p));
    return result;
  }, [folders, playersByFolder, expandedFolders, selectMode]);

  const linkResults = useMemo(() => {
    if (linkingIndex === null) return [];
    const row = csvReviewData[linkingIndex]; if (!row) return [];
    if (linkSearch) return players.filter(p => p.name.toLowerCase().includes(linkSearch.toLowerCase()));
    const fuzzy = fuzzyMatch(row.name, players);
    const ids = new Set(fuzzy.map(f => f.id));
    return [...fuzzy, ...players.filter(p => !ids.has(p.id))];
  }, [linkingIndex, csvReviewData, players, linkSearch]);

  // ── Shift-select hooks ──
  const getDeleteKey = useCallback((p) => p.id, []);
  const { handleClick: handleDeleteClick } = useShiftSelect(setSelected, orderedPlayers, getDeleteKey);

  // Map player ID → flat index in orderedPlayers for O(1) lookups
  const deleteIndexMap = useMemo(() => {
    const m = new Map();
    orderedPlayers.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [orderedPlayers]);

  const getCsvKey = useCallback((_, i) => i, []);
  const isCsvDisabled = useCallback((_, i) => !!csvBlockStatus[i], [csvBlockStatus]);
  const { handleClick: handleCsvClick } = useShiftSelect(setCsvSelected, csvReviewData || [], getCsvKey, isCsvDisabled);

  if (loading) return <div className="admin-loading">Loading players...</div>;

  // ── CSV Review Mode ──
  if (csvReviewData) {
    const selectableCount = csvReviewData.filter((_, i) => !csvBlockStatus[i]).length;
    const blockedCount = csvBlockStatus.filter(b => b).length;

    return (
      <div className="admin-section" style={{ maxWidth: 1100 }}>
        <div className="admin-section-header">
          <h2>Review CSV Import</h2>
          <div className="admin-header-actions">
            <select value={csvImportFolderId} onChange={e => setCsvImportFolderId(e.target.value)}
              className="csv-folder-select" title="Import into folder">
              <option value="">No folder (Unfiled)</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button className="admin-btn primary" onClick={handleImportConfirm} disabled={csvSelected.size === 0}>
              ✓ Import {csvSelected.size} Selected
            </button>
            <button className="admin-btn secondary" onClick={() => { setCsvReviewData(null); setCsvSelected(new Set()); }}>Cancel</button>
          </div>
        </div>
        {error && <div className="admin-error">{error}</div>}
        <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
          Review below. Fix names/DOBs as needed. Hold <strong>Shift</strong> to select a range.
          {blockedCount > 0 && <span style={{ color: '#e85454' }}> {blockedCount} blocked (duplicate names).</span>}
        </p>
        <div className="csv-review-controls">
          <label className="csv-toggle-all" onClick={toggleAllCsv}>
            <input type="checkbox" checked={csvSelected.size === selectableCount && selectableCount > 0} readOnly />
            Select All ({selectableCount})
          </label>
          <span style={{ color: '#666', fontSize: 12 }}>⚠️ = DOB warning · 🚫 = blocked · 🔗 = match found · Hold Shift to select range</span>
        </div>

        {linkingIndex !== null && (
          <div className="pub-overlay" onClick={() => { setLinkingIndex(null); setLinkSearch(''); }}>
            <div className="link-modal" onClick={e => e.stopPropagation()}>
              <div className="link-modal-header">
                <h3>Link "{csvReviewData[linkingIndex]?.name}" to existing</h3>
                <button className="pub-profile-close" onClick={() => { setLinkingIndex(null); setLinkSearch(''); }}>✕</button>
              </div>
              <input type="text" placeholder="Search..." value={linkSearch} onChange={e => setLinkSearch(e.target.value)} className="link-search-input" autoFocus />
              <div className="link-results">
                {linkResults.map(p => (
                  <div key={p.id} className={`link-result-item ${p.score >= 0.8 ? 'strong-match' : ''}`} onClick={() => linkToExisting(linkingIndex, p.id)}>
                    <span className="link-result-name">{p.name}</span>
                    <span className="link-result-meta">{p.gender === 'female' ? 'F' : 'M'}{getPlayerAge(p) != null && ` · ${getPlayerAge(p)}y`}{p.score != null && ` · ${Math.round(p.score * 100)}%`}</span>
                  </div>
                ))}
                {linkResults.length === 0 && <p style={{ color: '#555', fontSize: 13, padding: 12 }}>No players found.</p>}
              </div>
            </div>
          </div>
        )}

        <div className="csv-review-table-wrap">
          <table className="csv-review-table">
            <thead><tr><th></th><th>#</th><th>Name</th><th>Gender</th><th>DOB</th><th>Age</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {csvReviewData.map((row, i) => {
                const linked = row.linkedPlayerId ? players.find(p => p.id === row.linkedPlayerId) : null;
                const blocked = csvBlockStatus[i];
                const hasW = row.dobWarnings && row.dobWarnings.length > 0;
                return (
                  <tr key={i} className={`${!csvSelected.has(i) ? 'deselected' : ''} ${hasW ? 'warning-row' : ''} ${blocked ? 'blocked-row' : ''}`}>
                    <td>{blocked && !row.linkedPlayerId
                      ? <span className="csv-blocked-icon" title={blocked === 'exists_in_registry' ? 'In registry' : 'Duplicate in CSV'}>🚫</span>
                      : <input type="checkbox" checked={csvSelected.has(i)} readOnly onClick={(e) => handleCsvClick(e, i)} disabled={!!blocked} />}
                    </td>
                    <td className="csv-row-num">{i + 1}</td>
                    <td>{row.linkedPlayerId ? <span className="csv-linked-name">🔗 {linked?.name || 'Linked'}</span>
                      : <input type="text" value={row.name} onChange={e => updateCsvRow(i, 'name', e.target.value)} className={`csv-inline-input ${blocked ? 'csv-input-blocked' : ''}`} />}
                      {blocked && !row.linkedPlayerId && <div className="csv-blocked-hint">{blocked === 'exists_in_registry' ? 'Already in registry' : 'Duplicate in CSV'}</div>}
                    </td>
                    <td><select value={row.gender} onChange={e => updateCsvRow(i, 'gender', e.target.value)} className="csv-inline-select"><option value="male">M</option><option value="female">F</option></select></td>
                    <td>{hasW && <span className="csv-warning" title={row.dobWarnings.join(', ')}>⚠️</span>}
                      <input type="date" value={row.dob || ''} onChange={e => updateCsvRow(i, 'dob', e.target.value)} className="csv-inline-input csv-date-input" />
                      {hasW && <div className="csv-warning-text">{row.dobWarnings.join(', ')}</div>}
                    </td>
                    <td className="csv-age">{row.age != null ? row.age : '—'}</td>
                    <td><span className={`csv-status ${row.status} ${blocked ? 'blocked' : ''}`}>{blocked ? '🚫 Blocked' : row.status === 'linked' ? '🔗 Linked' : row.status === 'duplicate_likely' ? '🔗 Match?' : 'New'}</span></td>
                    <td>{row.linkedPlayerId
                      ? <button className="admin-btn small" onClick={() => unlinkPlayer(i)}>Unlink</button>
                      : <button className="admin-btn small" onClick={() => { setLinkingIndex(i); setLinkSearch(''); }}
                          style={row.matches.length > 0 && row.matches[0].score >= 0.5 ? { borderColor: '#d4a843', color: '#d4a843' } : {}}>
                          {row.matches.length > 0 && row.matches[0].score >= 0.5 ? '🔗 Link' : 'Link'}
                        </button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Normal View ──
  const renderPlayerItem = (p) => {
    const age = getPlayerAge(p);
    const flatIdx = deleteIndexMap.get(p.id);
    return (
      <div key={p.id} className="admin-list-item">
        {selectMode && flatIdx !== undefined && (
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginRight: 10 }}
            onClick={(e) => { e.preventDefault(); handleDeleteClick(e, flatIdx); }}>
            <input type="checkbox" checked={selected.has(p.id)} readOnly />
          </label>
        )}
        <div className="admin-list-main">
          <div className="admin-list-title">{p.name}</div>
          <div className="admin-list-meta">
            <span className="admin-category-badge">{p.gender === 'female' ? 'F' : 'M'}</span>
            {age != null && <span>{age} years</span>}
            {p.date_of_birth && <span>DOB: {p.date_of_birth}</span>}
          </div>
        </div>
        {!selectMode && (
          <div className="admin-list-right">
            <button className="admin-btn small" onClick={() => handleEdit(p)}>Edit</button>
            <button className="admin-btn small danger" onClick={() => handleDelete(p.id)}>Delete</button>
          </div>
        )}
      </div>
    );
  };

  const unfiledPlayers = playersByFolder.get(null) || [];

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Player Registry</h2>
        <div className="admin-header-actions">
          <label className="admin-btn secondary csv-btn">📄 Import CSV<input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} /></label>
          <button className="admin-btn primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Add Player</button>
          <button className="admin-btn secondary" onClick={() => setShowFolderForm(!showFolderForm)}>📁 Folders</button>
          {!selectMode
            ? <button className="admin-btn secondary" onClick={() => { setSelectMode(true); setSelected(new Set()); }}>☑ Select</button>
            : <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#aaa' }}>{selected.size} selected</span>
                <button className="admin-btn danger" onClick={handleBulkDelete} disabled={selected.size === 0}>🗑 Delete</button>
                <select value={moveToFolderId} onChange={e => setMoveToFolderId(e.target.value)} style={{ padding: '5px 8px', background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 6, color: '#f0f0f0', fontSize: 12 }}>
                  <option value="__none__">Move to…</option>
                  <option value="">Unfiled</option>
                  {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
                </select>
                <button className="admin-btn secondary" onClick={handleBulkMoveFolder} disabled={selected.size === 0 || moveToFolderId === '__none__'}>Move</button>
                <button className="admin-btn secondary" onClick={() => { setSelectMode(false); setSelected(new Set()); setMoveToFolderId('__none__'); }}>Done</button>
              </div>}
        </div>
      </div>
      {error && <div className="admin-error">{error}</div>}

      {/* Folder form */}
      {showFolderForm && (
        <div className="admin-form-card">
          <h3>{editingFolderId ? 'Edit Folder' : 'New Folder'}</h3>
          <form onSubmit={handleFolderSubmit} className="admin-form" style={{ flexDirection: 'row', gap: 10, alignItems: 'end' }}>
            <div className="admin-field" style={{ flex: 1 }}><label>Folder Name</label>
              <input type="text" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="e.g. BVBL Apartments" required />
            </div>
            <button type="submit" className="admin-btn primary">{editingFolderId ? 'Save' : 'Create'}</button>
            <button type="button" className="admin-btn secondary" onClick={() => { setShowFolderForm(false); setEditingFolderId(null); setFolderName(''); }}>Cancel</button>
          </form>
          {folders.length > 0 && (
            <div className="folder-list">
              {folders.map(f => (
                <div key={f.id} className="folder-list-item">
                  <span>📁 {f.name} <span style={{ color: '#666', fontSize: 11 }}>({(playersByFolder.get(f.id) || []).length})</span></span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="admin-btn small" onClick={() => { setEditingFolderId(f.id); setFolderName(f.name); }}>Edit</button>
                    <button className="admin-btn small danger" onClick={() => handleDeleteFolder(f.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player form */}
      {showForm && (
        <div className="admin-form-card">
          <h3>{editingId ? 'Edit Player' : 'Add Player'}</h3>
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Full Name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Player name" required />
              </div>
              <div className="admin-field"><label>Gender</label>
                <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}><option value="male">Male</option><option value="female">Female</option></select>
              </div>
              <div className="admin-field"><label>Folder</label>
                <select value={form.folder_id} onChange={e => setForm({ ...form, folder_id: e.target.value })}>
                  <option value="">Unfiled</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Date of Birth</label>
                <input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value, age_override: '' })} />
              </div>
              <div className="admin-field"><label>Or Age (if DOB unknown)</label>
                <input type="number" min="1" max="100" value={form.age_override} onChange={e => setForm({ ...form, age_override: e.target.value, date_of_birth: '' })} placeholder="e.g. 28" />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">{editingId ? 'Save Changes' : 'Add Player'}</button>
              <button type="button" className="admin-btn secondary" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="admin-search">
        <input type="text" placeholder="Search players..." value={search} onChange={e => setSearch(e.target.value)} />
        <span className="admin-count">{filteredPlayers.length} players</span>
        {selectMode && <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>Hold Shift to select range</span>}
      </div>

      {/* Folders */}
      {folders.map(folder => {
        const fPlayers = playersByFolder.get(folder.id) || [];
        if (fPlayers.length === 0 && search) return null;
        const expanded = expandedFolders.has(folder.id) || selectMode;
        return (
          <div key={folder.id} className="player-folder">
            <div className="player-folder-header" onClick={() => toggleFolder(folder.id)}>
              <span>{expanded ? '▾' : '▸'} 📁 {folder.name}</span>
              <span className="player-folder-count">{fPlayers.length}</span>
            </div>
            {expanded && (
              <div className="player-folder-body">
                {fPlayers.length === 0 ? <p style={{ color: '#555', fontSize: 13, padding: '6px 12px' }}>No players in this folder.</p>
                  : fPlayers.map(p => renderPlayerItem(p))}
              </div>
            )}
          </div>
        );
      })}

      {/* Unfiled */}
      {unfiledPlayers.length > 0 && (
        <div className="player-folder">
          {folders.length > 0 && <div className="player-folder-header"><span>📄 Unfiled</span><span className="player-folder-count">{unfiledPlayers.length}</span></div>}
          <div className={folders.length > 0 ? 'player-folder-body' : 'admin-list'}>
            {unfiledPlayers.map(p => renderPlayerItem(p))}
          </div>
        </div>
      )}

      {filteredPlayers.length === 0 && <div className="admin-empty"><p>{search ? 'No players match.' : 'No players yet.'}</p></div>}
    </div>
  );
}

export { computeAge, getPlayerAge };