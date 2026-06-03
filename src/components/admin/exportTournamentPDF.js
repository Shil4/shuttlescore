// ── Tournament Results PDF Export ─────────────────────────────
// Uses browser print-to-PDF — no library needed.
// Opens a styled print window with full tournament results.

import { supabase } from '../../lib/supabase';
import { TournamentService } from '../../services/TournamentService';

const STAGE_ORDER = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'];

const stageLabel = (s) => ({
  group: 'Group Stage', round_robin: 'Round Robin', round_of_32: 'Round of 32',
  round_of_16: 'Round of 16', quarterfinal: 'Quarterfinal', semifinal: 'Semifinal',
  third_place: '3rd Place', final: 'Final',
}[s] || s);

const categoryLabel = (c) => ({ u8: 'U-8', u12: 'U-13', u18: 'U-18', adult: 'Adult', senior: 'Senior' }[c] || c);
const genderLabel = (g) => ({ mens: "Men's", womens: "Women's", mixed: 'Mixed' }[g] || '');
const typeLabel = (t) => ({ singles: 'Singles', doubles: 'Doubles', mixed_doubles: 'Mixed Doubles' }[t] || t);

const formatDate = (d) => {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
};

const sideLabel = (ids, playerMap) => {
  if (!ids?.length) return 'TBD';
  return ids.map(id => playerMap[id]?.name || '?').join(' / ');
};

const scoreStr = (m) => {
  if (m.default_win) return m.winner === 'side_a' ? 'W/O' : 'W/O';
  const sets = m.score_data?.sets;
  if (!sets?.length) return '';
  return sets.map(s => `${s.side_a_points}-${s.side_b_points}`).join(', ');
};

const calcStandings = (groupId, matches) => {
  const gm = matches.filter(m => m.group_id === groupId && (m.status === 'finished' || m.status === 'locked'));
  const all = matches.filter(m => m.group_id === groupId);
  const stats = {};
  const sKey = (a) => a ? a.slice().sort().join(',') : '';
  const goc = (a) => {
    const k = sKey(a);
    if (!k) return null;
    if (!stats[k]) stats[k] = { key: k, playerIds: a, played: 0, won: 0, lost: 0, pf: 0, pa: 0 };
    return stats[k];
  };
  all.forEach(m => { if (m.side_a) goc(m.side_a); if (m.side_b) goc(m.side_b); });
  gm.forEach(m => {
    const sA = goc(m.side_a), sB = goc(m.side_b);
    if (!sA || !sB) return;
    sA.played++; sB.played++;
    const tA = (m.score_data?.sets || []).reduce((s, x) => s + (x.side_a_points || 0), 0);
    const tB = (m.score_data?.sets || []).reduce((s, x) => s + (x.side_b_points || 0), 0);
    sA.pf += tA; sA.pa += tB; sB.pf += tB; sB.pa += tA;
    if (m.winner === 'side_a') { sA.won++; sB.lost++; } else if (m.winner === 'side_b') { sB.won++; sA.lost++; }
  });
  return Object.values(stats).sort((a, b) => b.won - a.won || (b.pf - b.pa) - (a.pf - a.pa));
};

// ── Build HTML ─────────────────────────────────────────────────
const buildHTML = (tournament, events, groups, matches, players) => {
  const playerMap = {};
  players.forEach(p => { playerMap[p.id] = p; });

  const sl = (ids) => sideLabel(ids, playerMap);

  let body = '';

  for (const evt of events) {
    const evtMatches = matches.filter(m => m.event_id === evt.id);
    const evtGroups = groups.filter(g => g.event_id === evt.id);
    const evtLabel = [genderLabel(evt.gender), categoryLabel(evt.category), typeLabel(evt.type)].filter(Boolean).join(' ');

    body += `<div class="event">
      <h2>${evt.name} <span class="event-label">${evtLabel}</span></h2>`;

    // Group standings
    if (evtGroups.length > 0) {
      body += `<h3>Group Stage</h3><div class="groups">`;
      for (const grp of evtGroups) {
        const standings = calcStandings(grp.id, evtMatches);
        body += `<div class="group">
          <h4>${grp.name}</h4>
          <table>
            <thead><tr><th>#</th><th>Player / Team</th><th>P</th><th>W</th><th>L</th><th>PD</th></tr></thead>
            <tbody>`;
        standings.forEach((s, i) => {
          body += `<tr><td>${i + 1}</td><td>${sl(s.playerIds)}</td><td>${s.played}</td><td>${s.won}</td><td>${s.lost}</td><td>${s.pf - s.pa >= 0 ? '+' : ''}${s.pf - s.pa}</td></tr>`;
        });
        body += `</tbody></table></div>`;
      }
      body += `</div>`;
    }

    // Knockout results
    const knockout = evtMatches.filter(m => m.stage !== 'group' && m.stage !== 'round_robin' && m.winner);
    if (knockout.length > 0) {
      body += `<h3>Knockout Results</h3><table class="knockout">
        <thead><tr><th>Round</th><th>Winner</th><th>Score</th><th>Loser</th></tr></thead>
        <tbody>`;
      const byStage = {};
      knockout.forEach(m => { if (!byStage[m.stage]) byStage[m.stage] = []; byStage[m.stage].push(m); });
      STAGE_ORDER.filter(s => byStage[s]).forEach(stage => {
        byStage[stage].sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0)).forEach(m => {
          const winner = m.winner === 'side_a' ? m.side_a : m.side_b;
          const loser = m.winner === 'side_a' ? m.side_b : m.side_a;
          const medal = m.stage === 'final' ? ' 🥇' : m.stage === 'third_place' ? ' 🥉' : '';
          const loserMedal = m.stage === 'final' ? ' 🥈' : '';
          body += `<tr>
            <td>${stageLabel(stage)}</td>
            <td class="winner">${sl(winner)}${medal}</td>
            <td class="score">${scoreStr(m)}</td>
            <td>${sl(loser)}${loserMedal}</td>
          </tr>`;
        });
      });
      body += `</tbody></table>`;
    }

    body += `</div>`;
  }

  const venueStr = tournament.venue ? ` · ${tournament.venue}` : '';
  const dateStr = tournament.start_date ? ` · ${formatDate(tournament.start_date)}${tournament.end_date && tournament.end_date !== tournament.start_date ? ' – ' + formatDate(tournament.end_date) : ''}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${tournament.name} — Results</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; padding: 24px 28px; }
    header { margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 12px; }
    header h1 { font-size: 20px; margin-bottom: 4px; }
    header p { font-size: 11px; color: #555; }
    .event { margin-bottom: 28px; page-break-inside: avoid; }
    .event h2 { font-size: 14px; background: #111; color: #fff; padding: 6px 10px; margin-bottom: 10px; border-radius: 3px; }
    .event-label { font-size: 10px; font-weight: normal; opacity: 0.75; margin-left: 6px; }
    .event h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 10px 0 6px; }
    .event h4 { font-size: 11px; font-weight: 700; margin-bottom: 4px; }
    .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 10px; }
    .group { border: 1px solid #ddd; border-radius: 4px; padding: 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #f4f4f4; text-align: left; padding: 4px 6px; font-size: 10px; border-bottom: 1px solid #ccc; }
    td { padding: 4px 6px; border-bottom: 1px solid #eee; }
    td.winner { font-weight: 700; }
    td.score { color: #555; font-variant-numeric: tabular-nums; }
    table.knockout { border: 1px solid #ddd; border-radius: 4px; }
    table.knockout td, table.knockout th { padding: 5px 8px; }
    footer { margin-top: 20px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
    @media print {
      body { padding: 12px; }
      .event { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>🏸 ${tournament.name}</h1>
    <p>${tournament.status.replace('_', ' ')}${venueStr}${dateStr}</p>
  </header>
  ${body}
  <footer>Generated by ShuttleScore · ${new Date().toLocaleDateString('en-GB')}</footer>
</body>
</html>`;
};

// ── Main export function ───────────────────────────────────────
export async function exportTournamentPDF(tournament) {
  try {
    // Fetch events first, then groups/matches in parallel
    const eventsData = await TournamentService.getEvents(tournament.id);
    const eventIds = eventsData.map(e => e.id);
    const [{ data: groupsData }, { data: matchesData }, { data: playersData }] = await Promise.all([
      supabase.from('groups').select('*').in('event_id', eventIds),
      supabase.from('matches').select('*').in('event_id', eventIds),
      supabase.from('players').select('id, name'),
    ]);

    const html = buildHTML(tournament, eventsData, groupsData || [], matchesData || [], playersData || []);

    const win = window.open('', '_blank');
    if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  } catch (err) {
    alert('Export failed: ' + err.message);
  }
}