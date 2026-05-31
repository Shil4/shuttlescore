import { useState } from 'react';

const MEDAL_EMOJI = { gold: '\uD83E\uDD47', silver: '\uD83E\uDD48', bronze: '\uD83E\uDD49' };

export default function MedalBadges({ medals }) {
  const [tooltip, setTooltip] = useState(null);

  if (!medals || medals.length === 0) return null;

  return (
    <div className="pub-medals">
      {medals.map((md, i) => (
        <span key={i} className={'pub-medal ' + md.type}
          onClick={() => setTooltip(tooltip === i ? null : i)}
          onMouseEnter={() => setTooltip(i)} onMouseLeave={() => setTooltip(null)}>
          {MEDAL_EMOJI[md.type] || ''}
          {md.count > 1 && <span className="pub-medal-count">{'\u00D7'}{md.count}</span>}
          <span style={{ fontSize: 10, opacity: 0.8 }}>{md.label}</span>
          {tooltip === i && (
            <span className="pub-medal-tooltip">
              {md.type === 'gold' ? 'Champion' : md.type === 'silver' ? 'Runner-up' : 'Third Place'}
              {' \u2014 '}{md.label}{md.count > 1 ? ' (\u00D7' + md.count + ')' : ''}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Small inline medal icon for match cards */
export function MedalIcon({ type }) {
  if (!type) return null;
  return <span style={{ fontSize: 18, marginLeft: 4, marginRight: 4, verticalAlign: 'middle' }}
    title={type === 'gold' ? 'Champion' : type === 'silver' ? 'Runner-up' : 'Third Place'}>
    {MEDAL_EMOJI[type] || ''}
  </span>;
}