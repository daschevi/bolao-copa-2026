import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, sq, persistOp } from '../lib/supabase';
import type { Bet, LeaderboardEntry, Profile } from '../types';
import { calcPoints } from '../types';
import { useTournamentStore } from './tournamentStore';
import { useAuthStore } from './authStore';

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
        // Marca pendingPersist=true até o BD confirmar — o merge do
        // fetchAllBets preserva esta entrada em vez de sobrescrever com a
        // versão antiga do BD (que ainda não a tem).
        const bet: Bet = { userId, matchId, homeScore, awayScore, points, pendingPersist: true };

        // 1. Salva localmente (imediato — UI não trava)
        set(state => ({ bets: { ...state.bets, [key]: bet } }));

        // 2. Persiste no Supabase via outbox (durável a fechamento de aba)
        // Não enviamos 'points' — é sempre recalculado ao vivo via calcPoints()
        // para evitar inconsistências quando o admin reseta/corrige resultados.
        if (isSupabaseConfigured) {
          persistOp(
            {
              kind: 'upsert',
              table: 'bets',
              payload: { user_id: userId, match_id: matchId, home_score: homeScore, away_score: awayScore },
              onConflict: 'user_id,match_id',
              label: `saveBet:${matchId}`,
            },
            {
              onSuccess: () => {
                set(state => {
                  const existing = state.bets[key];
                  // Só limpa o flag se a entrada ainda corresponde ao que
                  // salvamos (usuário pode ter editado o palpite enquanto a
                  // primeira escrita estava em voo).
                  if (!existing || existing.homeScore !== homeScore || existing.awayScore !== awayScore) {
                    return state;
                  }
                  return { bets: { ...state.bets, [key]: { ...existing, pendingPersist: false } } };
                });
              },
            }
          );
        } else {
          // Sem Supabase: marca como persistido localmente (não há servidor para confirmar)
          set(state => ({ bets: { ...state.bets, [key]: { ...bet, pendingPersist: false } } }));
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
          const { data, error } = await sq(() => supabase.from('bets').select('*'), timeoutMs);

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
          const currentUserId = useAuthStore.getState().profile?.id;

          // Merge: banco sobrescreve chaves conhecidas EXCETO quando há uma
          // escrita local ainda pendente (pendingPersist=true). Bets locais
          // ausentes no banco também são preservadas se pendentes.
          set(state => {
            const merged: Record<string, Bet> = { ...state.bets };
            Object.entries(dbBets).forEach(([key, dbBet]) => {
              const localBet = merged[key];
              if (localBet?.pendingPersist) {
                // BD já chegou ao mesmo estado → não há mais pendência, libera o flag
                if (localBet.homeScore === dbBet.homeScore &&
                    localBet.awayScore === dbBet.awayScore) {
                  merged[key] = { ...localBet, pendingPersist: false };
                }
                // scores diferentes = usuário editou enquanto o save estava em voo,
                // preserva versão local (será re-enviada pelo persistOp original)
                return;
              }
              merged[key] = dbBet;
            });

            // Remove bets locais ausentes no BD que não estão pendentes de sync.
            // BD é fonte da verdade para dados confirmados — se uma bet foi
            // deletada externamente (ex: admin limpou a tabela), ela deve
            // desaparecer do estado local. Preservamos apenas bets com
            // pendingPersist=true (escrita ainda em voo, não confirmada pelo BD).
            Object.keys(merged).forEach(key => {
              if (!dbBets[key] && !merged[key].pendingPersist) {
                delete merged[key];
              }
            });

            return { bets: merged };
          });

          // Reconciliação: re-envia ao banco bets locais do usuário atual que
          // ainda estão pendentes (pendingPersist=true) e não chegaram ao BD.
          // Filtra por pendingPersist para não re-enviar bets que foram
          // deletados externamente — esses já foram removidos do merged acima.
          Object.entries(localBets).forEach(([key, bet]) => {
            if (bet.userId !== currentUserId) return; // ignora bets de outro usuário
            if (!dbBets[key] && bet.pendingPersist && bet.userId && bet.matchId) {
              console.log(`[betsStore] reconciliando bet pendente: ${key}`);
              persistOp({
                kind: 'upsert',
                table: 'bets',
                payload: { user_id: bet.userId, match_id: bet.matchId, home_score: bet.homeScore, away_score: bet.awayScore },
                onConflict: 'user_id,match_id',
                label: `reconcile:${key}`,
              });
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
