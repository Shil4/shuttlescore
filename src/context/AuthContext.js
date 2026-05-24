import { createContext, useContext, useState, useEffect } from 'react';
import { AuthService } from '../services/AuthService';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { user, profile, role } for admin
  const [referee, setReferee] = useState(null);  // { id, username, display_name, player_id } for referee
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    // Check admin session
    AuthService.getCurrentUser()
      .then((current) => {
        setUser(current);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Check referee session from localStorage
    const savedRef = localStorage.getItem('shuttlescore_referee');
    if (savedRef) {
      try {
        const parsed = JSON.parse(savedRef);
        // Verify it's still valid
        supabase.from('referees').select('*').eq('id', parsed.id).single()
          .then(({ data }) => {
            if (data) setReferee(data);
            else localStorage.removeItem('shuttlescore_referee');
          });
      } catch { localStorage.removeItem('shuttlescore_referee'); }
    }

    // Listen for auth changes
    const { data: listener } = AuthService.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
        const current = await AuthService.getCurrentUser();
        setUser(current);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => { listener?.subscription?.unsubscribe(); };
  }, []);

  const login = async (email, password) => {
    const result = await AuthService.login(email, password);
    setUser(result);
    return result;
  };

  const logout = async () => {
    await AuthService.logout();
    setUser(null);
  };

  // Referee login — custom auth (not Supabase Auth)
  const refereeLogin = async (username, password) => {
    const { data, error } = await supabase
      .from('referees')
      .select('*')
      .eq('username', username.trim())
      .eq('password', password)
      .single();
    if (error || !data) throw new Error('Invalid username or password');
    setReferee(data);
    localStorage.setItem('shuttlescore_referee', JSON.stringify(data));
    return data;
  };

  const refereeLogout = () => {
    setReferee(null);
    localStorage.removeItem('shuttlescore_referee');
  };

  // Update referee data in context (after name change, player link, etc.)
  const refreshReferee = async () => {
    if (!referee) return;
    const { data } = await supabase.from('referees').select('*').eq('id', referee.id).single();
    if (data) {
      setReferee(data);
      localStorage.setItem('shuttlescore_referee', JSON.stringify(data));
    }
  };

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout,
      referee, refereeLogin, refereeLogout, refreshReferee,
      isAdmin: !!user?.role && user.role === 'admin',
      isReferee: !!referee,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}