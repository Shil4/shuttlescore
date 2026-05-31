import { useState } from 'react';

/** Score progression line graph — two lines showing cumulative points */
export default function ScoreGraph({ match, expanded = false, sideALabel, sideBLabel }) {
  const [isExpanded, setIsExpanded] = useState(expanded);

  if (!match?.score_data?.sets) return null;

  const allPoints = [];
  let cumA = 0, cumB = 0;
  for (const set of match.score_data.sets) {
    for (const p of (set.point_log || [])) {
      if (p.scorer === 'side_a') cumA++; else cumB++;
      allPoints.push({ a: cumA, b: cumB });
    }
  }
  if (allPoints.length < 2) return null;

  const maxPts = Math.max(cumA, cumB, 1);
  const w = 300, h = 70, pad = 4;
  const sx = (i) => pad + (i / (allPoints.length - 1)) * (w - pad * 2);
  const sy = (v) => h - pad - (v / maxPts) * (h - pad * 2);

  const pathA = allPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.a).toFixed(1)}`).join(' ');
  const pathB = allPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.b).toFixed(1)}`).join(' ');

  // Set boundaries
  const setBounds = [];
  let ptIdx = 0;
  for (const set of match.score_data.sets) {
    ptIdx += (set.point_log || []).length;
    if (ptIdx < allPoints.length) setBounds.push(ptIdx);
  }

  if (!isExpanded) {
    return (
      <div style={{ marginTop: 6, textAlign: 'center' }}>
        <button onClick={(e) => { e.stopPropagation(); setIsExpanded(true); }}
          style={{ background: 'none', border: '1px solid #2a2a3e', borderRadius: 6, color: '#666',
            fontSize: 10, padding: '3px 10px', cursor: 'pointer' }}>
          ▾ Score graph
        </button>
      </div>
    );
  }

  return (
    <div className="pub-score-graph" onClick={(e) => { e.stopPropagation(); if (!expanded) setIsExpanded(false); }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 60 }}>
        {/* Set boundaries */}
        {setBounds.map((idx, i) => (
          <line key={i} x1={sx(idx)} y1={pad} x2={sx(idx)} y2={h - pad}
            stroke="#2a2a3e" strokeWidth="0.5" strokeDasharray="3,3" />
        ))}
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={pad} y1={sy(maxPts * f)} x2={w - pad} y2={sy(maxPts * f)}
            stroke="#1a1a2a" strokeWidth="0.3" />
        ))}
        {/* Lines */}
        <path d={pathA} fill="none" stroke="#4ecb71" strokeWidth="1.8" strokeLinejoin="round" />
        <path d={pathB} fill="none" stroke="#5b9bd5" strokeWidth="1.8" strokeLinejoin="round" />
        {/* End dots */}
        <circle cx={sx(allPoints.length - 1)} cy={sy(cumA)} r="2.5" fill="#4ecb71" />
        <circle cx={sx(allPoints.length - 1)} cy={sy(cumB)} r="2.5" fill="#5b9bd5" />
        {/* Labels */}
        <text x={w - 2} y={sy(cumA) - 5} fill="#4ecb71" fontSize="8" textAnchor="end">{cumA}</text>
        <text x={w - 2} y={sy(cumB) + 10} fill="#5b9bd5" fontSize="8" textAnchor="end">{cumB}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, color: '#888', marginTop: 2 }}>
        <span><span style={{ color: '#4ecb71' }}>{'\u25CF'}</span> {sideALabel || 'Side A'}</span>
        <span><span style={{ color: '#5b9bd5' }}>{'\u25CF'}</span> {sideBLabel || 'Side B'}</span>
      </div>
    </div>
  );
}