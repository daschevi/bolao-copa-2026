import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Groups } from './pages/Groups';
import { Knockout } from './pages/Knockout';
import { MyBets } from './pages/MyBets';
import { Leaderboard } from './pages/Leaderboard';
import { Rules } from './pages/Rules';
import { useAuthStore } from './store/authStore';
import { useTournamentStore } from './store/tournamentStore';
import { useBetsStore } from './store/betsStore';
import { usePhaseSettingsStore } from './store/phaseSettingsStore';
import { supabase, isSupabaseConfigured, drainOutbox } from './lib/supabase';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const profile = useAuthStore(s => s.profile);
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ── Estratégia de expiração de cache ─────────────────────────────────────────
//
// Rastreia quando foi o último sync bem-sucedido por usuário.
// TTL de 1h: alinhado com o tempo de expiração do JWT do Supabase — se o
// cache não foi atualizado dentro desse período, não pode ser confiável.
// Chave por usuário: evita que o timestamp de um usuário afete o próximo.
//
// Uso:
//   - `markSyncDone(userId)` → chamado após cada ciclo de sync concluído
//   - `isSyncStale(userId)`  → true se > 1h sem sync bem-sucedido
//   - Em `visibilitychange` com cache expirado: descarta bets locais antes
//     de re-buscar, evitando que o usuário veja dados velhos com confiança.
//     (No boot o splash cobre o período de loading — não precisamos limpar.)

const SYNC_TTL_MS = 60 * 60 * 1000; // 1 hora

const syncKey = (userId: string) => `bolao-sync-${userId}`;

function isSyncStale(userId: string): boolean {
  const ts = Number(localStorage.getItem(syncKey(userId)) ?? '0');
  return Date.now() - ts > SYNC_TTL_MS;
}

function markSyncDone(userId: string): void {
  localStorage.setItem(syncKey(userId), String(Date.now()));
}

export default function App() {
  // Seletores granulares: assinar só o que cada effect/render usa.
  // Antes (destructuring) o componente re-renderizava a cada `set` em qualquer
  // store, disparando re-runs desnecessários dos useEffects de deps mutáveis.
  const profile          = useAuthStore(s => s.profile);
  const sessionChecked   = useAuthStore(s => s.sessionChecked);
  const initAuth         = useAuthStore(s => s.initAuth);
  const syncFromSupabase = useTournamentStore(s => s.syncFromSupabase);
  const fetchAllBets     = useBetsStore(s => s.fetchAllBets);
  const syncPhaseSettings = usePhaseSettingsStore(s => s.syncPhaseSettings);

  // Inicialização: apenas dispara initAuth.
  // drainOutbox é proposital mente adiado para o effect de sessionChecked —
  // se o JWT expirou, drainOutbox rodaria com auth.uid()=null e levaria
  // RLS-block em todas as ops da outbox antes de a sessão ser restaurada.
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Após sessão verificada: drena outbox (agora com auth.uid() disponível)
  // e sincroniza tudo. Marca o timestamp de sync após conclusão para que o
  // handler de visibilitychange saiba que o cache está fresco.
  useEffect(() => {
    if (!sessionChecked) return;

    const runSync = async () => {
      await drainOutbox();
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchAllBets(), syncPhaseSettings()] : []),
      ]);
      if (profile) markSyncDone(profile.id);
    };

    runSync();

    // Segundo sync após 15s — cobre cold start do Supabase free tier
    const retryTimer = setTimeout(async () => {
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchAllBets(), syncPhaseSettings()] : []),
      ]);
      if (profile) markSyncDone(profile.id);
    }, 15000);

    return () => clearTimeout(retryTimer);
  }, [sessionChecked, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync quando o usuário volta ao app (minimizou, trocou de aba, desbloqueou).
  // Renova JWT + verifica se o cache expirou antes de re-buscar os dados.
  useEffect(() => {
    if (!profile) return;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;

      // 1. Renova JWT e atualiza WebSocket Realtime — cobre background > 1h no mobile
      if (isSupabaseConfigured) {
        try {
          const { data } = await supabase.auth.refreshSession();
          if (data.session?.access_token) {
            supabase.realtime.setAuth(data.session.access_token);
          }
        } catch { /* ignora */ }
      }

      // 2. Cache expirado (> 1h sem sync): descarta bets locais antes de re-buscar.
      //    Evita que o usuário leia e confie em dados com mais de 1h de idade
      //    enquanto o fetch acontece. Bets com pendingPersist=true são preservados
      //    (ainda estão em voo — serão re-enviados pela outbox).
      //    Resultado das partidas não é limpo aqui: syncFromSupabase já zera via
      //    hasPendingOutboxOpForMatch quando ausente no BD.
      if (isSyncStale(profile.id)) {
        console.log('[sync] cache expirado (> 1h) — descartando bets locais antes do re-sync');
        useBetsStore.setState(state => ({
          bets: Object.fromEntries(
            Object.entries(state.bets).filter(([, bet]) => bet.pendingPersist)
          ),
        }));
      }

      // 3. Drena outbox e re-sincroniza tudo
      await drainOutbox();
      await Promise.allSettled([
        syncFromSupabase(),
        fetchAllBets(),
        syncPhaseSettings(),
      ]);
      markSyncDone(profile.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-drena outbox quando rede volta — cobre o caso de o usuário ficar
  // offline com palpites na fila e voltar online sem trocar de aba.
  useEffect(() => {
    const onOnline = () => { drainOutbox(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Supabase Realtime: propaga mudanças em tempo real para todos os browsers.
  // Requer: no painel Supabase → Database → Replication → adicionar
  // match_results, bets e phase_settings à publication `supabase_realtime`.
  //
  // Estratégia de reconexão automática:
  //   - Canal cai (CHANNEL_ERROR / TIMED_OUT / CLOSED)
  //       → sync manual imediato para não perder dados
  //       → reconexão agendada em 5 s
  //   - Reconexão usa Date.now() no nome para nunca reutilizar objeto corrompido
  //   - Guards `mounted` + `reconnectTimer` evitam reconexões paralelas
  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;

    let mounted       = true;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!mounted) return;

      // Timestamp no nome: cada tentativa cria um canal novo, elimina ghost channels
      // acumulados de ciclos rápidos de logout/login ou reconexão.
      const channelName = `bolao-${profile.id}-${Date.now()}`;

      const ch = supabase
        .channel(channelName)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'match_results' },
          () => { syncFromSupabase(); }
        )
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'bets' },
          () => { fetchAllBets(); }
        )
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'phase_settings' },
          () => { syncPhaseSettings(); }
        )
        .subscribe((status: string, err?: Error) => {
          if (status === 'SUBSCRIBED') {
            console.log('[realtime] canal conectado:', channelName);
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'     ||
            status === 'CLOSED'
          ) {
            // Canal caiu (JWT expirado no WS, queda de rede, timeout do free tier etc.)
            console.warn('[realtime] canal perdido —', status, err?.message ?? '');

            // 1. Sync manual: recupera eventos que chegaram com o canal fechado
            syncFromSupabase();
            fetchAllBets();
            syncPhaseSettings();

            // 2. Reconexão automática após 5 s.
            // `!reconnectTimer` evita agendar múltiplos timers se o status
            // disparar em sequência (ex: TIMED_OUT seguido de CLOSED).
            if (mounted && !reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (activeChannel) {
                  supabase.removeChannel(activeChannel);
                  activeChannel = null;
                }
                connect();
              }, 5000);
            }
          }
        });

      activeChannel = ch;
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
    };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mostra splash apenas se não há profile cacheado no localStorage.
  // Usuários já logados entram direto — a verificação de sessão ocorre em background.
  if (!sessionChecked && !profile) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-2"
        style={{ background: '#070707' }}
      >
        <div className="text-5xl mb-1">⚽</div>
        <div
          className="font-black text-white text-xl uppercase animate-pulse"
          style={{ fontStyle: 'italic' }}
        >
          Bolão da Copa <span className="text-copa-green">🏆</span>
        </div>
        <div className="text-[10px] text-copa-green font-bold tracking-[0.3em] uppercase">
          golfleet · 2026
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      {profile && <Navbar />}
      <Routes>
        <Route path="/login"         element={profile ? <Navigate to="/grupos" replace /> : <Login />} />
        {/* /cadastro redirecionado — login apenas via Google corporativo */}
        <Route path="/cadastro"      element={<Navigate to="/login" replace />} />
        <Route path="/grupos"        element={<RequireAuth><Groups /></RequireAuth>} />
        <Route path="/chaveamento"   element={<RequireAuth><Knockout /></RequireAuth>} />
        <Route path="/meus-palpites" element={<RequireAuth><MyBets /></RequireAuth>} />
        <Route path="/classificacao" element={<RequireAuth><Leaderboard /></RequireAuth>} />
        <Route path="/regras"        element={<RequireAuth><Rules /></RequireAuth>} />
        <Route path="*"              element={<Navigate to={profile ? '/grupos' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
}
