import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { RealtimeService } from '../../services/RealtimeService';
import './MatchScorer.css';

const AUTO_LOCK_MINUTES = 5;

export default function MatchScorer({ matchId, allPlayers, onBack, isAdmin = true }) {
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(null);

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
    if (match.status !== 'in_progress' && match.status !== 'finished') return;

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

  const isEditable = match?.status === 'in_progress' || match?.status === 'finished';

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

        {match.status === 'locked' && (
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

      {saving && <div className="scorer-saving">Saving...</div>}
    </div>
  );
}