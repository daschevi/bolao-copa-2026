import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Groups } from './pages/Groups';
import { Knockout } from './pages/Knockout';
import { MyBets } from './pages/MyBets';
import { Leaderboard } from './pages/Leaderboard';
import { useAuthStore } from './store/authStore';
import { useTournamentStore } from './store/tournamentStore';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore();
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { profile } = useAuthStore();
  const { syncFromSupabase } = useTournamentStore();

  useEffect(() => {
    syncFromSupabase();
  }, []);

  return (
    <BrowserRouter basename="/bolao-copa-2026">
      {profile && <Navbar />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route path="/grupos" element={<RequireAuth><Groups /></RequireAuth>} />
        <Route path="/chaveamento" element={<RequireAuth><Knockout /></RequireAuth>} />
        <Route path="/meus-palpites" element={<RequireAuth><MyBets /></RequireAuth>} />
        <Route path="/classificacao" element={<RequireAuth><Leaderboard /></RequireAuth>} />
        <Route path="*" element={<Navigate to={profile ? '/grupos' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
