import { useEffect, useRef } from 'react';
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
import { supabase, isSupabaseConfigured, drainOutbox, wakeUpSupabase } from './lib/supabase';

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
  const profile                  = useAuthStore(s => s.profile);
  const sessionChecked           = useAuthStore(s => s.sessionChecked);
  const initAuth                 = useAuthStore(s => s.initAuth);
  const checkConnectionOrLogout  = useAuthStore(s => s.checkConnectionOrLogout);
  const sessionExpiredMessage    = useAuthStore(s => s.sessionExpiredMessage);
  const clearSessionMessage      = useAuthStore(s => s.clearSessionExpiredMessage);
  const syncFromSupabase         = useTournamentStore(s => s.syncFromSupabase);
  const fetchAllBets             = useBetsStore(s => s.fetchAllBets);
  const syncPhaseSettings        = usePhaseSettingsStore(s => s.syncPhaseSettings);

  // Ref compartilhado: permite que o handler de visibilitychange chame
  // checkAndReconnect() do useEffect do Realtime sem acoplamento de estado.
  const reconnectRealtimeRef = useRef<(() => void) | null>(null);

  // Auto-dismiss do toast de sessão expirada após 6 s
  useEffect(() => {
    if (!sessionExpiredMessage) return;
    const t = setTimeout(clearSessionMessage, 4000);
    return () => clearTimeout(t);
  }, [sessionExpiredMessage, clearSessionMessage]);

  // Inicialização: apenas dispara initAuth.
  // drainOutbox é proposital mente adiado para o effect de sessionChecked —
  // se o JWT expirou, drainOutbox rodaria com auth.uid()=null e levaria
  // RLS-block em todas as ops da outbox antes de a sessão ser restaurada.
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Após sessão verificada: acorda o servidor, drena outbox e sincroniza tudo.
  //
  // ⚠️ wakeUpSupabase ANTES dos syncs paralelos é crítico:
  //   - Se o usuário fica deslogado por > 5 min, o free tier hiberna
  //   - No boot, todos os syncs disparam em paralelo via Promise.allSettled
  //   - Sem wake-up, as 3 chamadas competem pela 1ª resposta do cold start
  //     e estouram timeout simultâneo
  //   - drainOutbox() tem wake-up interno, mas retorna cedo se a outbox está
  //     vazia — então o wake-up dele não cobre boot normal
  useEffect(() => {
    if (!sessionChecked) return;

    const runSync = async () => {
      await wakeUpSupabase();
      await drainOutbox();
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchAllBets(), syncPhaseSettings()] : []),
      ]);
      if (profile) markSyncDone(profile.id);
    };

    runSync();

    // Segundo sync após 15s — fallback se a 1ª passada ainda pegou cold start.
    // Re-acorda o servidor por garantia.
    const retryTimer = setTimeout(async () => {
      await wakeUpSupabase();
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

      // 1. Verifica/renova sessão — se o refresh token expirou (sessão morta),
      //    faz logout + exibe toast e aborta: não adianta sincronizar dados.
      //    Se a sessão está viva, checkConnectionOrLogout() também atualiza o
      //    JWT do WebSocket Realtime (setAuth) para evitar re-conexões futuras.
      const sessionOk = await checkConnectionOrLogout();
      if (!sessionOk) return;

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

      // 3. Verifica canal Realtime imediatamente — se caiu durante o background,
      //    reconecta agora em vez de esperar o próximo tick do keepalive (4 min).
      reconnectRealtimeRef.current?.();

      // 4. Acorda o servidor antes de drenar/sync. Background longo derruba o
      //    keepalive (browser throttles timers em background), então o free tier
      //    pode ter hibernado mesmo com keepalive configurado.
      await wakeUpSupabase();

      // 5. Drena outbox e re-sincroniza tudo
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

  // Drena outbox no evento de foco da janela — cobertura extra para combinações
  // browser/OS onde window.focus dispara sem visibilitychange (ex: clicar de volta
  // numa aba que ficou visível mas sem foco).
  //
  // Intencional NÃO chamar checkConnectionOrLogout() aqui para evitar duplo-refresh
  // com o handler de visibilitychange. O foco por si só não indica sessão expirada —
  // apenas garante que ops pendentes na outbox sejam drenadas ao voltar ao app.
  useEffect(() => {
    if (!profile) return;
    const onFocus = () => { drainOutbox(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [profile?.id]);

  // Keepalive a cada 4 min — DUAS responsabilidades:
  //
  // 1) wakeUpSupabase(): query trivial que mantém o free tier acordado.
  //    Sem isso o servidor hiberna após ~5 min e a próxima requisição do
  //    usuário (saveBet) cai num cold start de 5-30s. Com ping a cada 4 min
  //    o servidor nunca dorme e o palpite sobe em < 1s.
  //
  // 2) refreshSession(): renova o JWT proativamente. Cobre o cenário de aba
  //    aberta o tempo todo onde visibilitychange/focus nunca disparam.
  //    Atualiza sessionExpiresAt via onAuthStateChange (TOKEN_REFRESHED).
  //
  // wakeUp roda PRIMEIRO porque refreshSession é uma chamada de auth (caminho
  // diferente no servidor) e não acorda o PostgREST sozinho.
  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;
    const keepalive = setInterval(async () => {
      await wakeUpSupabase();
      try {
        const { error } = await supabase.auth.refreshSession();
        if (error) {
          console.warn('[keepalive] refresh falhou:', error.message);
          checkConnectionOrLogout();
        } else {
          console.log('[keepalive] servidor pingado + sessão renovada');
        }
      } catch (e) {
        console.warn('[keepalive] exceção:', e);
      }
    }, 4 * 60 * 1000);
    return () => clearInterval(keepalive);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Supabase Realtime: propaga mudanças em tempo real para todos os browsers.
  // Requer: no painel Supabase → Database → Replication → adicionar
  // match_results, bets e phase_settings à publication `supabase_realtime`.
  //
  // ⚠️ Resiliência contra loops de queda (firewall/proxy corporativo matando WS):
  //
  //   - Backoff exponencial: 5s, 10s, 20s, 40s, 60s (cap)
  //   - Após 8 falhas consecutivas, para de tentar por 5 min (circuit breaker)
  //   - NÃO dispara syncFromSupabase/fetchAllBets/syncPhaseSettings em cada queda —
  //     só se o canal ficou estável por >= 30s antes de cair. Quedas em cascata
  //     (< 30s entre connect e close) indicam loop de firewall, não evento perdido.
  //     Sem esse guard, cada ciclo de 6s disparava 3 queries pesadas, saturava o
  //     event loop e travava a UI.
  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;

    let mounted       = true;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let lastConnectedAt = 0;        // timestamp do último SUBSCRIBED
    let circuitOpenUntil = 0;       // se > now, não tenta reconectar

    const BACKOFF_STEPS = [5000, 10000, 20000, 40000, 60000];
    const STABLE_THRESHOLD_MS = 30_000;    // canal precisa durar 30s pra ser "estável"
    const MAX_FAILURES_BEFORE_CIRCUIT = 8;
    const CIRCUIT_OPEN_DURATION = 5 * 60_000; // 5 min sem tentar

    const connect = () => {
      if (!mounted) return;
      if (Date.now() < circuitOpenUntil) {
        console.warn('[realtime] circuit breaker aberto — não tentando reconectar agora');
        return;
      }

      // Timestamp no nome: cada tentativa cria um canal novo — elimina ghost channels
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
            lastConnectedAt = Date.now();
            consecutiveFailures = 0;
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'     ||
            status === 'CLOSED'
          ) {
            const wasStable = lastConnectedAt > 0 && (Date.now() - lastConnectedAt) >= STABLE_THRESHOLD_MS;
            consecutiveFailures += 1;

            console.warn(
              '[realtime] canal perdido —', status,
              `(falhas: ${consecutiveFailures}, estável: ${wasStable})`,
              err?.message ?? ''
            );

            // Só dispara sync se a conexão durou tempo suficiente — caso contrário
            // é loop de queda e não vale a pena queimar queries que vão dar timeout.
            if (wasStable) {
              syncFromSupabase();
              fetchAllBets();
              syncPhaseSettings();
            }

            // Circuit breaker: muitas falhas seguidas → para de tentar por 5 min
            if (consecutiveFailures >= MAX_FAILURES_BEFORE_CIRCUIT) {
              circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION;
              consecutiveFailures = 0; // reset para quando voltar
              console.error('[realtime] muitas falhas — pausando reconexões por 5 min (provável firewall bloqueando WebSocket)');
              return;
            }

            if (mounted && !reconnectTimer) {
              const delay = BACKOFF_STEPS[Math.min(consecutiveFailures - 1, BACKOFF_STEPS.length - 1)];
              console.log(`[realtime] reconectando em ${delay / 1000}s`);
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
                connect();
              }, delay);
            }
          }
        });

      activeChannel = ch;
    };

    // Camada 2 — verifica estado real do canal e reconecta se necessário.
    // Exposta via ref para uso no handler de visibilitychange (cross-useEffect).
    const checkAndReconnect = () => {
      if (!mounted) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (activeChannel as any)?.state as string | undefined;
      // 'joined' = conectado e recebendo eventos. 'joining' = em processo de conexão.
      if (state !== 'joined' && state !== 'joining') {
        console.warn('[realtime] keepalive: estado', state ?? 'null', '— reconectando');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
        // Sync manual para recuperar eventos perdidos durante o período offline
        syncFromSupabase();
        fetchAllBets();
        syncPhaseSettings();
        connect();
      }
    };

    // Disponibiliza para o handler de visibilitychange sem acoplamento de estado
    reconnectRealtimeRef.current = checkAndReconnect;

    connect();

    // Keepalive a cada 4 min: detecta timeout silencioso (~6 min no free tier)
    // antes que o próximo visibilitychange ou ação do usuário o exponha.
    const keepaliveTimer = setInterval(checkAndReconnect, 4 * 60 * 1000);

    return () => {
      mounted = false;
      reconnectRealtimeRef.current = null;
      clearInterval(keepaliveTimer);
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
    <>
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

      {/* Toast de sessão expirada — renderizado fora do Router para sobreviver
          à troca de rota que ocorre imediatamente após o logout. */}
      {sessionExpiredMessage && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4 z-[100]">
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3 shadow-xl w-full max-w-sm"
            style={{ background: '#1C0A0A', border: '1px solid #EF444450' }}
          >
            <span className="text-xl shrink-0">⚠️</span>
            <span className="text-sm flex-1" style={{ color: '#FCA5A5' }}>
              {sessionExpiredMessage}
            </span>
            <button
              onClick={clearSessionMessage}
              className="shrink-0 leading-none hover:opacity-70"
              style={{ color: '#F87171' }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
}
