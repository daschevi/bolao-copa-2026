import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { supabase, isSupabaseConfigured, sq } from '../lib/supabase';
import type { Profile, LeaderboardEntry } from '../types/index';

export function Leaderboard() {
  const { profile } = useAuthStore();
  const { getLeaderboard, fetchAllBets } = useBetsStore();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);   // falso por padrão — mostra cache na hora
  const [refreshing, setRefreshing] = useState(false); // spinner discreto no botão
  const mountedRef = useRef(true);

  const PROFILES_CACHE = 'bolao-profiles-cache';

  /** Computa o ranking com o que já está em memória (sem nenhuma query). */
  const computeFromCache = useCallback(() => {
    let profiles: Profile[] = [];
    try {
      const cached = localStorage.getItem(PROFILES_CACHE);
      if (cached) profiles = JSON.parse(cached);
    } catch { /* ignore */ }
    if (!profiles.length && profile) profiles = [profile];
    return getLeaderboard(profiles);
  }, [profile, getLeaderboard]);

  /** Busca dados frescos em background e atualiza silenciosamente. */
  const refresh = useCallback(async (showFullLoader = false) => {
    if (!mountedRef.current) return;
    if (showFullLoader) setLoading(true);
    else setRefreshing(true);

    try {
      // Dispara as duas queries em paralelo — não sequencialmente
      const [, profilesResult] = await Promise.all([
        fetchAllBets(),
        isSupabaseConfigured
          ? sq(supabase.from('profiles').select('*'), 8000)
          : Promise.resolve({ data: null }),
      ]);

      if (!mountedRef.current) return;

      let profiles: Profile[] = [];
      if (profilesResult.data?.length) {
        profiles = (profilesResult.data as Record<string, unknown>[]).map(r => ({
          id:        r.id        as string,
          username:  r.username  as string,
          isAdmin:   (r.is_admin as boolean) ?? false,
          createdAt: r.created_at as string,
        }));
        try { localStorage.setItem(PROFILES_CACHE, JSON.stringify(profiles)); } catch { /* ignore */ }
      }

      // Fallback: cache local
      if (!profiles.length) {
        try {
          const cached = localStorage.getItem(PROFILES_CACHE);
          if (cached) profiles = JSON.parse(cached);
        } catch { /* ignore */ }
      }
      if (!profiles.length && profile) profiles = [profile];

      if (mountedRef.current) setEntries(getLeaderboard(profiles));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [fetchAllBets, profile, getLeaderboard]);

  useEffect(() => {
    mountedRef.current = true;

    // 1. Mostra cache imediatamente (zero espera)
    const cached = computeFromCache();
    if (cached.length > 0) {
      setEntries(cached);
      // Atualiza em background sem mostrar loading
      refresh(false);
    } else {
      // Sem cache: mostra spinner e espera
      refresh(true);
    }

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
                      {e.profile.isAdmin && (
                        <span className="text-copa-green text-xs">★</span>
                      )}
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
