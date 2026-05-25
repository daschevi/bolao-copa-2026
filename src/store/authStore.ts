import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, drainOutbox } from '../lib/supabase';
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
  /**
   * Mensagem de feedback para o toast de sessão expirada.
   * Setada por checkConnectionOrLogout quando o refresh token está morto.
   * Limpa pelo próprio usuário (✕) ou pelo auto-dismiss de 6 s.
   * NÃO persistida no localStorage — é estado transitório de UI.
   */
  sessionExpiredMessage: string | null;
  initAuth: () => () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  clearSessionExpiredMessage: () => void;
  /**
   * Verifica se existe sessão ativa no localStorage — SEM requisição de rede.
   * ⚡ getSession() lê da memória/localStorage: resposta < 1ms, não trava UI.
   *
   * - Sessão presente → retorna true (seguro prosseguir com a escrita)
   * - Sessão ausente → seta toast "Sua conexão expirou..." e retorna false
   *
   * Usar antes de qualquer operação de escrita (palpite, resultado).
   * Não faz logout — apenas bloqueia a ação e orienta o usuário a atualizar a página.
   */
  checkConnection: () => Promise<boolean>;
  /**
   * Verifica E renova o token via refreshSession() (com requisição de rede).
   * - Sucesso → atualiza JWT do WebSocket Realtime e retorna true
   * - Falha  → chama logout(), seta `sessionExpiredMessage` e retorna false
   *
   * Usar apenas no visibilitychange — a latência de rede é aceitável ali.
   */
  checkConnectionOrLogout: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      loading: false,
      error: null,
      sessionChecked: false,
      sessionExpiredMessage: null,

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
          data: { session: rawSession },
        }: { data: { session: import('@supabase/supabase-js').Session | null } }) => {
          clearTimeout(sessionTimeout);

          // Fix: getSession() devolve o JWT do localStorage sem validar se
          // ainda é válido. Se o app ficou em background por > 1h no mobile,
          // o timer de auto-refresh do Supabase JS não disparou e o token
          // expirou. Renova agora — antes de setar sessionChecked=true — para
          // garantir que o drainOutbox() que roda logo em seguida use um token
          // fresco e as ops da outbox subam de vez.
          let session = rawSession;
          if (session?.expires_at) {
            const expiresAt = session.expires_at * 1000; // expires_at é em segundos
            const isStale   = Date.now() > expiresAt - 30_000; // 30s de margem
            if (isStale) {
              try {
                const { data } = await supabase.auth.refreshSession();
                if (data.session) {
                  session = data.session;
                  // Propaga o novo token para o WebSocket do Realtime —
                  // o canal pode ter sido criado antes do refresh e estaria
                  // com JWT expirado até a próxima reconexão.
                  supabase.realtime.setAuth(data.session.access_token);
                }
                // Se refresh falhou (refresh token expirado), session fica null
                // e o usuário será redirecionado para o login abaixo.
              } catch { /* ignora — tratado abaixo como session nula */ }
            }
          }

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
        // Tenta drenar ops pendentes antes de limpar — palpite feito há pouco
        // não será perdido se o usuário clicar logout em seguida.
        // Timeout de 3s: se a rede estiver ruim, não trava o logout.
        try {
          await Promise.race([drainOutbox(), new Promise(r => setTimeout(r, 3000))]);
        } catch { /* ignora */ }

        set({ profile: null, loading: false, error: null });
        if (isSupabaseConfigured) {
          try { await supabase.auth.signOut(); } catch { /* ignora */ }
        }
        // Limpa TODO o cache local — em PCs compartilhados, deixar bets/configs
        // de um usuário no localStorage vaza dado privado para o próximo login
        // e contamina o leaderboard até o fetchAllBets resolver.
        // Inclui a outbox: ops pendentes do usuário anterior seriam barradas
        // pelo RLS do próximo usuário e gerariam ruído nos logs.
        [
          'bolao-auth',
          'bolao-bets',
          'bolao-tournament-v2',
          'bolao-phase-settings',
          'bolao-outbox-v1',
        ].forEach(k => localStorage.removeItem(k));
        // Reseta os stores em memória que dependem do usuário.
        // (tournamentStore é dado público — será reidratado pelo próximo sync)
        try {
          // Imports dinâmicos para evitar dependência circular com os stores
          // que importam o authStore.
          const { useBetsStore } = await import('./betsStore');
          const { usePhaseSettingsStore, STAGE_KEYS } = await import('./phaseSettingsStore');
          useBetsStore.setState({ bets: {} });
          const initial = Object.fromEntries(
            STAGE_KEYS.map(k => [k, { visible: true, betsDeadline: null }])
          ) as ReturnType<typeof usePhaseSettingsStore.getState>['phases'];
          usePhaseSettingsStore.setState({ phases: initial });
        } catch (e) {
          console.warn('[authStore] falha ao resetar stores no logout:', e);
        }
      },

      clearError: () => set({ error: null }),

      clearSessionExpiredMessage: () => set({ sessionExpiredMessage: null }),

      checkConnection: async () => {
        if (!isSupabaseConfigured) return true; // dev/CI sem .env — sempre ok
        try {
          // getSession() lê da memória/localStorage sem requisição de rede.
          // Resolução < 1ms: não trava a UI nem bloqueia o clique do usuário.
          const { data, error } = await supabase.auth.getSession();
          if (!error && data.session) return true;
        } catch { /* fall through */ }
        // Sessão ausente → bloqueia a escrita e orienta o usuário.
        // Não faz logout: basta atualizar a página para renovar a sessão.
        set({ sessionExpiredMessage: 'Sua conexão expirou. Atualize a página para continuar.' });
        return false;
      },

      checkConnectionOrLogout: async () => {
        if (!isSupabaseConfigured) return true; // dev/CI sem .env — sempre ok

        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data.session) {
            // Propaga token renovado para o WebSocket do Realtime
            // (o auto-refresh HTTP não atualiza o WS automaticamente).
            supabase.realtime.setAuth(data.session.access_token);
            return true;
          }
        } catch { /* fall through */ }

        // Refresh token expirado ou inválido — sessão definitivamente morta.
        // Faz logout limpo antes de setar a mensagem para garantir que o
        // toast apareça após a limpeza de estado (evita flash de dados velhos).
        await get().logout();
        set({ sessionExpiredMessage: 'Sua sessão expirou. Faça login novamente para continuar.' });
        return false;
      },
    }),
    { name: 'bolao-auth', partialize: (s) => ({ profile: s.profile }) }
  )
);
