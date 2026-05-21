export type Continent = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';

export type Stage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  code: string; // ISO 3166-1 alpha-2 for flagcdn.com
  group: string;
  continent: Continent;
}

export interface Match {
  id: string;
  stage: Stage;
  group?: string;
  matchDay?: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  played: boolean;
  date?: string;   // 'YYYY-MM-DD'
  time?: string;   // 'HH:MM' horário de Brasília
  venue?: string;
  homeFromSlot?: string;
  awayFromSlot?: string;
}

export interface GroupStanding {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface Profile {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Bet {
  id?: string;
  userId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  points?: number | null;
  /**
   * Flag local apenas — true enquanto a escrita no Supabase não confirmou.
   * Quando true, `fetchAllBets` NÃO sobrescreve esta bet com a versão do BD
   * (que ainda não a tem). Limpada pelo callback de sucesso do `persistOp`.
   * Nunca é enviada ao Supabase.
   */
  pendingPersist?: boolean;
}

export interface LeaderboardEntry {
  profile: Profile;
  totalPoints: number;
  exactScores: number;
  correctResults: number;
  totalBets: number;
}

export function calcPoints(
  bet: { homeScore: number; awayScore: number },
  result: { homeScore: number | null; awayScore: number | null }
): number {
  if (result.homeScore === null || result.awayScore === null) return 0;
  if (bet.homeScore === result.homeScore && bet.awayScore === result.awayScore) return 3;
  const betResult = Math.sign(bet.homeScore - bet.awayScore);
  const realResult = Math.sign(result.homeScore - result.awayScore);
  return betResult === realResult ? 1 : 0;
}
