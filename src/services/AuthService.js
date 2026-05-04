// ─── AuthService ─────────────────────────────────────────────
// Handles login, logout, session, and role checks.
// This is the only file that imports supabase for auth.
// Swap this file to change auth providers.

import { supabase } from '../lib/supabase';

export const AuthService = {
  // ── Login ──────────────────────────────────────────────────
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;

    // Fetch profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) throw profileError;

    return {
      user: data.user,
      profile,
      role: profile.role,
    };
  },

  // ── Logout ─────────────────────────────────────────────────
  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // ── Get Current Session ────────────────────────────────────
  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) return null;

    return {
      user,
      profile,
      role: profile.role,
    };
  },

  // ── Role Checks ────────────────────────────────────────────
  async isAdmin() {
    const current = await this.getCurrentUser();
    return current?.role === 'admin';
  },

  async isReferee() {
    const current = await this.getCurrentUser();
    return current?.role === 'referee';
  },

  // ── Create Referee Account (admin only) ────────────────────
  async createReferee(name, email, password) {
    // Use Supabase admin API to create user
    // Note: In production, this would use a server-side function
    // For now, we create via the client and then insert profile
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        name,
        role: 'referee',
      });

    if (profileError) throw profileError;

    return { id: data.user.id, name, email, role: 'referee' };
  },

  // ── Listen to Auth Changes ─────────────────────────────────
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },
};
