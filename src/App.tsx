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

  // Inicialização: dispara o initAuth e drena qualquer op pendente da outbox
  // (escritas que ficaram presas da sessão anterior). NÃO sincroniza matches
  // aqui — isso espera o auth resolver (próximo effect) para evitar correr o
  // sync antes da sessão estar pronta.
  useEffect(() => {
    drainOutbox();
    const cleanup = initAuth();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Após sessão verificada: sincroniza tudo.
  // Roda mesmo sem profile (matches são dados públicos), mas só depois do
  // sessionChecked para garantir que initAuth já terminou — evita correr a
  // sync em paralelo com a verificação de sessão, o que misturava ordem de
  // chamadas e dificultava debug.
  useEffect(() => {
    if (!sessionChecked) return;
    syncFromSupabase();
    if (profile) {
      fetchAllBets();
      syncPhaseSettings();
    }
    // Segundo sync após 15s — cobre cold start do Supabase free tier
    const retryTimer = setTimeout(() => {
      syncFromSupabase();
      if (profile) {
        fetchAllBets();
        syncPhaseSettings();
      }
    }, 15000);
    return () => clearTimeout(retryTimer);
  }, [sessionChecked, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync quando o usuário volta ao app (minimizou, trocou de aba, desbloqueou).
  // Drena outbox primeiro — se a aba estava em background com palpites pendentes,
  // ela acorda e re-tenta antes de qualquer leitura, garantindo que o fetch
  // seguinte já enxergue os dados que acabaram de subir.
  useEffect(() => {
    if (!profile) return;
    const onVisible = async () => {
      if (document.visibilityState === 'visible') {
        await drainOutbox();
        syncFromSupabase();
        fetchAllBets();
        syncPhaseSettings();
      }
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

  // Supabase Realtime: propaga mudanças em tempo real para todos os browsers
  // Requer: no painel Supabase → Database → Replication → adicionar match_results e bets
  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;

    const channel = supabase
      .channel('bolao-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'match_results' },
        () => { syncFromSupabase(); }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bets' },
        () => { fetchAllBets(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
