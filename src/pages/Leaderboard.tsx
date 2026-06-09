import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { drainOutbox, ensureServerWarm } from '../lib/supabase';
import type { LeaderboardEntry } from '../types/index';

export function Leaderboard() {
  const { profile }      = useAuthStore();
  const fetchLeaderboard = useBetsStore(s => s.fetchLeaderboard);
  const syncFromSupabase = useTournamentStore(s => s.syncFromSupabase);

  const [entries,    setEntries]    = useState<LeaderboardEntry[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  /**
   * Busca dados frescos via RPC get_leaderboard() — servidor agrega tudo,
   * devolve apenas N linhas (uma por usuário) em vez de N×72 linhas brutas.
   */
  const refresh = useCallback(async (showFullLoader = false) => {
    if (!mountedRef.current) return;
    if (showFullLoader) setLoading(true);
    else setRefreshing(true);

    try {
      // Acorda servidor se necessário (throttled: só pinga se > 60s inativo)
      await ensureServerWarm();
      if (!mountedRef.current) return;

      // Drena outbox antes de buscar — garante que palpites pendentes subam
      // ao banco antes de calcular a classificação, evitando discrepâncias.
      await drainOutbox();
      if (!mountedRef.current) return;

      // Busca leaderboard e resultados em paralelo
      const [leaderboardResult] = await Promise.allSettled([
        fetchLeaderboard(),
        syncFromSupabase(),   // mantém resultados de jogos sincronizados
      ]);

      if (!mountedRef.current) return;

      if (leaderboardResult.status === 'fulfilled' && leaderboardResult.value.length) {
        setEntries(leaderboardResult.value);
      }
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [fetchLeaderboard, syncFromSupabase]);

  useEffect(() => {
    mountedRef.current = true;
    // Sem entradas no state → mostra loader completo na primeira carga.
    const showFullLoader = entries.length === 0;
    queueMicrotask(() => { if (mountedRef.current) refresh(showFullLoader); });
    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}º`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1
          className="text-2xl font-black text-white uppercase"
          style={{ fontStyle: 'italic' }}
        >
          Classificação 🏆
        </h1>
        <button
          onClick={() => refresh(false)}
          disabled={loading || refreshing}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
          style={{ color: '#8300ff', border: '1px solid #8300ff40', background: '#8300ff10' }}
        >
          {refreshing ? 'Atualizando...' : loading ? 'Carregando...' : '↻ Atualizar'}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-3xl animate-bounce">⚽</div>
          <p className="text-sm" style={{ color: '#4B5563' }}>Carregando classificação...</p>
        </div>
      ) : entries.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: '#111111', border: '1px solid #1F1F1F' }}
        >
          <div className="text-3xl mb-2">🎯</div>
          <p style={{ color: '#4B5563' }} className="text-sm">Nenhum palpite registrado ainda.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => {
            const isMe = e.profile.id === profile?.id;
            return (
              <div
                key={e.profile.id}
                className="rounded-xl p-4 flex items-center gap-4 transition-all"
                style={{
                  background: isMe ? '#8300ff0D' : '#111111',
                  border: `1px solid ${isMe ? '#8300ff40' : '#1F1F1F'}`,
                }}
              >
                {/* Posição */}
                <div className="text-2xl w-8 text-center shrink-0 leading-none">
                  {medal(i)}
                </div>

                {/* Avatar + info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{
                      background: isMe ? '#8300ff20' : '#1A1A1A',
                      color: isMe ? '#8300ff' : '#6B7280',
                      border: `1px solid ${isMe ? '#8300ff40' : '#2A2A2A'}`,
                    }}
                  >
                    {e.profile.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-white flex items-center gap-1 text-sm flex-wrap">
                      <span className="truncate">{e.profile.username}</span>
                      {isMe && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                          style={{ background: '#8300ff20', color: '#8300ff' }}
                        >
                          você
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5 flex gap-2 flex-wrap" style={{ color: '#4B5563' }}>
                      <span>{e.totalBets} palpites</span>
                      <span>·</span>
                      <span className="text-copa-green">{e.exactScores} exatos</span>
                      <span>·</span>
                      <span>{e.correctResults} acertos</span>
                    </div>
                  </div>
                </div>

                {/* Pontos */}
                <div className="text-right shrink-0">
                  <div
                    className="text-2xl font-black"
                    style={{ color: '#8300ff', fontStyle: 'italic' }}
                  >
                    {e.totalPoints}
                  </div>
                  <div className="text-xs" style={{ color: '#4B5563' }}>pts</div>
                </div>
              </div>
            );
          })}

          {/* Indicador sutil de atualização em background */}
          {refreshing && (
            <div className="text-center py-2 text-xs" style={{ color: '#374151' }}>
              atualizando...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
