import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

const PUBLIC_URL = 'https://Shil4.github.io/shuttlescore';

export default function QRModal({ onClose }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, PUBLIC_URL, {
      width: 220,
      margin: 2,
      color: { dark: '#f0f0f0', light: '#0d0d14' },
    });
  }, []);

  return (
    <div className="pub-overlay" onClick={onClose}>
      <div className="pub-profile-card" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 280, textAlign: 'center' }}>
        <button className="pub-profile-close" onClick={onClose}>{'\u2715'}</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#ddd', marginBottom: 12 }}>
          {'\uD83D\uDCF1'} Scan to open ShuttleScore
        </div>
        <canvas ref={canvasRef} style={{ borderRadius: 8, display: 'block', margin: '0 auto' }} />
        <div style={{ fontSize: 11, color: '#555', marginTop: 10, wordBreak: 'break-all' }}>
          {PUBLIC_URL}
        </div>
      </div>
    </div>
  );
}