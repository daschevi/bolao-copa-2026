import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { drainOutbox, ensureServerWarm } from '../lib/supabase';
import { ScoreBreakdownModal } from '../components/ScoreBreakdownModal';
import type { LeaderboardEntry } from '../types/index';

/**
 * Iniciais do nome: primeira letra do primeiro nome + primeira do último.
 * Ex.: "Gabriel Daschevi" → "GD", "Carla Quevedo" → "CQ".
 * Nome com uma só palavra → só a inicial; vazio → "?".
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function Leaderboard() {
  const { profile }      = useAuthStore();
  const fetchLeaderboard = useBetsStore(s => s.fetchLeaderboard);
  const syncFromSupabase = useTournamentStore(s => s.syncFromSupabase);

  const [entries,    setEntries]    = useState<LeaderboardEntry[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected,   setSelected]   = useState<LeaderboardEntry | null>(null);
  const mountedRef = useRef(true);

  // Colocação com empate (standard competition ranking: 1, 1, 3, 4, 4, 6…).
  // entries já vem ordenado da RPC (total_points desc, exact_count desc).
  // Empate genuíno = mesma pontuação E mesmo número de exatos (a regra de
  // desempate seguinte é sorteio, não determinístico — ver Rules.tsx).
  const ranked = useMemo(() => {
    let rank = 0;
    return entries.map((e, i) => {
      const prev = entries[i - 1];
      if (i > 0 && prev.totalPoints === e.totalPoints && prev.exactScores === e.exactScores) {
        // herda o rank da entrada anterior (empate)
      } else {
        rank = i + 1; // posição absoluta — faz o próximo "pular" após empate
      }
      return { entry: e, rank };
    });
  }, [entries]);

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

      // Aceita lista vazia LEGÍTIMA (início do bolão / reset) — antes a guarda
      // `&& value.length` mantinha entradas antigas após um reset. Mas distingue
      // de falha: fetchLeaderboard retorna null quando esgota os retries, e aí
      // preservamos as entradas atuais (não apagar a classificação por um blip
      // de rede). value === [] limpa; value === null mantém.
      if (leaderboardResult.status === 'fulfilled' && leaderboardResult.value !== null) {
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

  const medal = (rank: number) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[rank] ?? `${rank}º`);

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
          {ranked.map(({ entry: e, rank }) => {
            const isMe = e.profile.id === profile?.id;
            const rankLabel = medal(rank);
            return (
              <button
                key={e.profile.id}
                onClick={() => setSelected(e)}
                className="w-full text-left rounded-xl p-4 flex items-center gap-4 transition-all hover:brightness-125 cursor-pointer"
                style={{
                  background: isMe ? '#8300ff0D' : '#111111',
                  border: `1px solid ${isMe ? '#8300ff40' : '#1F1F1F'}`,
                }}
                title="Ver detalhamento da pontuação"
              >
                {/* Posição — largura acomoda 3 dígitos; a fonte reduz para ranks
                    grandes para o número não invadir o avatar do usuário. */}
                <div className="shrink-0 w-12 flex items-center justify-center leading-none">
                  <span className={
                    rank <= 3 ? 'text-2xl'
                    : rankLabel.length >= 4 ? 'text-base font-bold tabular-nums'
                    : 'text-xl font-bold tabular-nums'
                  }>
                    {rankLabel}
                  </span>
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
                    {initials(e.profile.username)}
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
              </button>
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

      {/* Detalhamento jogo a jogo ao clicar numa linha do ranking */}
      {selected && (
        <ScoreBreakdownModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
