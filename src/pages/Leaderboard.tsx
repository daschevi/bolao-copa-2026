import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { supabase, isSupabaseConfigured, sq } from '../lib/supabase';
import type { Profile } from '../types/index';

const PROFILES_CACHE = 'bolao-profiles-cache';

/**
 * Busca todos os perfis do servidor com retry (até 3 tentativas, backoff).
 * Em caso de falha total, retorna o cache local (se existir).
 *
 * Extraída do componente para poder ser reutilizada sem depender de hooks —
 * é chamada tanto no mount quanto no botão de atualizar.
 */
async function fetchProfiles(): Promise<Profile[]> {
  if (!isSupabaseConfigured) return [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await sq(
      () => supabase.from('profiles').select('*'),
      attempt === 1 ? 8000 : 14000,
    );
    if (!error && data?.length) {
      const profiles = (data as Record<string, unknown>[]).map(r => ({
        id:        r.id        as string,
        username:  r.username  as string,
        isAdmin:   (r.is_admin as boolean) ?? false,
        createdAt: r.created_at as string,
      }));
      try { localStorage.setItem(PROFILES_CACHE, JSON.stringify(profiles)); } catch { /* ignore */ }
      return profiles;
    }
    console.warn(`[leaderboard] profiles tentativa ${attempt}/3:`, error?.message);
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
  }

  // Fallback: cache local
  try {
    const cached = localStorage.getItem(PROFILES_CACHE);
    if (cached) return JSON.parse(cached) as Profile[];
  } catch { /* ignore */ }
  return [];
}

export function Leaderboard() {
  const { profile } = useAuthStore();

  // Assina o objeto `bets` do store de forma reativa: qualquer atualização
  // (App.tsx via sessionChecked, Realtime, visibilitychange) causa re-render
  // automático e re-cálculo do leaderboard — sem precisar de botão manual.
  const bets        = useBetsStore(s => s.bets);
  const getLeaderboard = useBetsStore(s => s.getLeaderboard);
  const fetchAllBets   = useBetsStore(s => s.fetchAllBets);

  // Perfis carregados do servidor (fonte de verdade para a lista de participantes).
  // Lazy init com cache local para exibição imediata enquanto o fetch corre.
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    try {
      const cached = localStorage.getItem(PROFILES_CACHE);
      if (cached) return JSON.parse(cached) as Profile[];
    } catch { /* ignore */ }
    return [];
  });

  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  /**
   * Leaderboard reativo: recalcula automaticamente quando:
   *   - `bets` muda (fetchAllBets, Realtime, visibilitychange)
   *   - `profiles` muda (fetch no mount ou botão de atualizar)
   *
   * Fallback de profiles: mostra só o usuário logado enquanto os perfis
   * carregam (nunca mostra lista vazia desnecessariamente).
   */
  const entries = useMemo(
    () => {
      const p = profiles.length ? profiles : (profile ? [profile] : []);
      return getLeaderboard(p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bets, profiles, getLeaderboard],
  );

  /** Busca dados frescos — bets em paralelo com profiles para máxima velocidade. */
  const refresh = useCallback(async (showFullLoader = false) => {
    if (!mountedRef.current) return;
    if (showFullLoader) setLoading(true);
    else setRefreshing(true);

    try {
      const [profilesResult] = await Promise.allSettled([
        fetchProfiles(),
        fetchAllBets(), // atualiza o store — entries recalcula via useMemo
      ]);

      if (!mountedRef.current) return;

      if (profilesResult.status === 'fulfilled' && profilesResult.value.length) {
        setProfiles(profilesResult.value);
      }
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [fetchAllBets]);

  useEffect(() => {
    mountedRef.current = true;
    // Sem cache de profiles → mostra loader enquanto busca todos os participantes.
    // Com cache → exibe imediatamente e atualiza em background (silent refresh).
    const showFullLoader = profiles.length === 0;
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
          style={{ color: '#22C55E', border: '1px solid #22C55E40', background: '#22C55E10' }}
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
                  background: isMe ? '#22C55E0D' : '#111111',
                  border: `1px solid ${isMe ? '#22C55E40' : '#1F1F1F'}`,
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
                      background: isMe ? '#22C55E20' : '#1A1A1A',
                      color: isMe ? '#22C55E' : '#6B7280',
                      border: `1px solid ${isMe ? '#22C55E40' : '#2A2A2A'}`,
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
                          style={{ background: '#22C55E20', color: '#22C55E' }}
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
                    style={{ color: '#22C55E', fontStyle: 'italic' }}
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
