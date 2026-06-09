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
import { supabase, isSupabaseConfigured, drainOutbox, wakeUpSupabase, getOutboxSize } from './lib/supabase';
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
  const fetchMyBets              = useBetsStore(s => s.fetchMyBets);
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
        fetchMyBets(profile.id),
        syncPhaseSettings(),
      ]);
      markSyncDone(profile.id);
    };
    // `pageshow` é equivalente a `visibilitychange` para o caso de "voltar
    // do bfcache" do navegador. No Chrome Android, em certas situações
    // (voltar de outra aba, restaurar app do background, navegar com botão
    // "voltar"), apenas `pageshow` dispara — e sem ele o token continua
    // stale e o próximo palpite cai em RLS-block silencioso.
    // O handler `onVisible` checa `document.visibilityState === 'visible'`
    // internamente, então é seguro escutar nos dois eventos.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-drena outbox quando rede volta (offline → online sem trocar de aba).
  useEffect(() => {
    const onOnline = () => { drainOutbox(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Drain proativo: a cada 30s, se há ops pendentes na outbox, tenta drenar
  // E em seguida ressincroniza para limpar `pendingPersist` no estado local.
  //
  // Por que é necessário (e por que o sync depois do drain é crítico):
  //
  // O flag `pendingPersist=true` que renderiza "⟳ sincronizando…" só é
  // limpo em dois caminhos:
  //   (a) `onSuccess` da chamada original do `persistOp` (closure do saveBet)
  //   (b) `fetchAllBets` faz merge e vê que o BD bate com o local pendente
  //
  // Quando o `drainOutbox` sucede em enviar uma op (porque o persistOp
  // original falhou em retries), (a) NÃO dispara — a closure foi perdida.
  // Sem (b), o flag fica preso pra sempre. Por isso, sempre que drenar
  // algo com sucesso, disparamos `fetchAllBets`/`syncFromSupabase` para
  // que o merge limpe os flags.
  //
  // Custos:
  //   - `getOutboxSize()`: O(1), uma leitura de localStorage + parse.
  //   - Sem ops pendentes: custo zero.
  //   - Em background, o browser pausa o timer (não consome bateria).
  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;
    const id = setInterval(async () => {
      if (getOutboxSize() === 0) return;
      console.log('[outbox-watcher] ops pendentes detectadas — drenando e ressincronizando');
      await drainOutbox();
      // Ressincroniza para limpar `pendingPersist` dos itens que subiram via drain
      // (cujo `onSuccess` do persistOp original já era closure morta).
      await Promise.allSettled([fetchMyBets(profile.id), syncFromSupabase()]);
    }, 30_000);
    return () => clearInterval(id);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
