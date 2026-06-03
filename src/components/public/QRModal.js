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
      color: { dark: '#111111', light: '#ffffff' },
    });
  }, []);

  const handleSavePDF = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');

    const win = window.open('', '_blank');
    if (!win) { alert('Pop-up blocked — please allow pop-ups.'); return; }
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>ShuttleScore QR Code</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; display: flex; flex-direction: column;
      align-items: center; justify-content: center; min-height: 100vh; padding: 40px; }
    img { width: 220px; height: 220px; display: block; margin: 20px auto; }
    h1 { font-size: 22px; margin-bottom: 8px; text-align: center; }
    p { font-size: 13px; color: #555; text-align: center; margin-bottom: 4px; }
    .url { font-size: 11px; color: #888; margin-top: 8px; }
    @media print { body { justify-content: flex-start; padding-top: 60px; } }
  </style>
</head>
<body>
  <h1>🏸 ShuttleScore</h1>
  <p>Scan to follow the tournament live</p>
  <img src="${dataUrl}" alt="QR Code" />
  <p class="url">${PUBLIC_URL}</p>
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div className="pub-overlay" onClick={onClose}>
      <div className="pub-profile-card" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 280, textAlign: 'center' }}>
        <button className="pub-profile-close" onClick={onClose}>{'\u2715'}</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#ddd', marginBottom: 12 }}>
          {'\uD83D\uDCF1'} Scan to open ShuttleScore
        </div>
        <canvas ref={canvasRef} style={{ borderRadius: 8, display: 'block', margin: '0 auto',
          background: '#fff', padding: 8 }} />
        <div style={{ fontSize: 11, color: '#555', marginTop: 10, wordBreak: 'break-all' }}>
          {PUBLIC_URL}
        </div>
        <button onClick={handleSavePDF}
          style={{ marginTop: 14, width: '100%', padding: '9px 0', background: '#1a1a2e',
            border: '1px solid #3a3a5a', borderRadius: 8, color: '#ccc', cursor: 'pointer',
            fontSize: 13, fontWeight: 600 }}>
          📄 Save as PDF
        </button>
      </div>
    </div>
  );
}