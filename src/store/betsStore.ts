import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Bet, LeaderboardEntry, Profile } from '../types';
import { calcPoints } from '../types';
import { useTournamentStore } from './tournamentStore';

interface BetsState {
  bets: Record<string, Bet>; // key: `${userId}-${matchId}`
  saveBet: (userId: string, matchId: string, homeScore: number, awayScore: number) => Promise<void>;
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

      saveBet: async (userId, matchId, homeScore, awayScore) => {
        const key = `${userId}-${matchId}`;
        const match = useTournamentStore.getState().matches[matchId];
        const points = match?.played ? calcPoints({ homeScore, awayScore }, match) : null;
        const bet: Bet = { userId, matchId, homeScore, awayScore, points };
        set(state => ({ bets: { ...state.bets, [key]: bet } }));
        if (isSupabaseConfigured) {
          await supabase.from('bets').upsert({ user_id: userId, match_id: matchId, home_score: homeScore, away_score: awayScore, points });
        }
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
        const { data } = await supabase.from('bets').select('*');
        if (!data) return;
        set(() => {
          const bets: Record<string, Bet> = {};
          data.forEach((b: { user_id: string; match_id: string; home_score: number; away_score: number; points: number | null }) => {
            bets[`${b.user_id}-${b.match_id}`] = { userId: b.user_id, matchId: b.match_id, homeScore: b.home_score, awayScore: b.away_score, points: b.points };
          });
          return { bets };
        });
      },

      getLeaderboard: (profiles) => {
        const { getUserPoints } = get();
        return profiles
          .map(profile => {
            const stats = getUserPoints(profile.id);
            return { profile, totalPoints: stats.total, exactScores: stats.exact, correctResults: stats.correct, totalBets: stats.totalBets };
          })
          .sort((a, b) => b.totalPoints - a.totalPoints || b.exactScores - a.exactScores);
      },
    }),
    { name: 'bolao-bets', partialize: (s) => ({ bets: s.bets }) }
  )
);
