import type { Match } from '../types';
import { getGroupTeams, GROUPS } from './teams';

function makeGroupMatches(group: string): Match[] {
  const teams = getGroupTeams(group).map(t => t.id);
  const [t1, t2, t3, t4] = teams;
  const p = `G${group}`;
  const base = { stage: 'group' as const, group, homeScore: null, awayScore: null, played: false };
  return [
    { ...base, id: `${p}-1`, matchDay: 1, homeTeamId: t1, awayTeamId: t2 },
    { ...base, id: `${p}-2`, matchDay: 1, homeTeamId: t3, awayTeamId: t4 },
    { ...base, id: `${p}-3`, matchDay: 2, homeTeamId: t1, awayTeamId: t3 },
    { ...base, id: `${p}-4`, matchDay: 2, homeTeamId: t2, awayTeamId: t4 },
    { ...base, id: `${p}-5`, matchDay: 3, homeTeamId: t1, awayTeamId: t4 },
    { ...base, id: `${p}-6`, matchDay: 3, homeTeamId: t2, awayTeamId: t3 },
  ];
}

const GROUP_MATCHES: Match[] = GROUPS.flatMap(makeGroupMatches);

const tbd = { homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, played: false };

const KNOCKOUT_MATCHES: Match[] = [
  // Round of 32
  { ...tbd, id: 'R32-1',  stage: 'r32', homeFromSlot: '1A', awayFromSlot: '2B' },
  { ...tbd, id: 'R32-2',  stage: 'r32', homeFromSlot: '3ª ABCD', awayFromSlot: '1C' },
  { ...tbd, id: 'R32-3',  stage: 'r32', homeFromSlot: '1B', awayFromSlot: '2A' },
  { ...tbd, id: 'R32-4',  stage: 'r32', homeFromSlot: '3ª EFGH', awayFromSlot: '1D' },
  { ...tbd, id: 'R32-5',  stage: 'r32', homeFromSlot: '1E', awayFromSlot: '2F' },
  { ...tbd, id: 'R32-6',  stage: 'r32', homeFromSlot: '3ª IJKL', awayFromSlot: '1G' },
  { ...tbd, id: 'R32-7',  stage: 'r32', homeFromSlot: '1F', awayFromSlot: '2E' },
  { ...tbd, id: 'R32-8',  stage: 'r32', homeFromSlot: '3ª ABEF', awayFromSlot: '1H' },
  { ...tbd, id: 'R32-9',  stage: 'r32', homeFromSlot: '1I', awayFromSlot: '2J' },
  { ...tbd, id: 'R32-10', stage: 'r32', homeFromSlot: '3ª CDGH', awayFromSlot: '1K' },
  { ...tbd, id: 'R32-11', stage: 'r32', homeFromSlot: '1J', awayFromSlot: '2I' },
  { ...tbd, id: 'R32-12', stage: 'r32', homeFromSlot: '3ª BCKL', awayFromSlot: '1L' },
  { ...tbd, id: 'R32-13', stage: 'r32', homeFromSlot: '2C', awayFromSlot: '2D' },
  { ...tbd, id: 'R32-14', stage: 'r32', homeFromSlot: '2G', awayFromSlot: '2H' },
  { ...tbd, id: 'R32-15', stage: 'r32', homeFromSlot: '2K', awayFromSlot: '2L' },
  { ...tbd, id: 'R32-16', stage: 'r32', homeFromSlot: '3ª ABIJ', awayFromSlot: '3ª CDEF' },
  // Round of 16
  { ...tbd, id: 'R16-1', stage: 'r16', homeFromSlot: 'W R32-1', awayFromSlot: 'W R32-2' },
  { ...tbd, id: 'R16-2', stage: 'r16', homeFromSlot: 'W R32-3', awayFromSlot: 'W R32-4' },
  { ...tbd, id: 'R16-3', stage: 'r16', homeFromSlot: 'W R32-5', awayFromSlot: 'W R32-6' },
  { ...tbd, id: 'R16-4', stage: 'r16', homeFromSlot: 'W R32-7', awayFromSlot: 'W R32-8' },
  { ...tbd, id: 'R16-5', stage: 'r16', homeFromSlot: 'W R32-9', awayFromSlot: 'W R32-10' },
  { ...tbd, id: 'R16-6', stage: 'r16', homeFromSlot: 'W R32-11', awayFromSlot: 'W R32-12' },
  { ...tbd, id: 'R16-7', stage: 'r16', homeFromSlot: 'W R32-13', awayFromSlot: 'W R32-14' },
  { ...tbd, id: 'R16-8', stage: 'r16', homeFromSlot: 'W R32-15', awayFromSlot: 'W R32-16' },
  // Quarterfinals
  { ...tbd, id: 'QF-1', stage: 'qf', homeFromSlot: 'W R16-1', awayFromSlot: 'W R16-2' },
  { ...tbd, id: 'QF-2', stage: 'qf', homeFromSlot: 'W R16-3', awayFromSlot: 'W R16-4' },
  { ...tbd, id: 'QF-3', stage: 'qf', homeFromSlot: 'W R16-5', awayFromSlot: 'W R16-6' },
  { ...tbd, id: 'QF-4', stage: 'qf', homeFromSlot: 'W R16-7', awayFromSlot: 'W R16-8' },
  // Semifinals
  { ...tbd, id: 'SF-1',    stage: 'sf',    homeFromSlot: 'W QF-1', awayFromSlot: 'W QF-2' },
  { ...tbd, id: 'SF-2',    stage: 'sf',    homeFromSlot: 'W QF-3', awayFromSlot: 'W QF-4' },
  // Third place & Final
  { ...tbd, id: 'THIRD',  stage: 'third', homeFromSlot: 'L SF-1', awayFromSlot: 'L SF-2' },
  { ...tbd, id: 'FINAL',  stage: 'final', homeFromSlot: 'W SF-1', awayFromSlot: 'W SF-2' },
];

export const ALL_MATCHES: Match[] = [...GROUP_MATCHES, ...KNOCKOUT_MATCHES];

export const MATCHES_BY_ID: Record<string, Match> = Object.fromEntries(ALL_MATCHES.map(m => [m.id, m]));

export const STAGE_LABELS: Record<string, string> = {
  group: 'Fase de Grupos',
  r32: 'Oitavas de Final',
  r16: 'Quartas de Final',
  qf: 'Semifinais',
  sf: 'Semifinais',
  third: 'Disputa do 3º Lugar',
  final: 'Final',
};
