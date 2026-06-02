import { useRef, useEffect, useState, useCallback } from 'react';
import { MedalIcon } from './MedalBadges';
import { sideLabel, stageLabel, scoreDisplay } from './helpers';

const STAGE_ORDER = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'];

/**
 * BracketView — renders knockout rounds with SVG connector lines.
 * Props: matches (knockout only), allPlayers, onPlayerClick
 */
export default function BracketView({ matches, allPlayers, onPlayerClick }) {
  const containerRef = useRef(null);
  const matchRefs = useRef({}); // matchId → DOM node
  const [connectors, setConnectors] = useState([]);

  const sideLbl = (arr) => sideLabel(arr, allPlayers);

  // Group matches by stage, sorted by bracket_position
  const byStage = {};
  matches.forEach(m => {
    if (!byStage[m.stage]) byStage[m.stage] = [];
    byStage[m.stage].push(m);
  });
  Object.keys(byStage).forEach(s => {
    byStage[s].sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0));
  });
  const stages = STAGE_ORDER.filter(s => byStage[s]);

  // Build a map of matchId → match for source lookups
  const matchMap = {};
  matches.forEach(m => { matchMap[m.id] = m; });

  // Recalculate SVG connector paths after layout
  const calcConnectors = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const lines = [];

    matches.forEach(m => {
      const targetEl = matchRefs.current[m.id];
      if (!targetEl) return;
      const targetRect = targetEl.getBoundingClientRect();
      const targetMidY = targetRect.top - containerRect.top + targetRect.height / 2;
      const targetX = targetRect.left - containerRect.left;

      [m.source_match_a, m.source_match_b].forEach((srcId, idx) => {
        if (!srcId) return;
        const srcEl = matchRefs.current[srcId];
        if (!srcEl) return;
        const srcRect = srcEl.getBoundingClientRect();
        const srcMidY = srcRect.top - containerRect.top + srcRect.height / 2;
        const srcX = srcRect.right - containerRect.left;

        // Midpoint X for the elbow
        const midX = srcX + (targetX - srcX) / 2;

        lines.push({
          key: `${srcId}-${m.id}-${idx}`,
          d: `M ${srcX} ${srcMidY} H ${midX} V ${targetMidY} H ${targetX}`,
          finished: matchMap[srcId]?.status === 'finished' || matchMap[srcId]?.status === 'locked',
        });
      });
    });

    setConnectors(lines);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Slight delay to let the DOM fully paint before measuring
    const t = setTimeout(calcConnectors, 60);
    return () => clearTimeout(t);
  }, [calcConnectors]);

  // Recalculate on window resize
  useEffect(() => {
    window.addEventListener('resize', calcConnectors);
    return () => window.removeEventListener('resize', calcConnectors);
  }, [calcConnectors]);

  if (!stages.length) return null;

  return (
    <div ref={containerRef} className="pub-bracket-svg-wrap">
      {/* SVG connector layer — absolutely positioned behind cards */}
      <svg className="pub-bracket-svg" aria-hidden="true">
        {connectors.map(c => (
          <path key={c.key} d={c.d}
            className={'pub-bracket-connector' + (c.finished ? ' done' : '')} />
        ))}
      </svg>

      {/* Round columns */}
      <div className="pub-bracket-rounds">
        {stages.map(stage => (
          <div key={stage} className="pub-bracket-round">
            <div className="pub-bracket-round-title">{stageLabel(stage)}</div>
            <div className="pub-bracket-round-matches">
              {byStage[stage].map(m => {
                const isFinished = m.status === 'finished' || m.status === 'locked';
                const scores = scoreDisplay(m);
                return (
                  <div key={m.id} ref={el => { matchRefs.current[m.id] = el; }}
                    className={'pub-bracket-match ' + (m.status === 'in_progress' ? 'live' : '')}>

                    <div className={'pub-bracket-side ' + (m.winner === 'side_a' ? 'winner' : '')}
                      onClick={() => m.side_a?.[0] && onPlayerClick(m.side_a[0])}>
                      <span className="pub-bracket-name">{sideLbl(m.side_a)}</span>
                      <span className="pub-bracket-pts">
                        {m.default_win && m.winner === 'side_a'
                          ? <span style={{ color: '#d4a843' }}>W/O</span>
                          : scores ? scores.map((s, i) => <span key={i}>{s.text} </span>) : null}
                      </span>
                      {isFinished && m.winner && m.stage === 'final' && <MedalIcon type={m.winner === 'side_a' ? 'gold' : 'silver'} />}
                      {isFinished && m.winner === 'side_a' && m.stage === 'third_place' && <MedalIcon type="bronze" />}
                    </div>

                    <div className={'pub-bracket-side ' + (m.winner === 'side_b' ? 'winner' : '')}
                      onClick={() => m.side_b?.[0] && onPlayerClick(m.side_b[0])}>
                      <span className="pub-bracket-name">{sideLbl(m.side_b)}</span>
                      <span className="pub-bracket-pts">
                        {m.default_win && m.winner === 'side_b'
                          ? <span style={{ color: '#d4a843' }}>W/O</span>
                          : scores ? scores.map((s, i) => <span key={i}>{s.text} </span>) : null}
                      </span>
                      {isFinished && m.winner && m.stage === 'final' && <MedalIcon type={m.winner === 'side_b' ? 'gold' : 'silver'} />}
                      {isFinished && m.winner === 'side_b' && m.stage === 'third_place' && <MedalIcon type="bronze" />}
                    </div>

                    {m.status === 'in_progress' && <div className="pub-bracket-live">LIVE</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}