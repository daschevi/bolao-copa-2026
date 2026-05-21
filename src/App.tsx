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
import { supabase, isSupabaseConfigured } from './lib/supabase';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore();
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { profile, initAuth, sessionChecked } = useAuthStore();
  const { syncFromSupabase } = useTournamentStore();
  const { fetchAllBets } = useBetsStore();
  const { syncPhaseSettings } = usePhaseSettingsStore();

  // Inicializa auth. Mostra splash até a verificação de sessão terminar.
  useEffect(() => {
    syncFromSupabase();
    const cleanup = initAuth();
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Após login: re-sincroniza tudo com auth ativo
  // (cobre browsers novos, localStorage vazio, falha silenciosa de RLS)
  // O sync já tem retry interno (3×), mas disparamos um segundo sync após 15s
  // para garantir que o Supabase acordou do sleep (free tier pode demorar >10s)
  useEffect(() => {
    if (!profile) return;
    syncFromSupabase();
    fetchAllBets();
    syncPhaseSettings();
    const retryTimer = setTimeout(() => {
      syncFromSupabase();
      fetchAllBets();
      syncPhaseSettings();
    }, 15000);
    return () => clearTimeout(retryTimer);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync quando o usuário volta ao app (minimizou, trocou de aba, desbloqueou o celular)
  useEffect(() => {
    if (!profile) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        syncFromSupabase();
        fetchAllBets();
        syncPhaseSettings();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
