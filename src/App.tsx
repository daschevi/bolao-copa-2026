import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Groups } from './pages/Groups';
import { Knockout } from './pages/Knockout';
import { MyBets } from './pages/MyBets';
import { Leaderboard } from './pages/Leaderboard';
import { Rules } from './pages/Rules';
import { AuditLog } from './pages/AuditLog';
import { useAuthStore } from './store/authStore';
import { useTournamentStore } from './store/tournamentStore';
import { useBetsStore } from './store/betsStore';
import { usePhaseSettingsStore } from './store/phaseSettingsStore';
import { supabase, isSupabaseConfigured, drainOutbox, wakeUpSupabase } from './lib/supabase';
import { useBolaoSync, isSyncStale, markSyncDone } from './hooks/useBolaoSync';
import { useBolaoRealtime } from './hooks/useBolaoRealtime';
import { useSessionToast } from './hooks/useSessionToast';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const profile = useAuthStore(s => s.profile);
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  // Seletores granulares: assinar só o que cada effect/render usa.
  const profile                  = useAuthStore(s => s.profile);
  const sessionChecked           = useAuthStore(s => s.sessionChecked);
  const initAuth                 = useAuthStore(s => s.initAuth);
  const checkConnectionOrLogout  = useAuthStore(s => s.checkConnectionOrLogout);
  const verifySessionOwnership   = useAuthStore(s => s.verifySessionOwnership);
  const sessionExpiredMessage    = useAuthStore(s => s.sessionExpiredMessage);
  const clearSessionMessage      = useAuthStore(s => s.clearSessionExpiredMessage);
  const syncFromSupabase         = useTournamentStore(s => s.syncFromSupabase);
  const fetchAllBets             = useBetsStore(s => s.fetchAllBets);
  const syncPhaseSettings        = usePhaseSettingsStore(s => s.syncPhaseSettings);

  // Auto-dismiss do toast de sessão expirada após 6 s
  useSessionToast(sessionExpiredMessage, clearSessionMessage);

  // Canal Realtime resiliente (backoff + circuit breaker).
  // Retorna função estável para forçar checagem/reconexão do canal.
  const reconnectRealtime = useBolaoRealtime(profile);

  // Sincronização inicial após sessionChecked (drainOutbox + sync* em paralelo).
  useBolaoSync(sessionChecked, profile);

  // Inicialização da sessão: apenas dispara initAuth.
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync quando o usuário volta ao app (visibilitychange).
  // Renova JWT + verifica se o cache expirou antes de re-buscar os dados.
  useEffect(() => {
    if (!profile) return;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;

      // 1. Verifica/renova sessão; se refresh token expirou, faz logout + toast.
      const sessionOk = await checkConnectionOrLogout();
      if (!sessionOk) return;

      // 2. Cache expirado (> 1h): descarta bets locais não-pendentes antes de re-buscar.
      if (isSyncStale(profile.id)) {
        console.log('[sync] cache expirado (> 1h) — descartando bets locais antes do re-sync');
        useBetsStore.setState(state => ({
          bets: Object.fromEntries(
            Object.entries(state.bets).filter(([, bet]) => bet.pendingPersist)
          ),
        }));
      }

      // 3. Verifica canal Realtime imediatamente em vez de esperar próximo tick.
      reconnectRealtime();

      // 4. Wake-up cobre hibernação do free tier durante background.
      await wakeUpSupabase();

      // 4b. Verifica sessão única — se outro device fez login, sai sem sincronizar.
      await verifySessionOwnership();
      if (!useAuthStore.getState().profile) return;

      // 5. Drena outbox e re-sincroniza tudo.
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

  // Re-drena outbox quando rede volta (offline → online sem trocar de aba).
  useEffect(() => {
    const onOnline = () => { drainOutbox(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Drena outbox no foco da janela — cobre combinações browser/OS onde
  // window.focus dispara sem visibilitychange. NÃO chama checkConnectionOrLogout
  // para evitar duplo-refresh com o handler de visibilitychange.
  useEffect(() => {
    if (!profile) return;
    const onFocus = () => { drainOutbox(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [profile?.id]);

  // Keepalive a cada 4 min — TODAS as tarefas periódicas de background rodam
  // num único timer mestre. Responsabilidades nesta ordem:
  //   1) wakeUpSupabase()      — mantém o free tier acordado (evita cold start)
  //   2) refreshSession()      — renova JWT proativamente para abas eternamente abertas
  //   3) verifySessionOwnership() — single-device login enforcement
  //   4) reconnectRealtime()   — checa canal e reconecta se caiu silenciosamente
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
      verifySessionOwnership();
      reconnectRealtime();
    }, 4 * 60 * 1000);
    return () => clearInterval(keepalive);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Splash apenas se não há profile cacheado no localStorage.
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
          <Route path="/auditoria"     element={<RequireAuth><AuditLog /></RequireAuth>} />
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
