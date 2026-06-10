import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, sq, persistOp, hasPendingOutboxOpForBet } from '../lib/supabase';
import type { Bet, LeaderboardEntry } from '../types';
import { calcPoints } from '../types';
import { useTournamentStore } from './tournamentStore';

interface BetsState {
  bets: Record<string, Bet>; // key: `${userId}-${matchId}`
  saveBet: (userId: string, matchId: string, homeScore: number, awayScore: number) => { error: string | null };
  getUserBets: (userId: string) => Bet[];
  getBet: (userId: string, matchId: string) => Bet | undefined;
  getUserPoints: (userId: string) => { total: number; exact: number; correct: number; totalBets: number };
  /**
   * Busca no banco apenas as apostas do usuário atual (WHERE user_id = userId).
   * Usa o índice UNIQUE(user_id, match_id) — leitura O(log n) em vez de O(n).
   * Substitui o antigo fetchAllBets em todos os pontos de sync periódico.
   */
  fetchMyBets: (userId: string) => Promise<void>;
  /**
   * Chama a RPC get_leaderboard() no servidor: devolve N linhas já agregadas
   * (uma por usuário) em vez de N×72 linhas brutas.
   * Usada exclusivamente pela página Leaderboard.tsx.
   *
   * Retorna:
   *   - LeaderboardEntry[] (inclusive vazio) → sucesso; [] é vazio LEGÍTIMO
   *     (início do bolão / reset) e a UI deve refletir.
   *   - null → falha após retries; a UI deve PRESERVAR as entradas atuais
   *     (não apagar a classificação por uma falha de rede transitória).
   */
  fetchLeaderboard: () => Promise<LeaderboardEntry[] | null>;
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
        // fetchMyBets preserva esta entrada em vez de sobrescrever com a
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
        let total = 0, exact = 0, correct = 0;
        userBets.forEach(b => {
          const m = matches[b.matchId];
          // Pontos/exatos/acertos só calculados quando o resultado foi lançado.
          if (!m?.played) return;
          const pts = calcPoints(b, m);
          total += pts;
          if (pts === 3) exact++;
          if (pts >= 1) correct++;
        });
        // totalBets = todos os palpites feitos, independente de o jogo ter
        // sido disputado — aparece na classificação assim que o palpite é salvo.
        return { total, exact, correct, totalBets: userBets.length };
      },

      fetchMyBets: async (userId: string) => {
        if (!isSupabaseConfigured) return;

        // Retry até 3× com backoff — cobre cold start do Supabase free tier
        for (let attempt = 1; attempt <= 3; attempt++) {
          // 15s na 1ª tentativa, 25s nas retentativas — cobre cold start de
          // 5-10s do Supabase free tier após período de inatividade.
          const timeoutMs = attempt === 1 ? 15000 : 25000;
          const { data, error } = await sq(
            () => supabase.from('bets').select('*').eq('user_id', userId),
            timeoutMs,
          );

          if (error) {
            console.warn(`[betsStore] fetchMyBets tentativa ${attempt}/3:`, error.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }

          // Monta mapa com o que veio do banco para este usuário
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

          // Captura bets locais antes do merge (para reconciliação de pending)
          const localBets = get().bets;

          // Merge: banco sobrescreve entradas do usuário EXCETO quando há uma
          // escrita local ainda pendente (pendingPersist=true). Bets locais
          // ausentes no banco também são preservadas se pendentes.
          // Bets de outros usuários são descartadas: o leaderboard usa RPC agora.
          set(state => {
            const merged: Record<string, Bet> = {};

            // 1. Aplica dados do banco para o usuário atual
            Object.entries(dbBets).forEach(([key, dbBet]) => {
              const localBet = state.bets[key];
              if (localBet?.pendingPersist) {
                // BD chegou ao mesmo estado → limpa pendência E qualquer falha
                // anterior (o palpite efetivamente subiu — não mostrar reenvio).
                if (localBet.homeScore === dbBet.homeScore &&
                    localBet.awayScore === dbBet.awayScore) {
                  merged[key] = { ...localBet, pendingPersist: false, persistFailed: false };
                } else {
                  // Usuário editou enquanto o save estava em voo — mantém local
                  // (será re-enviada pelo persistOp original ou pela reconciliação)
                  merged[key] = localBet;
                }
                return;
              }
              // BD é fonte da verdade: a versão confirmada nunca está em falha.
              merged[key] = dbBet;
            });

            // 2. Bets pendentes do usuário ausentes no banco.
            Object.entries(state.bets).forEach(([key, bet]) => {
              if (bet.userId === userId && bet.pendingPersist && !merged[key]) {
                // Auditoria retroativa de órfãs: pendente, ausente no BD e SEM op
                // na outbox → foi descartada num drain anterior (inclusive antes
                // deste deploy, quando o descarte era silencioso). Marca falha
                // para a UI expor o reenvio em vez do spinner eterno.
                if (!hasPendingOutboxOpForBet(bet.userId, bet.matchId)) {
                  merged[key] = { ...bet, pendingPersist: false, persistFailed: true };
                } else {
                  // Ainda há op na outbox → será reconciliada logo abaixo.
                  merged[key] = bet;
                }
              }
            });

            // Nota: bets de outros usuários são intencionalmente descartadas.
            // A classificação usa get_leaderboard() RPC — não precisa do store.

            return { bets: merged };
          });

          // Reconciliação: re-envia ao banco bets locais do usuário que
          // ainda estão pendentes (pendingPersist=true) e não chegaram ao BD.
          Object.entries(localBets).forEach(([key, bet]) => {
            if (bet.userId !== userId) return; // ignora bets de outro usuário
            if (!dbBets[key] && bet.pendingPersist && bet.userId && bet.matchId) {
              console.log(`[betsStore] reconciliando bet pendente: ${key}`);
              // Captura os scores no closure para validar no onSuccess (evita
              // limpar pendingPersist caso o usuário já tenha editado o palpite).
              const reconciledHome = bet.homeScore;
              const reconciledAway = bet.awayScore;
              persistOp(
                {
                  kind: 'upsert',
                  table: 'bets',
                  payload: { user_id: bet.userId, match_id: bet.matchId, home_score: reconciledHome, away_score: reconciledAway },
                  onConflict: 'user_id,match_id',
                  label: `reconcile:${key}`,
                },
                {
                  onSuccess: () => {
                    set(state => {
                      const existing = state.bets[key];
                      // Só limpa se o palpite atual ainda corresponde ao que foi salvo
                      if (!existing?.pendingPersist) return state;
                      if (existing.homeScore !== reconciledHome || existing.awayScore !== reconciledAway) return state;
                      return { bets: { ...state.bets, [key]: { ...existing, pendingPersist: false } } };
                    });
                  },
                }
              );
            }
          });

          return; // sucesso — sai do loop
        }

        console.error('[betsStore] fetchMyBets falhou após 3 tentativas');
      },

      fetchLeaderboard: async (): Promise<LeaderboardEntry[] | null> => {
        if (!isSupabaseConfigured) return [];

        for (let attempt = 1; attempt <= 3; attempt++) {
          const timeoutMs = attempt === 1 ? 10000 : 20000;
          const { data, error } = await sq(
            () => supabase.rpc('get_leaderboard'),
            timeoutMs,
          );

          if (error) {
            console.warn(`[betsStore] fetchLeaderboard tentativa ${attempt}/3:`, error.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }

          return (data ?? []).map((row: {
            user_id:       string;
            username:      string;
            total_points:  number;
            exact_count:   number;
            correct_count: number;
            total_bets:    number;
          }) => ({
            profile: {
              id:        row.user_id,
              username:  row.username,
              isAdmin:   false,
              createdAt: '',
            },
            totalPoints:    Number(row.total_points),
            exactScores:    Number(row.exact_count),
            correctResults: Number(row.correct_count),
            totalBets:      Number(row.total_bets),
          }));
        }

        console.error('[betsStore] fetchLeaderboard falhou após 3 tentativas');
        return null; // falha → caller preserva entradas atuais
      },
    }),
    { name: 'bolao-bets', partialize: (s) => ({ bets: s.bets }) }
  )
);

// Marca bets como persistFailed quando a op correspondente é descartada da
// outbox (MAX_ATTEMPTS / schema / deadline). Sem isso, pendingPersist fica preso
// e a UI mostra "sincronizando…" para um palpite que nunca chegará ao servidor.
if (typeof window !== 'undefined') {
  window.addEventListener('outbox:op-discarded', (e: Event) => {
    const op = (e as CustomEvent).detail;
    if (op?.table !== 'bets' || op?.kind !== 'upsert') return;
    const key = `${op.payload.user_id}-${op.payload.match_id}`;
    useBetsStore.setState(state => {
      const existing = state.bets[key];
      if (!existing?.pendingPersist) return state;
      return {
        bets: {
          ...state.bets,
          [key]: { ...existing, pendingPersist: false, persistFailed: true },
        },
      };
    });
  });
}
