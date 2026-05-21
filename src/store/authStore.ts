import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Profile } from '../types';

const ALLOWED_DOMAIN = 'golfleet.com.br';

function isDomainAllowed(email: string | undefined): boolean {
  return !!email?.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// Converte linha do banco (snake_case) → Profile (camelCase)
function rowToProfile(row: Record<string, unknown>): Profile {
  return {
    id:        row.id        as string,
    username:  row.username  as string,
    isAdmin:   (row.is_admin as boolean) ?? false,
    createdAt: row.created_at as string,
  };
}

async function fetchOrCreateProfile(
  userId: string,
  userMeta: Record<string, unknown>,
  userEmail: string,
): Promise<Profile> {
  // Tenta buscar perfil existente
  const { data, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (data) return rowToProfile(data);

  // Perfil não existe — cria no primeiro login
  if (fetchErr && fetchErr.code !== 'PGRST116') {
    // PGRST116 = "Row not found" — outros erros são inesperados
    console.error('[authStore] Erro ao buscar perfil:', fetchErr);
  }

  const username =
    (userMeta?.full_name as string)?.trim() ||
    (userMeta?.name as string)?.trim() ||
    userEmail.split('@')[0] ||
    'jogador';

  // INSERT com colunas snake_case conforme o schema do banco
  const { data: inserted, error: insertErr } = await supabase
    .from('profiles')
    .insert({ id: userId, username, is_admin: false })
    .select()
    .single();

  if (insertErr) {
    console.error('[authStore] Erro ao criar perfil:', insertErr);
    // Retorna perfil temporário para não quebrar a sessão
    return { id: userId, username, isAdmin: false, createdAt: new Date().toISOString() };
  }

  return rowToProfile(inserted);
}

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  /** true assim que a verificação inicial de sessão terminar (com ou sem sessão ativa) */
  sessionChecked: boolean;
  initAuth: () => () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      loading: false,
      error: null,
      sessionChecked: false,

      initAuth: () => {
        if (!isSupabaseConfigured) {
          set({ sessionChecked: true });
          return () => {};
        }

        // Restaura sessão existente (inclui retorno do OAuth via PKCE)
        // Timeout de 8s: se Supabase não responder (free tier dormindo),
        // libera a tela mesmo assim para não travar na splash.
        const sessionTimeout = setTimeout(() => {
          set(s => s.sessionChecked ? s : { ...s, sessionChecked: true });
        }, 8000);

        supabase.auth.getSession().then(async ({
          data: { session },
        }: { data: { session: import('@supabase/supabase-js').Session | null } }) => {
          clearTimeout(sessionTimeout);

          if (!session?.user) {
            // Se há profile cacheado mas o JWT/refresh token expirou,
            // limpa silenciosamente para forçar novo login.
            if (get().profile) set({ profile: null, sessionChecked: true });
            else set({ sessionChecked: true });
            return;
          }

          if (!isDomainAllowed(session.user.email)) {
            await supabase.auth.signOut();
            set({ profile: null, loading: false, error: `Acesso restrito a usuários @${ALLOWED_DOMAIN}`, sessionChecked: true });
            return;
          }

          const profile = await fetchOrCreateProfile(
            session.user.id,
            session.user.user_metadata ?? {},
            session.user.email ?? '',
          );
          set({ profile, loading: false, error: null, sessionChecked: true });
        }).catch(() => {
          clearTimeout(sessionTimeout);
          // Falha de rede ao verificar sessão — libera a tela mesmo assim
          set({ sessionChecked: true });
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event: string, session: import('@supabase/supabase-js').Session | null) => {
            if (!session?.user) {
              set({ profile: null, loading: false });
              return;
            }

            if (!isDomainAllowed(session.user.email)) {
              await supabase.auth.signOut();
              set({
                profile: null,
                loading: false,
                error: `Acesso restrito a colaboradores @${ALLOWED_DOMAIN}`,
              });
              return;
            }

            const profile = await fetchOrCreateProfile(
              session.user.id,
              session.user.user_metadata ?? {},
              session.user.email ?? '',
            );
            set({ profile, loading: false, error: null });
          }
        );

        return () => subscription.unsubscribe();
      },

      loginWithGoogle: async () => {
        set({ loading: true, error: null });
        if (!isSupabaseConfigured) {
          set({ error: 'Supabase não configurado.', loading: false });
          return;
        }
        const redirectTo = window.location.origin + import.meta.env.BASE_URL;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { hd: ALLOWED_DOMAIN },
          },
        });
        if (error) set({ error: error.message, loading: false });
      },

      logout: async () => {
        set({ profile: null, loading: false, error: null });
        if (isSupabaseConfigured) {
          try { await supabase.auth.signOut(); } catch (_) { /* ignora */ }
        }
        localStorage.removeItem('bolao-auth');
      },

      clearError: () => set({ error: null }),
    }),
    { name: 'bolao-auth', partialize: (s) => ({ profile: s.profile }) }
  )
);
