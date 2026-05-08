import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Profile, LeaderboardEntry } from '../types';

export function Leaderboard() {
  const { profile } = useAuthStore();
  const { getLeaderboard, fetchAllBets, bets } = useBetsStore();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchAllBets();

      let profiles: Profile[] = [];
      if (isSupabaseConfigured) {
        const { data } = await supabase.from('profiles').select('*');
        profiles = (data ?? []) as Profile[];
      } else if (profile) {
        profiles = [profile];
      }

      setEntries(getLeaderboard(profiles));
      setLoading(false);
    };
    load();
  }, [bets]);

  const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}º`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-6">🏆 Classificação Geral</h1>

      {!isSupabaseConfigured && (
        <div className="card mb-4 border-yellow-700 bg-yellow-900/20">
          <p className="text-yellow-400 text-sm">Modo offline: a classificação mostra apenas seus próprios palpites. Configure o Supabase para ver todos os participantes.</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">Carregando...</div>
      ) : entries.length === 0 ? (
        <div className="card text-center text-gray-400 py-8">Nenhum palpite registrado ainda.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((e, i) => {
            const isMe = e.profile.id === profile?.id;
            return (
              <div key={e.profile.id} className={`card flex items-center gap-4 ${isMe ? 'border-copa-gold' : ''}`}>
                <div className="text-2xl w-8 text-center shrink-0">{medal(i)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white flex items-center gap-1">
                    {e.profile.isAdmin && <span className="text-copa-gold text-xs">★</span>}
                    {e.profile.username}
                    {isMe && <span className="text-xs text-copa-gold ml-1">(você)</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {e.totalBets} palpites · {e.exactScores} exatos · {e.correctResults} acertos
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-copa-gold">{e.totalPoints}</div>
                  <div className="text-xs text-gray-500">pts</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
