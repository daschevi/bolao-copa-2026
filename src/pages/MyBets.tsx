import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { usePageSync } from '../hooks/usePageSync';
import { TEAMS_BY_ID } from '../data/teams';
import { Flag } from '../components/Flag';
import { calcPoints } from '../types';

export function MyBets() {
  usePageSync();
  const profile     = useAuthStore(s => s.profile);
  const getUserBets = useBetsStore(s => s.getUserBets);
  const matches     = useTournamentStore(s => s.matches);

  const userBets = useMemo(() => profile ? getUserBets(profile.id) : [], [profile, getUserBets]);

  const stats = useMemo(() => {
    let total = 0, exact = 0, correct = 0;
    userBets.forEach(b => {
      const m = matches[b.matchId];
      if (!m?.played) return;
      const pts = calcPoints(b, m);
      total += pts;
      if (pts === 3) exact++;
      if (pts >= 1) correct++;
    });
    return { total, exact, correct };
  }, [userBets, matches]);

  if (!profile) return <div className="text-center py-20 text-gray-400">Faça login para ver seus palpites.</div>;

  // Palpites pendentes: jogo ainda não encerrado E com os dois times definidos.
  // Jogos TBD (homeTeamId ou awayTeamId nulo) são excluídos — o usuário não tem
  // controle sobre eles e exibi-los como "pendentes" é confuso.
  const pending = userBets
    .filter(b => {
      const m = matches[b.matchId];
      return m && !m.played && !!m.homeTeamId && !!m.awayTeamId;
    })
    // Ordena por data/hora do jogo (mais cedo primeiro) — facilita o
    // acompanhamento dos próximos jogos. A chave `YYYY-MM-DDTHH:MM` é
    // comparável lexicograficamente em ordem cronológica.
    .sort((a, b) => {
      const ma = matches[a.matchId];
      const mb = matches[b.matchId];
      const ka = `${ma?.date ?? ''}T${ma?.time ?? ''}`;
      const kb = `${mb?.date ?? ''}T${mb?.time ?? ''}`;
      return ka.localeCompare(kb);
    });
  const finished = userBets
    .filter(b => matches[b.matchId]?.played)
    // Mesma ordenação cronológica dos pendentes (mais cedo primeiro).
    .sort((a, b) => {
      const ma = matches[a.matchId];
      const mb = matches[b.matchId];
      const ka = `${ma?.date ?? ''}T${ma?.time ?? ''}`;
      const kb = `${mb?.date ?? ''}T${mb?.time ?? ''}`;
      return ka.localeCompare(kb);
    });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-4">Meus Palpites</h1>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Pontos', value: stats.total, color: 'text-copa-green' },
          { label: 'Placar Exato', value: stats.exact, color: 'text-copa-gold' },
          { label: 'Acertos', value: stats.correct, color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {userBets.length === 0 && (
        <div className="card text-center text-gray-400 py-8">Você ainda não fez nenhum palpite. Acesse a aba Grupos para começar!</div>
      )}

      {finished.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Jogos Encerrados</h2>
          <div className="space-y-2">
            {finished.map(b => {
              const m = matches[b.matchId];
              const homeTeam = m.homeTeamId ? TEAMS_BY_ID[m.homeTeamId] : null;
              const awayTeam = m.awayTeamId ? TEAMS_BY_ID[m.awayTeamId] : null;
              const pts = calcPoints(b, m);
              const ptsColor = pts === 3 ? 'text-purple-400 bg-purple-900/30' : pts === 1 ? 'text-yellow-400 bg-yellow-900/30' : 'text-red-400 bg-red-900/30';
              return (
                <div key={b.matchId} className="card flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {homeTeam && <Flag code={homeTeam.code} name={homeTeam.name} size="sm" />}
                    <span className="text-xs text-gray-300 truncate">{homeTeam?.name ?? 'TBD'}</span>
                    <span className="font-bold text-white text-sm shrink-0 whitespace-nowrap">{m.homeScore}–{m.awayScore}</span>
                    <span className="text-xs text-gray-300 truncate">{awayTeam?.name ?? 'TBD'}</span>
                    {awayTeam && <Flag code={awayTeam.code} name={awayTeam.name} size="sm" />}
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">
                    Pal: {b.homeScore}×{b.awayScore}
                  </div>
                  <div className={`text-sm font-bold px-2 py-0.5 rounded ${ptsColor} shrink-0`}>
                    +{pts}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Palpites Pendentes ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map(b => {
              const m = matches[b.matchId];
              const homeTeam = m.homeTeamId ? TEAMS_BY_ID[m.homeTeamId] : null;
              const awayTeam = m.awayTeamId ? TEAMS_BY_ID[m.awayTeamId] : null;
              return (
                <div key={b.matchId} className="card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {homeTeam && <Flag code={homeTeam.code} name={homeTeam.name} size="sm" />}
                      <span className="text-xs text-gray-300 truncate">{homeTeam?.name ?? 'TBD'}</span>
                      <span className="text-gray-500 text-sm shrink-0">vs</span>
                      <span className="text-xs text-gray-300 truncate">{awayTeam?.name ?? 'TBD'}</span>
                      {awayTeam && <Flag code={awayTeam.code} name={awayTeam.name} size="sm" />}
                    </div>
                    <div className="text-sm font-medium text-copa-green shrink-0 whitespace-nowrap">{b.homeScore}×{b.awayScore}</div>
                  </div>
                  {/* Palpite que falhou em subir ao servidor — orienta reenvio.
                      O botão de reenvio em um toque fica no card da aba Grupos/Chaveamento. */}
                  {b.persistFailed && (
                    <div className="text-[11px] mt-1.5 font-semibold" style={{ color: '#f59e0b' }}>
                      ⚠️ Este palpite não foi salvo no servidor. Reabra o jogo na aba Grupos/Chaveamento e toque em reenviar.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
