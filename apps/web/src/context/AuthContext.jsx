import { createContext, useContext, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile() {
    try {
      const { data } = await api.get('/auth/me');
      setProfile(data.profile);
    } catch {
      setProfile(null);
    }
  }

  useEffect(() => {
    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) loadProfile().finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) loadProfile();
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(username, password) {
    const { data } = await api.post('/auth/login', {
      username: username.trim().toLowerCase(),
      password,
    });
    const { error } = await getSupabase().auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw new Error(error.message);
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut, isDemo: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
