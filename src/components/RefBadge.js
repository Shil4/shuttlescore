// Referee badge — red R box, used wherever a referee is identified
export default function RefBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: '#c0392b', color: '#fff', fontWeight: 700,
      fontSize: 10, padding: '1px 5px', borderRadius: 3,
      letterSpacing: 0.5, lineHeight: 1.4, flexShrink: 0,
    }}>R</span>
  );
}