import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Login.css';

export default function Login({ onBack }) {
  const { login, refereeLogin } = useAuth();
  const [tab, setTab] = useState('referee'); // 'referee' | 'admin'
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); }
    catch (err) { setError(err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleRefereeSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await refereeLogin(username, password); }
    catch (err) { setError(err.message || 'Invalid username or password'); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {onBack && (
          <button type="button" onClick={onBack} className="login-back-btn">
            ← Back to tournament
          </button>
        )}

        <div className="login-logo">
          <span className="login-logo-icon">🏸</span>
          <h1>ShuttleScore</h1>
          <p className="login-subtitle">Tournament Management</p>
        </div>

        {/* Tabs */}
        <div className="login-tabs">
          <button className={`login-tab ${tab === 'referee' ? 'active' : ''}`} onClick={() => { setTab('referee'); setError(''); }}>
            🏅 Referee
          </button>
          <button className={`login-tab ${tab === 'admin' ? 'active' : ''}`} onClick={() => { setTab('admin'); setError(''); }}>
            ⚙️ Admin
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        {tab === 'referee' ? (
          <form onSubmit={handleRefereeSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="username">Username</label>
              <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. ref1" required autoFocus />
            </div>
            <div className="login-field">
              <label htmlFor="ref-password">Password</label>
              <input id="ref-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In as Referee'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleAdminSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com" required autoFocus />
            </div>
            <div className="login-field">
              <label htmlFor="admin-password">Password</label>
              <input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In as Admin'}
            </button>
          </form>
        )}

        <p className="login-footer">
          Only admins and referees need to sign in.<br />
          Spectators can view everything without an account.
        </p>
      </div>
    </div>
  );
}