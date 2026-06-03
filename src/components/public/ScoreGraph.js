import { useState } from 'react';

/**
 * ScoreGraph — per-game score progression graph.
 * 
 * Props:
 *   match          — match object with score_data
 *   sideALabel     — display name for side A
 *   sideBLabel     — display name for side B
 *   expanded       — start expanded (e.g. in scoring view)
 *   activeGameIdx  — which game to show by default (derived from last point if not passed)
 *   showGamePills  — show clickable game selector pills (true in public view)
 *   alwaysShow     — skip the expand button, always render graph (scoring view)
 */
export default function ScoreGraph({
  match, sideALabel, sideBLabel,
  expanded = false, activeGameIdx = null,
  showGamePills = true, alwaysShow = false,
}) {
  const [isExpanded, setIsExpanded] = useState(expanded || alwaysShow);

  const sets = match?.score_data?.sets;

  // Derive which game had the last point added — must be before hooks
  const lastActiveGame = (() => {
    if (!sets?.length) return 0;
    let lastTs = null, lastIdx = 0;
    sets.forEach((s, i) => {
      const log = s.point_log || [];
      if (log.length > 0) {
        const ts = log[log.length - 1].timestamp;
        if (!lastTs || ts > lastTs) { lastTs = ts; lastIdx = i; }
      }
    });
    return lastIdx;
  })();

  const defaultGame = activeGameIdx !== null ? activeGameIdx : lastActiveGame;
  const [selectedGame, setSelectedGame] = useState(defaultGame);

  if (!sets?.length) return null;

  // When activeGameIdx changes externally (scoring view), follow it
  // but only if it's explicitly passed
  const displayGame = activeGameIdx !== null ? activeGameIdx : selectedGame;

  const gameData = sets[displayGame];
  if (!gameData) return null;

  // Build points array for selected game, seeded with 0-0 origin
  const points = [{ a: 0, b: 0 }];
  let cumA = 0, cumB = 0;
  for (const p of (gameData.point_log || [])) {
    if (p.scorer === 'side_a') cumA++; else cumB++;
    points.push({ a: cumA, b: cumB });
  }

  const hasPoints = points.length >= 2;

  if (!isExpanded && !alwaysShow) {
    return (
      <div style={{ marginTop: 6, textAlign: 'center' }}>
        <button onClick={e => { e.stopPropagation(); setIsExpanded(true); }}
          style={{ background: 'none', border: '1px solid #2a2a3e', borderRadius: 6,
            color: '#666', fontSize: 10, padding: '3px 10px', cursor: 'pointer' }}>
          ▾ Score graph
        </button>
      </div>
    );
  }

  const w = 300, h = 70, pad = 4;
  const maxPts = Math.max(cumA, cumB, 1);
  const n = points.length;
  const sx = (i) => pad + (n > 1 ? (i / (n - 1)) * (w - pad * 2) : w / 2);
  const sy = (v) => h - pad - (v / maxPts) * (h - pad * 2);

  const pathA = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.a).toFixed(1)}`).join(' ');
  const pathB = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.b).toFixed(1)}`).join(' ');

  const multiGame = sets.length > 1;

  return (
    <div className="pub-score-graph"
      onClick={e => { e.stopPropagation(); if (!alwaysShow && !expanded) setIsExpanded(false); }}>

      {/* Game selector pills — only shown when multiple games exist */}
      {showGamePills && multiGame && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          {sets.map((s, i) => {
            const isSelected = i === displayGame;
            const hasData = (s.point_log || []).length > 0;
            return (
              <button key={i} onClick={e => { e.stopPropagation(); setSelectedGame(i); }}
                style={{
                  padding: '2px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                  background: isSelected ? '#2a2215' : 'none',
                  border: `1px solid ${isSelected ? '#d4a843' : '#2a2a3e'}`,
                  color: isSelected ? '#d4a843' : hasData ? '#888' : '#444',
                  fontWeight: isSelected ? 700 : 400,
                }}>
                G{i + 1} {s.side_a_points}-{s.side_b_points}
              </button>
            );
          })}
        </div>
      )}

      {/* Graph title when multiple games */}
      {multiGame && (
        <div style={{ fontSize: 9, color: '#555', textAlign: 'center', marginBottom: 3 }}>
          Game {displayGame + 1}
        </div>
      )}

      {hasPoints ? (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 60 }}>
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={pad} y1={sy(maxPts * f)} x2={w - pad} y2={sy(maxPts * f)}
              stroke="#1a1a2a" strokeWidth="0.3" />
          ))}
          <path d={pathA} fill="none" stroke="#4ecb71" strokeWidth="1.8" strokeLinejoin="round" />
          <path d={pathB} fill="none" stroke="#5b9bd5" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx={sx(n - 1)} cy={sy(cumA)} r="2.5" fill="#4ecb71" />
          <circle cx={sx(n - 1)} cy={sy(cumB)} r="2.5" fill="#5b9bd5" />
          <text x={w - 2} y={sy(cumA) - 5} fill="#4ecb71" fontSize="8" textAnchor="end">{cumA}</text>
          <text x={w - 2} y={sy(cumB) + 10} fill="#5b9bd5" fontSize="8" textAnchor="end">{cumB}</text>
        </svg>
      ) : (
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#333' }}>
          No points scored in this game yet
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, color: '#888', marginTop: 2 }}>
        <span><span style={{ color: '#4ecb71' }}>{'\u25CF'}</span> {sideALabel || 'Side A'}</span>
        <span><span style={{ color: '#5b9bd5' }}>{'\u25CF'}</span> {sideBLabel || 'Side B'}</span>
      </div>
    </div>
  );
}