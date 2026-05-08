import type { Team } from '../types';

export const TEAMS: Team[] = [
  // Group A
  { id: 'mexico', name: 'México', shortName: 'MEX', flag: '🇲🇽', group: 'A', continent: 'CONCACAF' },
  { id: 'south-africa', name: 'África do Sul', shortName: 'RSA', flag: '🇿🇦', group: 'A', continent: 'CAF' },
  { id: 'south-korea', name: 'Coreia do Sul', shortName: 'KOR', flag: '🇰🇷', group: 'A', continent: 'AFC' },
  { id: 'czech-republic', name: 'República Tcheca', shortName: 'CZE', flag: '🇨🇿', group: 'A', continent: 'UEFA' },
  // Group B
  { id: 'canada', name: 'Canadá', shortName: 'CAN', flag: '🇨🇦', group: 'B', continent: 'CONCACAF' },
  { id: 'bosnia', name: 'Bósnia e Herzegovina', shortName: 'BIH', flag: '🇧🇦', group: 'B', continent: 'UEFA' },
  { id: 'qatar', name: 'Catar', shortName: 'QAT', flag: '🇶🇦', group: 'B', continent: 'AFC' },
  { id: 'switzerland', name: 'Suíça', shortName: 'SUI', flag: '🇨🇭', group: 'B', continent: 'UEFA' },
  // Group C
  { id: 'brazil', name: 'Brasil', shortName: 'BRA', flag: '🇧🇷', group: 'C', continent: 'CONMEBOL' },
  { id: 'morocco', name: 'Marrocos', shortName: 'MAR', flag: '🇲🇦', group: 'C', continent: 'CAF' },
  { id: 'haiti', name: 'Haiti', shortName: 'HAI', flag: '🇭🇹', group: 'C', continent: 'CONCACAF' },
  { id: 'scotland', name: 'Escócia', shortName: 'SCO', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', group: 'C', continent: 'UEFA' },
  // Group D
  { id: 'usa', name: 'Estados Unidos', shortName: 'USA', flag: '🇺🇸', group: 'D', continent: 'CONCACAF' },
  { id: 'paraguay', name: 'Paraguai', shortName: 'PAR', flag: '🇵🇾', group: 'D', continent: 'CONMEBOL' },
  { id: 'australia', name: 'Austrália', shortName: 'AUS', flag: '🇦🇺', group: 'D', continent: 'OFC' },
  { id: 'turkey', name: 'Turquia', shortName: 'TUR', flag: '🇹🇷', group: 'D', continent: 'UEFA' },
  // Group E
  { id: 'germany', name: 'Alemanha', shortName: 'GER', flag: '🇩🇪', group: 'E', continent: 'UEFA' },
  { id: 'curacao', name: 'Curaçao', shortName: 'CUW', flag: '🇨🇼', group: 'E', continent: 'CONCACAF' },
  { id: 'ivory-coast', name: 'Costa do Marfim', shortName: 'CIV', flag: '🇨🇮', group: 'E', continent: 'CAF' },
  { id: 'ecuador', name: 'Equador', shortName: 'ECU', flag: '🇪🇨', group: 'E', continent: 'CONMEBOL' },
  // Group F
  { id: 'netherlands', name: 'Holanda', shortName: 'NED', flag: '🇳🇱', group: 'F', continent: 'UEFA' },
  { id: 'japan', name: 'Japão', shortName: 'JPN', flag: '🇯🇵', group: 'F', continent: 'AFC' },
  { id: 'sweden', name: 'Suécia', shortName: 'SWE', flag: '🇸🇪', group: 'F', continent: 'UEFA' },
  { id: 'tunisia', name: 'Tunísia', shortName: 'TUN', flag: '🇹🇳', group: 'F', continent: 'CAF' },
  // Group G
  { id: 'belgium', name: 'Bélgica', shortName: 'BEL', flag: '🇧🇪', group: 'G', continent: 'UEFA' },
  { id: 'egypt', name: 'Egito', shortName: 'EGY', flag: '🇪🇬', group: 'G', continent: 'CAF' },
  { id: 'iran', name: 'Irã', shortName: 'IRN', flag: '🇮🇷', group: 'G', continent: 'AFC' },
  { id: 'new-zealand', name: 'Nova Zelândia', shortName: 'NZL', flag: '🇳🇿', group: 'G', continent: 'OFC' },
  // Group H
  { id: 'spain', name: 'Espanha', shortName: 'ESP', flag: '🇪🇸', group: 'H', continent: 'UEFA' },
  { id: 'cape-verde', name: 'Cabo Verde', shortName: 'CPV', flag: '🇨🇻', group: 'H', continent: 'CAF' },
  { id: 'saudi-arabia', name: 'Arábia Saudita', shortName: 'KSA', flag: '🇸🇦', group: 'H', continent: 'AFC' },
  { id: 'uruguay', name: 'Uruguai', shortName: 'URU', flag: '🇺🇾', group: 'H', continent: 'CONMEBOL' },
  // Group I
  { id: 'france', name: 'França', shortName: 'FRA', flag: '🇫🇷', group: 'I', continent: 'UEFA' },
  { id: 'senegal', name: 'Senegal', shortName: 'SEN', flag: '🇸🇳', group: 'I', continent: 'CAF' },
  { id: 'iraq', name: 'Iraque', shortName: 'IRQ', flag: '🇮🇶', group: 'I', continent: 'AFC' },
  { id: 'norway', name: 'Noruega', shortName: 'NOR', flag: '🇳🇴', group: 'I', continent: 'UEFA' },
  // Group J
  { id: 'argentina', name: 'Argentina', shortName: 'ARG', flag: '🇦🇷', group: 'J', continent: 'CONMEBOL' },
  { id: 'algeria', name: 'Argélia', shortName: 'ALG', flag: '🇩🇿', group: 'J', continent: 'CAF' },
  { id: 'austria', name: 'Áustria', shortName: 'AUT', flag: '🇦🇹', group: 'J', continent: 'UEFA' },
  { id: 'jordan', name: 'Jordânia', shortName: 'JOR', flag: '🇯🇴', group: 'J', continent: 'AFC' },
  // Group K
  { id: 'portugal', name: 'Portugal', shortName: 'POR', flag: '🇵🇹', group: 'K', continent: 'UEFA' },
  { id: 'dr-congo', name: 'Congo RD', shortName: 'COD', flag: '🇨🇩', group: 'K', continent: 'CAF' },
  { id: 'uzbekistan', name: 'Uzbequistão', shortName: 'UZB', flag: '🇺🇿', group: 'K', continent: 'AFC' },
  { id: 'colombia', name: 'Colômbia', shortName: 'COL', flag: '🇨🇴', group: 'K', continent: 'CONMEBOL' },
  // Group L
  { id: 'england', name: 'Inglaterra', shortName: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', group: 'L', continent: 'UEFA' },
  { id: 'croatia', name: 'Croácia', shortName: 'CRO', flag: '🇭🇷', group: 'L', continent: 'UEFA' },
  { id: 'ghana', name: 'Gana', shortName: 'GHA', flag: '🇬🇭', group: 'L', continent: 'CAF' },
  { id: 'panama', name: 'Panamá', shortName: 'PAN', flag: '🇵🇦', group: 'L', continent: 'CONCACAF' },
];

export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map(t => [t.id, t]));

export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export function getGroupTeams(group: string): Team[] {
  return TEAMS.filter(t => t.group === group);
}
