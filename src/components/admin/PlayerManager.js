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
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getPlayerAge(player) {
  if (player.date_of_birth) return computeAge(player.date_of_birth);
  if (player.age_override != null && player.age_as_of) {
    const asOf = new Date(player.age_as_of);
    const now = new Date();
    const yearsDiff = now.getFullYear() - asOf.getFullYear();
    return player.age_override + yearsDiff;
  }
  if (player.age_override != null) return player.age_override;
  return null;
}

function parseDOB(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Try MM/DD/YYYY or M/D/YYYY
  const slashParts = str.split('/');
  if (slashParts.length === 3) {
    const m = parseInt(slashParts[0], 10);
    const d = parseInt(slashParts[1], 10);
    const y = parseInt(slashParts[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // Try DD-MM-YYYY or DD.MM.YYYY
  const dashParts = str.split(/[-\.]/);
  if (dashParts.length === 3) {
    const a = parseInt(dashParts[0], 10);
    const b = parseInt(dashParts[1], 10);
    const c = parseInt(dashParts[2], 10);
    // If first part is 4 digits, it's YYYY-MM-DD (ISO)
    if (a >= 1900 && a <= 2100 && b >= 1 && b <= 12 && c >= 1 && c <= 31) {
      return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
    }
    // Otherwise try DD-MM-YYYY
    if (c >= 1900 && c <= 2100 && b >= 1 && b <= 12 && a >= 1 && a <= 31) {
      return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
  }
  // Try JS Date parse as last resort
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString().split('T')[0];
  return null;
}

function getDOBWarnings(dobStr) {
  const warnings = [];
  if (!dobStr) { warnings.push('No DOB'); return warnings; }
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) { warnings.push('Invalid date'); return warnings; }
  const now = new Date();
  const age = computeAge(dobStr);
  if (dob > now) warnings.push('Future date');
  if (age !== null && age < 3) warnings.push(`Age ${age} — too young?`);
  if (age !== null && age > 80) warnings.push(`Age ${age} — very old?`);
  // Check for likely typos: year looks like current decade but off by ~20 years
  const year = dob.getFullYear();
  const currentYear = now.getFullYear();
  if (year >= currentYear - 2 && year <= currentYear) warnings.push('Born very recently — typo?');
  if (year >= currentYear + 1) warnings.push('Future year');
  return warnings;
}

function fuzzyMatch(name, candidates) {
  const lower = name.toLowerCase().trim();
  const results = [];
  for (const c of candidates) {
    const cLower = c.name.toLowerCase().trim();
    if (cLower === lower) { results.push({ ...c, score: 1.0 }); continue; }
    const wordsA = new Set(lower.split(/\s+/));
    const wordsB = new Set(cLower.split(/\s+/));
    const shared = [...wordsA].filter(w => wordsB.has(w)).length;
    const total = Math.max(wordsA.size, wordsB.size);
    const score = shared / total;
    if (score >= 0.5) results.push({ ...c, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

function findColumnIndex(headers, ...possibleNames) {
  for (const name of possibleNames) {
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

// Parse a single CSV line properly handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

export default function PlayerManager() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', gender: 'male', date_of_birth: '', age_override: '' });

  // Multi-select delete
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelected, setDeleteSelected] = useState(new Set());

  // CSV import
  const [csvReviewData, setCsvReviewData] = useState(null);
  const [csvSelected, setCsvSelected] = useState(new Set());
  const [linkingIndex, setLinkingIndex] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');

  useEffect(() => { loadPlayers(); }, []);

  const loadPlayers = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase.from('players').select('*').order('name', { ascending: true });
      if (err) throw err;
      setPlayers(data || []);
    } catch (err) { setError('Failed to load players: ' + err.message); }
    finally { setLoading(false); }
  };

  const resetForm = () => { setForm({ name: '', gender: 'male', date_of_birth: '', age_override: '' }); setEditingId(null); setShowForm(false); };

  const handleEdit = (player) => {
    setForm({
      name: player.name, gender: player.gender || 'male',
      date_of_birth: player.date_of_birth || '',
      age_override: player.age_override != null ? String(player.age_override) : '',
    });
    setEditingId(player.id); setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.date_of_birth && !form.age_override) { setError('Enter either Date of Birth or Age.'); return; }

    const payload = { name: form.name.trim(), gender: form.gender };
    if (form.date_of_birth) {
      payload.date_of_birth = form.date_of_birth; payload.age_override = null; payload.age_as_of = null;
    } else if (form.age_override) {
      payload.date_of_birth = null;
      payload.age_override = parseInt(form.age_override, 10);
      payload.age_as_of = new Date().toISOString().split('T')[0];
    }

    try {
      if (editingId) { const { error: err } = await supabase.from('players').update(payload).eq('id', editingId); if (err) throw err; }
      else { const { error: err } = await supabase.from('players').insert(payload); if (err) throw err; }
      resetForm(); await loadPlayers();
    } catch (err) { setError('Failed to save player: ' + err.message); }
  };

  // ── Single delete ──
  const handleDelete = async (id) => {
    const { data: regs } = await supabase.from('player_registrations').select('id').or(`player_id.eq.${id},partner_id.eq.${id}`).limit(1);
    if (regs && regs.length > 0) { alert('This player is registered in events and cannot be deleted.'); return; }
    if (!window.confirm('Delete this player?')) return;
    try {
      await supabase.from('tournament_players').delete().eq('player_id', id);
      const { error: err } = await supabase.from('players').delete().eq('id', id); if (err) throw err;
      await loadPlayers();
    } catch (err) { setError('Failed to delete: ' + err.message); }
  };

  // ── Bulk delete ──
  const toggleDeletePlayer = (id) => {
    setDeleteSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const handleBulkDelete = async () => {
    if (deleteSelected.size === 0) return;
    const selectedIds = [...deleteSelected];

    // Single query: find all registrations involving any selected player
    const orFilter = selectedIds.map(id => `player_id.eq.${id},partner_id.eq.${id}`).join(',');
    const { data: regs } = await supabase.from('player_registrations').select('player_id, partner_id').or(orFilter);

    const blockedIds = new Set();
    (regs || []).forEach(r => {
      if (deleteSelected.has(r.player_id)) blockedIds.add(r.player_id);
      if (r.partner_id && deleteSelected.has(r.partner_id)) blockedIds.add(r.partner_id);
    });
    const deletableIds = selectedIds.filter(id => !blockedIds.has(id));

    let msg = `Delete ${deletableIds.length} player(s)?`;
    if (blockedIds.size > 0) {
      const blockedNames = [...blockedIds].map(id => players.find(p => p.id === id)?.name || '?').join(', ');
      msg += `\n\n${blockedIds.size} player(s) are in events and will be skipped: ${blockedNames}`;
    }
    if (deletableIds.length === 0) { alert('All selected players are in events and cannot be deleted.'); return; }
    if (!window.confirm(msg)) return;

    try {
      // Batch delete from tournament_players and players
      await supabase.from('tournament_players').delete().in('player_id', deletableIds);
      const { error: err } = await supabase.from('players').delete().in('id', deletableIds);
      if (err) throw err;
      setDeleteSelected(new Set());
      setDeleteMode(false);
      await loadPlayers();
    } catch (err) { setError('Bulk delete failed: ' + err.message); }
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
        rows.push({
          rawName, name: rawName, rawDob, dob: parsedDob, age, gender,
          dobWarnings,
          matches, linkedPlayerId: null,
          status: matches.length > 0 && matches[0].score >= 0.8 ? 'duplicate_likely' : 'new',
        });
      }
      setCsvReviewData(rows);
      // Auto-select: only select rows that don't have an exact name match in registry
      const autoSelected = new Set();
      rows.forEach((row, i) => {
        if (!isNameBlockedInCsv(row.name, i, rows)) autoSelected.add(i);
      });
      setCsvSelected(autoSelected);
      setError('');
    } catch (err) { setError('Failed to parse CSV: ' + err.message); }
  };

  // Check if a CSV row's name matches an existing player (exact, case-insensitive)
  // or matches another row in the same CSV (duplicate within import)
  const isNameBlockedInCsv = (name, rowIndex, allRows) => {
    const lower = name.toLowerCase().trim();
    // Check against existing registry
    const existsInRegistry = players.some(p => p.name.toLowerCase().trim() === lower);
    if (existsInRegistry) return 'exists_in_registry';
    // Check against other CSV rows (earlier rows take priority)
    if (allRows) {
      for (let j = 0; j < allRows.length; j++) {
        if (j === rowIndex) continue;
        if (j < rowIndex && allRows[j].name.toLowerCase().trim() === lower) return 'duplicate_in_csv';
      }
    }
    return false;
  };

  // Recompute block status for all CSV rows
  const csvBlockStatus = useMemo(() => {
    if (!csvReviewData) return [];
    return csvReviewData.map((row, i) => {
      if (row.linkedPlayerId) return false; // linked rows are fine
      return isNameBlockedInCsv(row.name, i, csvReviewData);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvReviewData, players]);

  // When block status changes, remove blocked rows from selection
  useEffect(() => {
    if (!csvReviewData) return;
    setCsvSelected(prev => {
      const next = new Set(prev);
      csvBlockStatus.forEach((blocked, i) => { if (blocked) next.delete(i); });
      return next;
    });
  }, [csvBlockStatus, csvReviewData]);

  const toggleCsvRow = (i) => {
    if (csvBlockStatus[i]) return; // blocked rows can't be selected
    setCsvSelected(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };

  const toggleAllCsv = () => {
    if (!csvReviewData) return;
    const selectableIndices = csvReviewData.map((_, i) => i).filter(i => !csvBlockStatus[i]);
    const allSelected = selectableIndices.every(i => csvSelected.has(i));
    if (allSelected) setCsvSelected(new Set());
    else setCsvSelected(new Set(selectableIndices));
  };

  const updateCsvRow = (index, field, value) => {
    setCsvReviewData(prev => {
      const next = [...prev]; next[index] = { ...next[index], [field]: value };
      if (field === 'dob') {
        next[index].age = computeAge(value);
        next[index].dobWarnings = getDOBWarnings(value);
      }
      return next;
    });
  };

  const linkToExisting = (csvIndex, playerId) => {
    setCsvReviewData(prev => { const n = [...prev]; n[csvIndex] = { ...n[csvIndex], linkedPlayerId: playerId, status: 'linked' }; return n; });
    setLinkingIndex(null); setLinkSearch('');
  };

  const unlinkPlayer = (csvIndex) => {
    setCsvReviewData(prev => {
      const n = [...prev]; const matches = fuzzyMatch(n[csvIndex].name, players);
      n[csvIndex] = { ...n[csvIndex], linkedPlayerId: null, status: matches.length > 0 && matches[0].score >= 0.8 ? 'duplicate_likely' : 'new' };
      return n;
    });
  };

  const handleImportConfirm = async () => {
    setError(''); let linked = 0, skipped = 0;
    const toInsert = [];
    try {
      for (const idx of csvSelected) {
        const row = csvReviewData[idx];
        if (row.linkedPlayerId) { linked++; continue; }
        if (csvBlockStatus[idx]) { skipped++; continue; }

        const payload = { name: row.name.trim(), gender: row.gender };
        if (row.dob && row.dobWarnings.length === 0) { payload.date_of_birth = row.dob; }
        else if (row.age != null && row.dobWarnings.length === 0) { payload.age_override = row.age; payload.age_as_of = new Date().toISOString().split('T')[0]; }
        toInsert.push(payload);
      }
      if (toInsert.length > 0) {
        const { error: err } = await supabase.from('players').insert(toInsert);
        if (err) throw err;
      }
      alert(`Import complete: ${toInsert.length} new, ${linked} linked, ${skipped} skipped.`);
      setCsvReviewData(null); setCsvSelected(new Set()); await loadPlayers();
    } catch (err) { setError('Import failed: ' + err.message); }
  };

  const filteredPlayers = useMemo(() =>
    players.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [players, search]);

  const linkResults = useMemo(() => {
    if (linkingIndex === null) return [];
    const row = csvReviewData[linkingIndex]; if (!row) return [];
    if (linkSearch) return players.filter(p => p.name.toLowerCase().includes(linkSearch.toLowerCase()));
    const fuzzy = fuzzyMatch(row.name, players);
    const fuzzyIds = new Set(fuzzy.map(f => f.id));
    return [...fuzzy, ...players.filter(p => !fuzzyIds.has(p.id))];
  }, [linkingIndex, csvReviewData, players, linkSearch]);

  // Shift-select for bulk delete (keyed by player ID)
  const getDeleteKey = useCallback((p) => p.id, []);
  const { handleClick: handleDeleteClick } = useShiftSelect(deleteSelected, setDeleteSelected, filteredPlayers, getDeleteKey);

  // Shift-select for CSV rows (keyed by index)
  const getCsvKey = useCallback((_, i) => i, []);
  const isCsvDisabled = useCallback((_, i) => !!csvBlockStatus[i], [csvBlockStatus]);
  const { handleClick: handleCsvClick } = useShiftSelect(csvSelected, setCsvSelected, csvReviewData || [], getCsvKey, isCsvDisabled);

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
            <button className="admin-btn primary" onClick={handleImportConfirm} disabled={csvSelected.size === 0}>
              ✓ Import {csvSelected.size} Selected
            </button>
            <button className="admin-btn secondary" onClick={() => { setCsvReviewData(null); setCsvSelected(new Set()); }}>Cancel</button>
          </div>
        </div>
        {error && <div className="admin-error">{error}</div>}
        <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
          Review the data below. Fix names or DOBs as needed. Link entries to existing players to avoid duplicates.
          {blockedCount > 0 && <span style={{ color: '#e85454' }}> {blockedCount} row(s) blocked due to duplicate names — edit the name or link to existing.</span>}
        </p>
        <div className="csv-review-controls">
          <label className="csv-toggle-all" onClick={toggleAllCsv}>
            <input type="checkbox" checked={csvSelected.size === selectableCount && selectableCount > 0} readOnly /> Select All ({selectableCount} available)
          </label>
          <span style={{ color: '#666', fontSize: 12 }}>⚠️ = DOB warning &nbsp; 🚫 = blocked (duplicate) &nbsp; 🔗 = match found</span>
        </div>

        {linkingIndex !== null && (
          <div className="pub-overlay" onClick={() => { setLinkingIndex(null); setLinkSearch(''); }}>
            <div className="link-modal" onClick={e => e.stopPropagation()}>
              <div className="link-modal-header">
                <h3>Link "{csvReviewData[linkingIndex]?.name}" to existing player</h3>
                <button className="pub-profile-close" onClick={() => { setLinkingIndex(null); setLinkSearch(''); }}>✕</button>
              </div>
              <input type="text" placeholder="Search registry..." value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)} className="link-search-input" autoFocus />
              <div className="link-results">
                {linkResults.map(p => (
                  <div key={p.id} className={`link-result-item ${p.score >= 0.8 ? 'strong-match' : ''}`}
                    onClick={() => linkToExisting(linkingIndex, p.id)}>
                    <span className="link-result-name">{p.name}</span>
                    <span className="link-result-meta">
                      {p.gender === 'female' ? 'F' : 'M'}
                      {getPlayerAge(p) != null && ` · ${getPlayerAge(p)}y`}
                      {p.score != null && ` · ${Math.round(p.score * 100)}% match`}
                    </span>
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
                const linkedPlayer = row.linkedPlayerId ? players.find(p => p.id === row.linkedPlayerId) : null;
                const blocked = csvBlockStatus[i];
                const hasWarnings = row.dobWarnings && row.dobWarnings.length > 0;
                return (
                  <tr key={i} className={`${!csvSelected.has(i) ? 'deselected' : ''} ${hasWarnings ? 'warning-row' : ''} ${blocked ? 'blocked-row' : ''}`}>
                    <td>
                      {blocked && !row.linkedPlayerId
                        ? <span className="csv-blocked-icon" title={blocked === 'exists_in_registry' ? 'Name exists in registry' : 'Duplicate in this CSV'}>🚫</span>
                        : <input type="checkbox" checked={csvSelected.has(i)} onChange={() => {}} onClick={(e) => handleCsvClick(e, i)} disabled={!!blocked} />}
                    </td>
                    <td className="csv-row-num">{i + 1}</td>
                    <td>
                      {row.linkedPlayerId ? <span className="csv-linked-name">🔗 {linkedPlayer?.name || 'Linked'}</span>
                        : <input type="text" value={row.name} onChange={e => updateCsvRow(i, 'name', e.target.value)}
                            className={`csv-inline-input ${blocked ? 'csv-input-blocked' : ''}`} />}
                      {blocked && !row.linkedPlayerId && (
                        <div className="csv-blocked-hint">
                          {blocked === 'exists_in_registry' ? 'Already in registry — edit name or link to existing' : 'Duplicate in this CSV — edit name'}
                        </div>
                      )}
                    </td>
                    <td><select value={row.gender} onChange={e => updateCsvRow(i, 'gender', e.target.value)} className="csv-inline-select">
                      <option value="male">M</option><option value="female">F</option>
                    </select></td>
                    <td>
                      {hasWarnings && (
                        <span className="csv-warning" title={row.dobWarnings.join(', ')}>⚠️</span>
                      )}
                      <input type="date" value={row.dob || ''} onChange={e => updateCsvRow(i, 'dob', e.target.value)} className="csv-inline-input csv-date-input" />
                      {hasWarnings && (
                        <div className="csv-warning-text">{row.dobWarnings.join(', ')}</div>
                      )}
                    </td>
                    <td className="csv-age">{row.age != null ? row.age : '—'}</td>
                    <td><span className={`csv-status ${row.status} ${blocked ? 'blocked' : ''}`}>
                      {blocked ? '🚫 Blocked' : row.status === 'linked' ? '🔗 Linked' : row.status === 'duplicate_likely' ? '🔗 Match?' : 'New'}
                    </span></td>
                    <td>
                      {row.linkedPlayerId
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
  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Player Registry</h2>
        <div className="admin-header-actions">
          <label className="admin-btn secondary csv-btn">📄 Import CSV
            <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
          </label>
          <button className="admin-btn primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Add Player</button>
          {!deleteMode ? (
            <button className="admin-btn secondary" onClick={() => { setDeleteMode(true); setDeleteSelected(new Set()); }}>🗑 Bulk Delete</button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="admin-btn danger" onClick={handleBulkDelete} disabled={deleteSelected.size === 0}>
                Delete {deleteSelected.size} Selected
              </button>
              <button className="admin-btn secondary" onClick={() => { setDeleteMode(false); setDeleteSelected(new Set()); }}>Cancel</button>
            </div>
          )}
        </div>
      </div>
      {error && <div className="admin-error">{error}</div>}

      {showForm && (
        <div className="admin-form-card">
          <h3>{editingId ? 'Edit Player' : 'Add Player'}</h3>
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field"><label>Full Name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Player name" required />
              </div>
              <div className="admin-field"><label>Gender</label>
                <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                  <option value="male">Male</option><option value="female">Female</option>
                </select>
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field"><label>Date of Birth</label>
                <input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value, age_override: '' })} />
              </div>
              <div className="admin-field"><label>Or Age (if DOB unknown)</label>
                <input type="number" min="1" max="100" value={form.age_override}
                  onChange={e => setForm({ ...form, age_override: e.target.value, date_of_birth: '' })} placeholder="e.g. 28" />
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
      </div>

      {filteredPlayers.length === 0 ? (
        <div className="admin-empty"><p>{search ? 'No players match your search.' : 'No players yet. Add one or import a CSV!'}</p></div>
      ) : (
        <div className="admin-list">
          {filteredPlayers.map((p, idx) => {
            const age = getPlayerAge(p);
            return (
              <div key={p.id} className="admin-list-item">
                {deleteMode && (
                  <input type="checkbox" checked={deleteSelected.has(p.id)} onChange={() => {}} onClick={(e) => handleDeleteClick(e, idx)}
                    style={{ marginRight: 10, cursor: 'pointer' }} />
                )}
                <div className="admin-list-main">
                  <div className="admin-list-title">{p.name}</div>
                  <div className="admin-list-meta">
                    <span className="admin-category-badge">{p.gender === 'female' ? 'F' : 'M'}</span>
                    {age != null && <span>{age} years</span>}
                    {p.date_of_birth && <span>DOB: {p.date_of_birth}</span>}
                  </div>
                </div>
                {!deleteMode && (
                  <div className="admin-list-right">
                    <button className="admin-btn small" onClick={() => handleEdit(p)}>Edit</button>
                    <button className="admin-btn small danger" onClick={() => handleDelete(p.id)}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { computeAge, getPlayerAge };