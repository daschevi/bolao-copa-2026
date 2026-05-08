import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Profile } from '../types';

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      profile: null,
      loading: false,
      error: null,

      login: async (email, password) => {
        set({ loading: true, error: null });
        if (!isSupabaseConfigured) {
          const mockProfile: Profile = { id: 'local-user', username: email.split('@')[0], isAdmin: true, createdAt: new Date().toISOString() };
          set({ profile: mockProfile, loading: false });
          return;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { set({ error: error.message, loading: false }); return; }
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
        set({ profile: profileData as Profile, loading: false });
      },

      register: async (email, password, username) => {
        set({ loading: true, error: null });
        if (!isSupabaseConfigured) {
          const mockProfile: Profile = { id: 'local-user', username, isAdmin: true, createdAt: new Date().toISOString() };
          set({ profile: mockProfile, loading: false });
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { set({ error: error.message, loading: false }); return; }
        if (!data.user) { set({ error: 'Erro ao criar usuário', loading: false }); return; }
        const newProfile: Profile = { id: data.user.id, username, isAdmin: false, createdAt: new Date().toISOString() };
        await supabase.from('profiles').insert(newProfile);
        set({ profile: newProfile, loading: false });
      },

      logout: async () => {
        if (isSupabaseConfigured) await supabase.auth.signOut();
        set({ profile: null });
      },

      clearError: () => set({ error: null }),
    }),
    { name: 'bolao-auth', partialize: (s) => ({ profile: s.profile }) }
  )
);
