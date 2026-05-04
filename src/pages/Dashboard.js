import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import TournamentManager from '../components/admin/TournamentManager';
import PlayerManager from '../components/admin/PlayerManager';
import EventManager from '../components/admin/EventManager';
import DrawManager from '../components/admin/DrawManager';
import MatchManager from '../components/admin/MatchManager';
import './Dashboard.css';

const NAV_ITEMS = [
  { key: 'tournaments', label: 'Tournaments', icon: '🏆' },
  { key: 'players', label: 'Players', icon: '👤' },
  { key: 'events', label: 'Events', icon: '📋' },
  { key: 'draws', label: 'Draws', icon: '🎲' },
  { key: 'matches', label: 'Matches', icon: '🏸' },
  { key: 'referees', label: 'Referees', icon: '👨‍⚖️', disabled: true },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState('tournaments');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const renderContent = () => {
    switch (activeSection) {
      case 'tournaments':
        return <TournamentManager />;
      case 'players':
        return <PlayerManager />;
      case 'events':
        return <EventManager />;
      case 'draws':
        return <DrawManager />;
      case 'matches':
        return <MatchManager />;
      default:
        return (
          <div className="dash-placeholder">
            <p>🚧 {NAV_ITEMS.find(n => n.key === activeSection)?.label} — coming soon</p>
          </div>
        );
    }
  };

  return (
    <div className="dashboard">
      {/* Top bar */}
      <header className="dash-header">
        <div className="dash-header-left">
          <button
            className="dash-menu-btn"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            ☰
          </button>
          <span className="dash-brand">🏸 ShuttleScore</span>
        </div>
        <div className="dash-header-right">
          <span className="dash-user-name">{user?.profile?.name}</span>
          <span className="dash-user-role">{user?.role}</span>
          <button className="dash-logout-btn" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <div className="dash-body">
        {/* Sidebar */}
        <nav className={`dash-sidebar ${mobileNavOpen ? 'open' : ''}`}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`dash-nav-item ${activeSection === item.key ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
              onClick={() => {
                if (!item.disabled) {
                  setActiveSection(item.key);
                  setMobileNavOpen(false);
                }
              }}
              disabled={item.disabled}
            >
              <span className="dash-nav-icon">{item.icon}</span>
              <span className="dash-nav-label">{item.label}</span>
              {item.disabled && <span className="dash-nav-soon">soon</span>}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="dash-content">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}