import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, sq, bgPersist } from '../lib/supabase';
import type { Bet, LeaderboardEntry, Profile } from '../types';
import { calcPoints } from '../types';
import { useTournamentStore } from './tournamentStore';

interface BetsState {
  bets: Record<string, Bet>; // key: `${userId}-${matchId}`
  saveBet: (userId: string, matchId: string, homeScore: number, awayScore: number) => { error: string | null };
  getUserBets: (userId: string) => Bet[];
  getBet: (userId: string, matchId: string) => Bet | undefined;
  getUserPoints: (userId: string) => { total: number; exact: number; correct: number; totalBets: number };
  fetchAllBets: () => Promise<void>;
  getLeaderboard: (profiles: Profile[]) => LeaderboardEntry[];
}

export const useBetsStore = create<BetsState>()(
  persist(
    (set, get) => ({
      bets: {},

      saveBet: (userId, matchId, homeScore, awayScore) => {
        const key = `${userId}-${matchId}`;
        const match = useTournamentStore.getState().matches[matchId];
        const points = match?.played ? calcPoints({ homeScore, awayScore }, match) : null;
        const bet: Bet = { userId, matchId, homeScore, awayScore, points };

        // 1. Salva localmente (imediato — UI não trava)
        set(state => ({ bets: { ...state.bets, [key]: bet } }));

        // 2. Persiste no Supabase em background com retry automático
        // Não enviamos 'points' — é sempre recalculado ao vivo via calcPoints()
        // para evitar inconsistências quando o admin reseta/corrige resultados.
        if (isSupabaseConfigured) {
          bgPersist(
            () => supabase.from('bets').upsert(
              { user_id: userId, match_id: matchId, home_score: homeScore, away_score: awayScore },
              { onConflict: 'user_id,match_id' }
            ),
            { label: `saveBet:${matchId}` }
          );
        }

        return { error: null };
      },

      getUserBets: (userId) => Object.values(get().bets).filter(b => b.userId === userId),

      getBet: (userId, matchId) => get().bets[`${userId}-${matchId}`],

      getUserPoints: (userId) => {
        const userBets = get().getUserBets(userId);
        const matches = useTournamentStore.getState().matches;
        let total = 0, exact = 0, correct = 0, totalBets = 0;
        userBets.forEach(b => {
          totalBets++;
          const m = matches[b.matchId];
          if (!m?.played) return;
          const pts = calcPoints(b, m);
          total += pts;
          if (pts === 3) exact++;
          if (pts >= 1) correct++;
        });
        return { total, exact, correct, totalBets };
      },

      fetchAllBets: async () => {
        if (!isSupabaseConfigured) return;

        // Retry até 3× com backoff — cobre cold start do Supabase free tier
        for (let attempt = 1; attempt <= 3; attempt++) {
          const timeoutMs = attempt === 1 ? 8000 : 14000;
          const { data, error } = await sq(supabase.from('bets').select('*'), timeoutMs);

          if (error) {
            console.warn(`[betsStore] fetchAllBets tentativa ${attempt}/3:`, error.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }

          // Monta mapa com o que veio do banco
          const dbBets: Record<string, Bet> = {};
          (data ?? []).forEach((b: {
            user_id: string;
            match_id: string;
            home_score: number;
            away_score: number;
            points: number | null;
          }) => {
            dbBets[`${b.user_id}-${b.match_id}`] = {
              userId:    b.user_id,
              matchId:   b.match_id,
              homeScore: b.home_score,
              awayScore: b.away_score,
              points:    b.points,
            };
          });

          // Captura bets locais antes do merge (para reconciliação)
          const localBets = get().bets;

          // Merge: banco sobrescreve chaves conhecidas; bets locais ausentes no banco
          // são preservadas (podem ser saves pendentes que ainda não chegaram ao servidor)
          set(state => {
            const merged = { ...state.bets }; // começa com estado local
            Object.assign(merged, dbBets);    // banco tem prioridade para chaves que conhece
            return { bets: merged };
          });

          // Reconciliação: re-envia ao banco qualquer bet local que não está no BD
          // (recupera palpites cujo bgPersist falhou silenciosamente)
          Object.entries(localBets).forEach(([key, bet]) => {
            if (!dbBets[key] && bet.userId && bet.matchId) {
              console.log(`[betsStore] reconciliando bet pendente: ${key}`);
              bgPersist(
                () => supabase.from('bets').upsert(
                  { user_id: bet.userId, match_id: bet.matchId, home_score: bet.homeScore, away_score: bet.awayScore },
                  { onConflict: 'user_id,match_id' }
                ),
                { label: `reconcile:${key}` }
              );
            }
          });

          return; // sucesso — sai do loop
        }

        console.error('[betsStore] fetchAllBets falhou após 3 tentativas');
      },

      getLeaderboard: (profiles) => {
        const { getUserPoints } = get();
        return profiles
          .map(profile => {
            const stats = getUserPoints(profile.id);
            return {
              profile,
              totalPoints:    stats.total,
              exactScores:    stats.exact,
              correctResults: stats.correct,
              totalBets:      stats.totalBets,
            };
          })
          .sort((a, b) => b.totalPoints - a.totalPoints || b.exactScores - a.exactScores);
      },
    }),
    { name: 'bolao-bets', partialize: (s) => ({ bets: s.bets }) }
  )
);
