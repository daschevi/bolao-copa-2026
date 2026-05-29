import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, drainOutbox } from '../lib/supabase';
import type { Profile } from '../types';

const ALLOWED_DOMAIN = 'golfleet.com.br';
const SESSION_TOKEN_KEY = 'bolao-session-token';

/**
 * Gera UUID v4 — usa crypto.randomUUID() onde disponível (Chrome 92+, FF 95+,
 * Safari 15.4+), com fallback manual para browsers antigos.
 */
function genSessionToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Reclama propriedade da sessão única: gera UUID novo, escreve em
 * profiles.active_session_token e salva no localStorage. Chamado quando o
 * usuário faz login (não em refresh de sessão).
 *
 * Se a escrita no BD falhar (rede), salvamos local mesmo assim — a próxima
 * verificação vai detectar e tentar regravar. Sem isso, um login em rede
 * ruim ficaria sem ID de sessão e o keepalive interpretaria como "outro
 * device assumiu" deslogando o próprio usuário.
 */
async function claimSession(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const token = genSessionToken();
  localStorage.setItem(SESSION_TOKEN_KEY, token);
  try {
    await supabase.from('profiles').update({ active_session_token: token }).eq('id', userId);
  } catch (e) {
    console.warn('[session] falha ao gravar active_session_token (continua localmente):', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime channel para revogação instantânea de sessão
// ─────────────────────────────────────────────────────────────────────────────
//
// Quando outro dispositivo faz login, ele grava novo UUID em
// profiles.active_session_token. Este canal escuta esse UPDATE filtrado pelo
// id do próprio usuário — assim que o evento chega, o cliente é expulso em < 1s.
//
// Fallback: se o canal Realtime cair (firewall corporativo, sleep do free
// tier), o polling em verifySessionOwnership() no keepalive (4 min) e
// visibilitychange ainda detecta a mudança — só não é instantâneo.
//
// Estado em escopo de módulo (não em zustand) para sobreviver re-renders
// e evitar criar múltiplos canais por mudança de state.

let sessionRevocationChannel: ReturnType<typeof supabase.channel> | null = null;
let sessionRevocationUserId: string | null = null;

function subscribeToSessionRevocation(
  userId: string,
  onRevoked: () => Promise<void> | void,
): void {
  if (!isSupabaseConfigured) return;
  // Idempotente: se já assinamos pra este userId, mantém o canal existente
  if (sessionRevocationUserId === userId && sessionRevocationChannel) return;
  unsubscribeFromSessionRevocation();

  sessionRevocationUserId = userId;
  sessionRevocationChannel = supabase
    .channel(`session-revocation-${userId}`)
    .on('postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'profiles',
        filter: `id=eq.${userId}`,
      },
      (payload: { new?: { active_session_token?: string | null } }) => {
        const newToken   = payload.new?.active_session_token;
        const localToken = localStorage.getItem(SESSION_TOKEN_KEY);
        // Se newToken bate com local → este device é o dono novo (acabou de
        // gravar). Se diferente → outro device assumiu → expulsa.
        if (newToken && localToken && newToken !== localToken) {
          onRevoked();
        }
      },
    )
    .subscribe(() => {
      // Falhas silenciosas — o polling cobre como fallback. Não fazemos
      // reconnect explícito aqui pra não criar loop em redes hostis.
    });
}

function unsubscribeFromSessionRevocation(): void {
  if (sessionRevocationChannel) {
    supabase.removeChannel(sessionRevocationChannel);
    sessionRevocationChannel = null;
    sessionRevocationUserId = null;
  }
}

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

  const baseName =
    (userMeta?.full_name as string)?.trim() ||
    (userMeta?.name as string)?.trim() ||
    userEmail.split('@')[0] ||
    'jogador';

  // Tenta inserir com nome base; em caso de conflito de unique (23505),
  // adiciona sufixo numérico crescente até encontrar um nome disponível.
  // Cobre homônimos: "João Silva" → "João Silva2", "João Silva3", etc.
  let inserted: Record<string, unknown> | null = null;
  let insertErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = attempt === 0 ? baseName : `${baseName}${attempt + 1}`;
    const result = await supabase
      .from('profiles')
      .insert({ id: userId, username, is_admin: false })
      .select()
      .single();
    if (!result.error) { inserted = result.data as Record<string, unknown>; break; }
    // 23505 = unique_violation (PostgreSQL) — tenta próximo sufixo
    if (result.error.code !== '23505') { insertErr = result.error; break; }
  }

  if (!inserted) {
    console.error('[authStore] Erro ao criar perfil:', insertErr);
    // Fallback com sufixo do UUID para garantir unicidade mesmo sem BD
    const username = `${baseName}-${userId.slice(0, 6)}`;
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
  /**
   * Timestamp de expiração do JWT atual (em segundos, igual a session.expires_at).
   * Atualizado por initAuth, onAuthStateChange e checkConnectionOrLogout.
   * NÃO persistido — é estado de runtime recriado em cada carga de página.
   */
  sessionExpiresAt: number | null;
  initAuth: () => () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  clearSessionExpiredMessage: () => void;
  /**
   * Verificação 100% síncrona — compara Date.now() com sessionExpiresAt.
   * Zero latência, zero mutex, nunca bloqueia a UI.
   *
   * - Sessão válida  → retorna true  (seguro prosseguir com a escrita)
   * - Sessão expirada → seta toast "Sua conexão expirou..." e retorna false
   *
   * Usar antes de qualquer operação de escrita (palpite, resultado).
   * Não faz logout — apenas bloqueia a ação e orienta o usuário a atualizar a página.
   */
  checkConnection: () => boolean;
  /**
   * Verifica E renova o token via refreshSession() (com requisição de rede).
   * - Sucesso → atualiza JWT do WebSocket Realtime e retorna true
   * - Falha  → chama logout(), seta `sessionExpiredMessage` e retorna false
   *
   * Usar apenas no visibilitychange — a latência de rede é aceitável ali.
   */
  checkConnectionOrLogout: () => Promise<boolean>;
  /**
   * Verifica se o token de sessão local ainda bate com o do BD.
   * Se outro dispositivo fez login, o BD tem token diferente → este
   * dispositivo faz logout e exibe toast "entrou em outro dispositivo".
   *
   * Chamado pelo keepalive de 4 min e por visibilitychange. Idempotente,
   * silencioso quando tokens batem. Tolerante a falhas de rede: erro de
   * leitura → não desloga (assume problema transitório).
   */
  verifySessionOwnership: () => Promise<void>;
}

// SEGURANÇA — is_admin no store/localStorage controla apenas visibilidade de UI.
// Qualquer escrita admin (match_results, phase_settings) é validada pelo RLS
// no banco via subquery: `select is_admin from profiles where id = auth.uid()`.
// Editar localStorage para isAdmin=true mostra os botões mas todas as writes
// são barradas pelo Supabase — não é uma vulnerabilidade real.
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      loading: false,
      error: null,
      sessionChecked: false,
      sessionExpiredMessage: null,
      sessionExpiresAt: null,

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
          set({ profile, loading: false, error: null, sessionChecked: true, sessionExpiresAt: session.expires_at ?? null });

          // Reconecta o canal de revogação após reload de página (sessão
          // restaurada do localStorage — onAuthStateChange pode não disparar
          // SIGNED_IN nesse fluxo dependendo da versão do Supabase JS).
          subscribeToSessionRevocation(session.user.id, async () => {
            await get().logout();
            set({ sessionExpiredMessage: 'Sua sessão foi encerrada porque você entrou em outro dispositivo.' });
          });
        }).catch(() => {
          clearTimeout(sessionTimeout);
          // Falha de rede ao verificar sessão — libera a tela mesmo assim
          set({ sessionChecked: true });
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event: string, session: import('@supabase/supabase-js').Session | null) => {
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

            // TOKEN_REFRESHED: JWT renovado automaticamente — perfil já existe no store.
            // Atualiza apenas sessionExpiresAt sem refazer a query ao banco.
            // Sem esse atalho, fetchOrCreateProfile() bloquearia o update de sessionExpiresAt
            // por até 15s no cold start do free tier, deixando o timestamp stale.
            if (event === 'TOKEN_REFRESHED') {
              set({ sessionExpiresAt: session.expires_at ?? null });
              return;
            }

            const profile = await fetchOrCreateProfile(
              session.user.id,
              session.user.user_metadata ?? {},
              session.user.email ?? '',
            );
            set({ profile, loading: false, error: null, sessionExpiresAt: session.expires_at ?? null });

            // Sessão única por usuário: reclama token apenas em login NOVO,
            // não em restauração de sessão de página (INITIAL_SESSION com
            // localStorage já populado).
            //   - SIGNED_IN sem token local → login fresh deste device
            //   - SIGNED_IN com token local → recarregou aba, NÃO regenerar
            //     (senão sobrescreveríamos o token de outro device que possa
            //     ter feito login enquanto esta aba estava aberta)
            if (event === 'SIGNED_IN') {
              const existingToken = localStorage.getItem(SESSION_TOKEN_KEY);
              if (!existingToken) {
                await claimSession(session.user.id);
              }
            }

            // Subscribe (idempotente) ao canal Realtime de revogação. Se já
            // estamos assinados pra este userId, vira no-op. Cobre SIGNED_IN
            // após login fresh e TOKEN_REFRESHED após restauração de sessão.
            subscribeToSessionRevocation(session.user.id, async () => {
              await get().logout();
              set({ sessionExpiredMessage: 'Sua sessão foi encerrada porque você entrou em outro dispositivo.' });
            });
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

        // Encerra canal de revogação ANTES de signOut do Supabase. Se deixarmos
        // o canal vivo, o auto-reconnect do Supabase tentaria reabrir em nome
        // de um usuário que está deslogando.
        unsubscribeFromSessionRevocation();

        set({ profile: null, loading: false, error: null, sessionExpiresAt: null });
        if (isSupabaseConfigured) {
          try { await supabase.auth.signOut(); } catch { /* ignora */ }
        }
        // Limpa TODO o cache local — em PCs compartilhados, deixar bets/configs
        // de um usuário no localStorage vaza dado privado para o próximo login
        // e contamina o leaderboard até o fetchAllBets resolver.
        // Inclui a outbox: ops pendentes do usuário anterior seriam barradas
        // pelo RLS do próximo usuário e gerariam ruído nos logs.
        // Inclui o session-token: senão o próximo login no mesmo browser
        // reaproveitaria o token e o claimSession() seria pulado.
        [
          'bolao-auth',
          'bolao-bets',
          'bolao-tournament-v2',
          'bolao-phase-settings',
          'bolao-outbox-v1',
          SESSION_TOKEN_KEY,
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

      checkConnection: () => {
        if (!isSupabaseConfigured) return true; // dev/CI sem .env — sempre ok
        const { sessionExpiresAt } = get();
        // sessionExpiresAt é null apenas na janela de startup (initAuth ainda em voo).
        // Nesse intervalo aceitamos otimisticamente — a duração é < 1s e o usuário
        // não consegue interagir com o modal antes de o splash sair.
        if (sessionExpiresAt === null) return true;
        const nowSec = Date.now() / 1000;
        const blocking = nowSec > sessionExpiresAt + 300;

        // Só bloqueia se o JWT está expirado há mais de 5 minutos.
        //
        // Motivo do limiar generoso (+5 min, não -30s):
        //   Ao voltar do background, visibilitychange dispara checkConnectionOrLogout()
        //   que renova o token via rede (200 ms–2 s). Se o usuário clicar salvar nesse
        //   intervalo curto com o JWT recém-expirado, um limiar de -30 s bloquearia a
        //   ação incorretamente. Com +5 min:
        //     - JWT válido ou expirado há pouco → retorna true (persistOp já trata
        //       JWT expirado internamente via isJwtExpiredError + tryRefreshToken)
        //     - JWT expirado há > 5 min → refresh token definitivamente morto → bloqueia
        if (blocking) {
          set({ sessionExpiredMessage: 'Reconectando… Tente salvar novamente em instantes.' });
          return false;
        }
        return true;
      },

      checkConnectionOrLogout: async () => {
        if (!isSupabaseConfigured) return true; // dev/CI sem .env — sempre ok

        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data.session) {
            // Propaga token renovado para o WebSocket do Realtime
            // (o auto-refresh HTTP não atualiza o WS automaticamente).
            supabase.realtime.setAuth(data.session.access_token);
            // Atualiza timestamp para que checkConnection() continue síncrono e correto.
            set({ sessionExpiresAt: data.session.expires_at ?? null });
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

      verifySessionOwnership: async () => {
        if (!isSupabaseConfigured) return;
        const profile = get().profile;
        if (!profile) return;
        const localToken = localStorage.getItem(SESSION_TOKEN_KEY);
        if (!localToken) return; // ainda não reclamamos token — pula
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('active_session_token')
            .eq('id', profile.id)
            .single();
          if (error) {
            // Erro de leitura → não desloga, assume rede ruim
            console.warn('[session] verify falhou (rede):', error.message);
            return;
          }
          const remoteToken = data?.active_session_token;
          // remoteToken null = banco ainda não tem (migração não rodou ou
          // login pré-feature). Não desloga — apenas regrava.
          if (remoteToken == null) {
            await supabase.from('profiles')
              .update({ active_session_token: localToken })
              .eq('id', profile.id);
            return;
          }
          if (remoteToken !== localToken) {
            console.warn('[session] outro device assumiu — deslogando');
            await get().logout();
            set({ sessionExpiredMessage: 'Sua sessão foi encerrada porque você entrou em outro dispositivo.' });
          }
        } catch (e) {
          console.warn('[session] verify exceção:', e);
        }
      },
    }),
    { name: 'bolao-auth', partialize: (s) => ({ profile: s.profile }) }
  )
);
