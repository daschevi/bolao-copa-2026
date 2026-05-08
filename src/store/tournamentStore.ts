import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALL_MATCHES } from '../data/matches';
import { getGroupTeams, GROUPS } from '../data/teams';
import type { Match, GroupStanding } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface TournamentState {
  matches: Record<string, Match>;
  setResult: (matchId: string, homeScore: number, awayScore: number, homePenalties?: number | null, awayPenalties?: number | null) => Promise<void>;
  setKnockoutTeams: (matchId: string, homeTeamId: string | null, awayTeamId: string | null) => void;
  getGroupStandings: (group: string) => GroupStanding[];
  getAllThirdPlace: () => (GroupStanding & { group: string })[];
  resetMatch: (matchId: string) => void;
  syncFromSupabase: () => Promise<void>;
}

function computeStandings(group: string, matches: Record<string, Match>): GroupStanding[] {
  const teams = getGroupTeams(group);
  const standings: Record<string, GroupStanding> = {};
  teams.forEach(t => {
    standings[t.id] = { teamId: t.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
  });

  Object.values(matches)
    .filter(m => m.stage === 'group' && m.group === group && m.played && m.homeScore !== null && m.awayScore !== null && m.homeTeamId && m.awayTeamId)
    .forEach(m => {
      const h = standings[m.homeTeamId!];
      const a = standings[m.awayTeamId!];
      if (!h || !a) return;
      h.played++; a.played++;
      h.goalsFor += m.homeScore!; h.goalsAgainst += m.awayScore!;
      a.goalsFor += m.awayScore!; a.goalsAgainst += m.homeScore!;
      if (m.homeScore! > m.awayScore!) { h.won++; h.points += 3; a.lost++; }
      else if (m.homeScore! === m.awayScore!) { h.drawn++; h.points++; a.drawn++; a.points++; }
      else { a.won++; a.points += 3; h.lost++; }
      h.goalDifference = h.goalsFor - h.goalsAgainst;
      a.goalDifference = a.goalsFor - a.goalsAgainst;
    });

  return Object.values(standings).sort((a, b) =>
    b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
}

const initialMatches = Object.fromEntries(ALL_MATCHES.map(m => [m.id, { ...m }]));

export const useTournamentStore = create<TournamentState>()(
  persist(
    (set, get) => ({
      matches: initialMatches,

      setResult: async (matchId, homeScore, awayScore, homePenalties, awayPenalties) => {
        set(state => ({
          matches: {
            ...state.matches,
            [matchId]: { ...state.matches[matchId], homeScore, awayScore, homePenalties, awayPenalties, played: true },
          },
        }));
        if (isSupabaseConfigured) {
          await supabase.from('match_results').upsert({ match_id: matchId, home_score: homeScore, away_score: awayScore, home_penalties: homePenalties, away_penalties: awayPenalties });
        }
      },

      setKnockoutTeams: (matchId, homeTeamId, awayTeamId) => {
        set(state => ({
          matches: { ...state.matches, [matchId]: { ...state.matches[matchId], homeTeamId, awayTeamId } },
        }));
      },

      resetMatch: (matchId) => {
        set(state => ({
          matches: { ...state.matches, [matchId]: { ...state.matches[matchId], homeScore: null, awayScore: null, homePenalties: null, awayPenalties: null, played: false } },
        }));
      },

      getGroupStandings: (group) => computeStandings(group, get().matches),

      getAllThirdPlace: () => {
        return GROUPS.map(g => {
          const standings = computeStandings(g, get().matches);
          return standings[2] ? { ...standings[2], group: g } : null;
        }).filter(Boolean) as (GroupStanding & { group: string })[];
      },

      syncFromSupabase: async () => {
        if (!isSupabaseConfigured) return;
        const { data } = await supabase.from('match_results').select('*');
        if (!data) return;
        set(state => {
          const updated = { ...state.matches };
          data.forEach((r: { match_id: string; home_score: number; away_score: number; home_penalties: number | null; away_penalties: number | null }) => {
            if (updated[r.match_id]) {
              updated[r.match_id] = { ...updated[r.match_id], homeScore: r.home_score, awayScore: r.away_score, homePenalties: r.home_penalties, awayPenalties: r.away_penalties, played: true };
            }
          });
          return { matches: updated };
        });
      },
    }),
    {
      name: 'bolao-tournament',
      partialize: (s) => ({ matches: s.matches }),
    }
  )
);
