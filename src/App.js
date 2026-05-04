import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PublicView from './components/public/PublicView';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-inner">
          <span className="app-loading-icon">🏸</span>
          <p>Loading ShuttleScore...</p>
        </div>
      </div>
    );
  }

  // Logged in → show dashboard
  if (user) {
    return <Dashboard />;
  }

  // Show login page if requested
  if (showLogin) {
    return <Login onBack={() => setShowLogin(false)} />;
  }

  // Default: public view
  return <PublicView onLogin={() => setShowLogin(true)} />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;