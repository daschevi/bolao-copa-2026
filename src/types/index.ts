export type Continent = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';

export type Stage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  flag: string;
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
