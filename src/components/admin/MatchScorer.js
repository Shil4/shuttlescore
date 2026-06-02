import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { RealtimeService } from '../../services/RealtimeService';
import './MatchScorer.css';

const AUTO_LOCK_MINUTES = 5;

// ── Confetti ──────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLOURS = ['#4ecb71','#d4a843','#5588ff','#ff6655','#ffffff','#cc88ff'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 4,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    rot: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
    vr: (Math.random() - 0.5) * 0.15,
  }));

  let frame;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.05;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive) { frame = requestAnimationFrame(draw); }
    else { cancelAnimationFrame(frame); document.body.removeChild(canvas); }
  };
  frame = requestAnimationFrame(draw);
  // Auto-remove after 4s regardless
  setTimeout(() => {
    cancelAnimationFrame(frame);
    if (canvas.parentNode) document.body.removeChild(canvas);
  }, 4000);
}

export default function MatchScorer({ matchId, allPlayers, onBack, isAdmin = true }) {
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(null);

  // Admin override
  const [overrideMode, setOverrideMode] = useState(false);
  const [overridePassword, setOverridePassword] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideUnlocked, setOverrideUnlocked] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  const loadMatch = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .single();
      if (err) throw err;
      setMatch(data);

      // Auto-lock check: if finished and past 5 minutes, lock it
      if (data.status === 'finished' && data.finished_at && isAdmin) {
        const elapsed = (Date.now() - new Date(data.finished_at).getTime()) / 1000;
        if (elapsed >= AUTO_LOCK_MINUTES * 60) {
          await supabase.from('matches').update({
            status: 'locked',
            locked_at: new Date().toISOString(),
          }).eq('id', matchId);
          setMatch({ ...data, status: 'locked' });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [matchId, isAdmin]);

  useEffect(() => {
    loadMatch();

    // Subscribe to live updates for this match
    const unsub = RealtimeService.subscribeToMatch(matchId, (updated) => {
      setMatch(updated);
    });
    return () => unsub();
  }, [loadMatch, matchId]);

  // Countdown timer for auto-lock
  useEffect(() => {
    if (!match || match.status !== 'finished' || !match.finished_at) {
      setLockCountdown(null);
      return;
    }
    const updateCountdown = () => {
      const elapsed = (Date.now() - new Date(match.finished_at).getTime()) / 1000;
      const remaining = AUTO_LOCK_MINUTES * 60 - elapsed;
      if (remaining <= 0) {
        setLockCountdown(0);
        if (isAdmin) {
          supabase.from('matches').update({
            status: 'locked',
            locked_at: new Date().toISOString(),
          }).eq('id', matchId);
        }
      } else {
        setLockCountdown(Math.ceil(remaining));
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status, match?.finished_at, matchId, isAdmin]);

  const playerName = (id) => {
    if (!id) return 'BYE';
    return allPlayers.find(p => p.id === id)?.name || id.substring(0, 8);
  };

  const sideLabel = (sideArr) => {
    if (!sideArr || sideArr.length === 0) return 'TBD';
    return sideArr.map(playerName).join(' & ');
  };

  const scoreData = match?.score_data;
  const currentSetIndex = scoreData?.current_set ?? 0;
  const currentSet = scoreData?.sets?.[currentSetIndex];
  const sets = scoreData?.sets || [];

  // Track if score has been edited after finish (needs re-save)
  const [editedAfterFinish, setEditedAfterFinish] = useState(false);

  // Add point
  const addPoint = async (side) => {
    if (!match || saving) return;
    if (match.status !== 'in_progress' && match.status !== 'finished' && !(match.status === 'locked' && overrideUnlocked)) return;

    setSaving(true);
    setError('');

    try {
      const newScoreData = JSON.parse(JSON.stringify(match.score_data));
      const set = newScoreData.sets[newScoreData.current_set];
      const pointKey = side === 'side_a' ? 'side_a_points' : 'side_b_points';
      set[pointKey]++;
      set.point_log.push({ scorer: side, timestamp: new Date().toISOString() });

      // Don't recalculate winner during edits — wait for explicit save
      const { data, error: err } = await supabase
        .from('matches')
        .update({ score_data: newScoreData })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
      if (match.status === 'finished') setEditedAfterFinish(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Undo last point
  const undoPoint = async () => {
    if (!match || saving) return;
    if (!currentSet?.point_log?.length) return;

    setSaving(true);
    setError('');

    try {
      const newScoreData = JSON.parse(JSON.stringify(match.score_data));
      const set = newScoreData.sets[newScoreData.current_set];
      const lastPoint = set.point_log.pop();
      const pointKey = lastPoint.scorer === 'side_a' ? 'side_a_points' : 'side_b_points';
      set[pointKey] = Math.max(0, set[pointKey] - 1);

      // Don't recalculate winner during edits
      const { data, error: err } = await supabase
        .from('matches')
        .update({ score_data: newScoreData })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
      if (match.status === 'finished') setEditedAfterFinish(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // New set
  const addNewSet = async () => {
    if (!match || saving) return;

    setSaving(true);
    try {
      const newScoreData = JSON.parse(JSON.stringify(match.score_data));
      newScoreData.sets.push({ side_a_points: 0, side_b_points: 0, point_log: [] });
      newScoreData.current_set = newScoreData.sets.length - 1;

      const { data, error: err } = await supabase
        .from('matches')
        .update({ score_data: newScoreData })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Switch active set
  const switchSet = async (idx) => {
    if (!match || saving || idx === currentSetIndex) return;

    setSaving(true);
    try {
      const newScoreData = JSON.parse(JSON.stringify(match.score_data));
      newScoreData.current_set = idx;

      const { data, error: err } = await supabase
        .from('matches')
        .update({ score_data: newScoreData })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Save score changes after editing a finished match
  const saveScoreChanges = async () => {
    if (!match || saving) return;
    if (match.status !== 'finished') return;

    const winner = calculateWinner(match.score_data);
    if (winner === 'tied') {
      setError('Result is tied — adjust scores or add another set.');
      return;
    }
    if (winner === 'no_data') {
      setError('No score data.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('matches')
        .update({ winner })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
      setEditedAfterFinish(false);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Finish match
  const finishMatch = async () => {
    if (!match || saving) return;
    if (match.status !== 'in_progress') return;

    const winner = calculateWinner(match.score_data);
    if (winner === 'tied') {
      setError('Result is tied — add another set before finishing.');
      return;
    }
    if (winner === 'no_data') {
      setError('No score data recorded.');
      return;
    }

    if (!window.confirm('Finish this match? You can still edit scores for 5 minutes after.')) return;

    setSaving(true);
    setError('');

    try {
      const finishedAt = new Date().toISOString();
      const durationSeconds = match.started_at
        ? Math.round((new Date(finishedAt) - new Date(match.started_at)) / 1000)
        : null;

      const { data, error: err } = await supabase
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
      if (err) throw err;
      setMatch(data);
      if (data.stage === 'final' || data.stage === 'third_place') launchConfetti();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Lock match (after grace period or manually)
  const lockMatch = async () => {
    if (!match || saving) return;
    if (match.status !== 'finished') return;
    if (!window.confirm('Lock this match? No more edits will be possible (except admin override).')) return;

    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('matches')
        .update({ status: 'locked', locked_at: new Date().toISOString() })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Admin override — verify password
  const handleOverrideVerify = async () => {
    setOverrideError('');
    try {
      const { data: config } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'override_password_hash')
        .single();

      if (!config || config.value === 'CHANGE_ME_TO_BCRYPT_HASH') {
        setOverrideError('Override password not configured. Set it in Supabase app_config table.');
        return;
      }

      if (overridePassword !== config.value) {
        setOverrideError('Incorrect password.');
        return;
      }

      setOverrideUnlocked(true);
      setOverrideError('');
      setEditedAfterFinish(false);
    } catch (err) {
      setOverrideError(err.message);
    }
  };

  // Save override changes — re-lock with audit log
  const handleOverrideSave = async () => {
    if (!match || saving) return;
    if (!overrideReason.trim()) {
      setOverrideError('Please provide a reason for the override.');
      return;
    }

    const winner = calculateWinner(match.score_data);
    if (winner === 'tied') {
      setOverrideError('Result is tied — adjust scores or add another set.');
      return;
    }
    if (winner === 'no_data') {
      setOverrideError('No score data.');
      return;
    }

    setSaving(true);
    setOverrideError('');
    try {
      const logEntry = {
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        timestamp: new Date().toISOString(),
        reason: overrideReason.trim(),
        previous_state: {
          score_data: match.score_data,
          winner: match.winner,
        },
      };

      const overrideLog = [...(match.override_log || []), logEntry];

      const { data, error: err } = await supabase
        .from('matches')
        .update({
          score_data: match.score_data,
          winner,
          override_log: overrideLog,
          status: 'locked',
          locked_at: new Date().toISOString(),
        })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
      setOverrideUnlocked(false);
      setOverrideMode(false);
      setOverridePassword('');
      setOverrideReason('');
    } catch (err) {
      setOverrideError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Override false start — revert locked match to pending
  const handleOverrideFalseStart = async () => {
    if (!match || saving) return;
    if (!overrideReason.trim()) {
      setOverrideError('Please provide a reason for the false start.');
      return;
    }
    if (!window.confirm('Revert this match to pending? All scores will be cleared.')) return;

    setSaving(true);
    setOverrideError('');
    try {
      const logEntry = {
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        timestamp: new Date().toISOString(),
        reason: `FALSE START: ${overrideReason.trim()}`,
        previous_state: {
          score_data: match.score_data,
          winner: match.winner,
          status: match.status,
        },
      };

      const overrideLog = [...(match.override_log || []), logEntry];

      const { data, error: err } = await supabase
        .from('matches')
        .update({
          status: 'pending',
          score_data: null,
          winner: null,
          started_at: null,
          finished_at: null,
          locked_at: null,
          duration_seconds: null,
          override_log: overrideLog,
        })
        .eq('id', matchId)
        .select()
        .single();
      if (err) throw err;
      setMatch(data);
      setOverrideUnlocked(false);
      setOverrideMode(false);
      setOverridePassword('');
      setOverrideReason('');
      setEditedAfterFinish(false);
    } catch (err) {
      setOverrideError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Calculate winner
  const calculateWinner = (sd) => {
    if (!sd?.sets?.length) return 'no_data';
    let sideASets = 0, sideBSets = 0;
    for (const set of sd.sets) {
      if (set.side_a_points > set.side_b_points) sideASets++;
      else if (set.side_b_points > set.side_a_points) sideBSets++;
    }
    if (sd.sets.length === 1) {
      if (sideASets > sideBSets) return 'side_a';
      if (sideBSets > sideASets) return 'side_b';
      return 'tied';
    }
    if (sideASets > sideBSets) return 'side_a';
    if (sideBSets > sideASets) return 'side_b';
    return 'tied';
  };

  const isEditable = match?.status === 'in_progress' || match?.status === 'finished' || (match?.status === 'locked' && overrideUnlocked);

  if (loading) return <div className="admin-loading">Loading match...</div>;
  if (!match) return <div className="admin-error">Match not found.</div>;

  return (
    <div className="scorer">
      <button className="admin-btn secondary" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back to Matches
      </button>

      {error && <div className="admin-error">{error}</div>}

      {/* Match header */}
      <div className="scorer-header">
        <div className="scorer-status">
          {match.status === 'in_progress' && <span className="scorer-live-dot" />}
          {match.status.replace('_', ' ').toUpperCase()}
        </div>
      </div>

      {/* Score display */}
      <div className="scorer-main">
        <div
          className={`scorer-side side-a ${match.winner === 'side_a' ? 'winner' : ''}`}
          onClick={() => isEditable && addPoint('side_a')}
          style={{ cursor: isEditable ? 'pointer' : 'default' }}
        >
          <div className="scorer-side-name">{sideLabel(match.side_a)}</div>
          <div className="scorer-side-points">{currentSet?.side_a_points ?? 0}</div>
          {isEditable && <div className="scorer-tap-hint">Tap to score</div>}
        </div>

        <div className="scorer-middle">
          <div className="scorer-sets-display">
            {sets.map((set, i) => (
              <div
                key={i}
                className={`scorer-set-pill ${i === currentSetIndex ? 'active' : ''}`}
                onClick={() => switchSet(i)}
              >
                <span className="scorer-set-label">Set {i + 1}</span>
                <span className="scorer-set-score">{set.side_a_points}-{set.side_b_points}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`scorer-side side-b ${match.winner === 'side_b' ? 'winner' : ''}`}
          onClick={() => isEditable && addPoint('side_b')}
          style={{ cursor: isEditable ? 'pointer' : 'default' }}
        >
          <div className="scorer-side-name">{sideLabel(match.side_b)}</div>
          <div className="scorer-side-points">{currentSet?.side_b_points ?? 0}</div>
          {isEditable && <div className="scorer-tap-hint">Tap to score</div>}
        </div>
      </div>

      {/* Action buttons */}
      <div className="scorer-actions">
        {isEditable && (
          <>
            <button className="scorer-btn undo" onClick={undoPoint} disabled={saving || !currentSet?.point_log?.length}>
              ↩ Undo
            </button>
            <button className="scorer-btn new-set" onClick={addNewSet} disabled={saving}>
              + New Set
            </button>
          </>
        )}

        {match.status === 'in_progress' && (
          <button className="scorer-btn finish" onClick={finishMatch} disabled={saving}>
            ✓ Finish Match
          </button>
        )}

        {match.status === 'finished' && editedAfterFinish && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button className="scorer-btn finish" onClick={saveScoreChanges} disabled={saving} style={{ background: '#d4a843', flex: 1 }}>
              💾 Save Score Changes
            </button>
            <span style={{ fontSize: 11, color: '#d4a843' }}>Score edited — save to update result</span>
          </div>
        )}

        {match.status === 'finished' && isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="scorer-btn lock" onClick={lockMatch} disabled={saving || editedAfterFinish}>
              🔒 Lock Match
            </button>
            {editedAfterFinish && <span style={{ fontSize: 11, color: '#e85454' }}>Save changes before locking</span>}
            {!editedAfterFinish && lockCountdown !== null && lockCountdown > 0 && (
              <span style={{ fontSize: 12, color: '#d4a843' }}>
                Auto-locks in {Math.floor(lockCountdown / 60)}:{String(lockCountdown % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        )}

        {match.status === 'finished' && !isAdmin && (
          <div style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '8px 0' }}>
            Match finished — waiting for admin to lock
            {lockCountdown !== null && lockCountdown > 0 && (
              <span style={{ color: '#d4a843', marginLeft: 8 }}>
                ({Math.floor(lockCountdown / 60)}:{String(lockCountdown % 60).padStart(2, '0')})
              </span>
            )}
          </div>
        )}

        {match.status === 'locked' && isAdmin && !overrideUnlocked && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            {!overrideMode ? (
              <>
                <div style={{ fontSize: 13, color: '#4ecb71', fontWeight: 600, marginBottom: 8 }}>🔒 Match locked</div>
                <button className="scorer-btn" onClick={() => setOverrideMode(true)}
                  style={{ fontSize: 12, color: '#d4a843', borderColor: '#d4a843' }}>
                  🔓 Admin Override
                </button>
              </>
            ) : (
              <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 16, textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#d4a843', marginBottom: 10 }}>Admin Override</div>
                {overrideError && <div className="admin-error" style={{ marginBottom: 8, fontSize: 12 }}>{overrideError}</div>}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Override Password</label>
                  <input type="password" value={overridePassword} onChange={e => setOverridePassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOverrideVerify()}
                    placeholder="Enter override password"
                    style={{ width: '100%', padding: '8px 12px', background: '#0d0d14', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ddd', fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn primary" onClick={handleOverrideVerify} disabled={!overridePassword} style={{ fontSize: 12 }}>Verify</button>
                  <button className="admin-btn secondary" onClick={() => { setOverrideMode(false); setOverridePassword(''); setOverrideError(''); }} style={{ fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {match.status === 'locked' && overrideUnlocked && (
          <div style={{ background: '#2a2215', border: '1px solid #d4a843', borderRadius: 8, padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: '#d4a843', fontWeight: 600, marginBottom: 8 }}>🔓 Override active — edit scores above, then save with a reason</div>
            {overrideError && <div className="admin-error" style={{ marginBottom: 8, fontSize: 12 }}>{overrideError}</div>}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Reason for override</label>
              <input type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                placeholder="e.g. Scoring error in set 2"
                style={{ width: '100%', padding: '8px 12px', background: '#0d0d14', border: '1px solid #2a2a3e', borderRadius: 6, color: '#ddd', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="scorer-btn finish" onClick={handleOverrideSave} disabled={saving || !overrideReason.trim()} style={{ flex: 1, minWidth: 140 }}>
                💾 Save Score & Re-lock
              </button>
              <button className="admin-btn danger" onClick={handleOverrideFalseStart} disabled={saving || !overrideReason.trim()}
                style={{ fontSize: 12, padding: '8px 14px' }}>
                ⚠️ False Start
              </button>
              <button className="admin-btn secondary" onClick={() => { setOverrideUnlocked(false); setOverrideMode(false); setOverridePassword(''); setOverrideReason(''); loadMatch(); }} style={{ fontSize: 12 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {match.status === 'locked' && !isAdmin && (
          <div style={{ fontSize: 13, color: '#4ecb71', textAlign: 'center', padding: '8px 0', fontWeight: 600 }}>
            🔒 Match locked
          </div>
        )}
      </div>

      {/* Point log */}
      {currentSet?.point_log?.length > 0 && (
        <div className="scorer-log">
          <div className="scorer-log-title">Point Log — Set {currentSetIndex + 1}</div>
          <div className="scorer-log-list">
            {currentSet.point_log.map((p, i) => (
              <span key={i} className={`scorer-log-dot ${p.scorer}`} title={`Point ${i + 1}: ${p.scorer === 'side_a' ? sideLabel(match.side_a) : sideLabel(match.side_b)}`} />
            ))}
          </div>
        </div>
      )}

      {/* Override log */}
      {match.override_log?.length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: '#1a1a2e', borderRadius: 8, border: '1px solid #2a2215' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#d4a843', marginBottom: 8 }}>📋 Override History ({match.override_log.length})</div>
          {match.override_log.map((entry, i) => (
            <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid #2a2a3a' : 'none', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: entry.reason?.startsWith('FALSE START') ? '#e85454' : '#d4a843', fontWeight: 600 }}>
                  {entry.reason?.startsWith('FALSE START') ? '⚠️ ' : '✏️ '}{entry.reason || 'No reason'}
                </span>
                <span style={{ color: '#555' }}>
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
              {entry.previous_state?.score_data?.sets && (
                <div style={{ color: '#666', fontSize: 11 }}>
                  Previous: {entry.previous_state.score_data.sets.map((s, j) => `Set ${j + 1}: ${s.side_a_points}-${s.side_b_points}`).join(', ')}
                  {entry.previous_state.winner && ` → ${entry.previous_state.winner}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {saving && <div className="scorer-saving">Saving...</div>}
    </div>
  );
}