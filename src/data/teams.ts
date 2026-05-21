import type { Team } from '../types';

export const TEAMS: Team[] = [
  // Group A
  { id: 'mexico',         name: 'México',               shortName: 'MEX', flag: '🇲🇽', code: 'mx',     group: 'A', continent: 'CONCACAF' },
  { id: 'south-africa',   name: 'África do Sul',         shortName: 'RSA', flag: '🇿🇦', code: 'za',     group: 'A', continent: 'CAF' },
  { id: 'south-korea',    name: 'Coreia do Sul',         shortName: 'KOR', flag: '🇰🇷', code: 'kr',     group: 'A', continent: 'AFC' },
  { id: 'czech-republic', name: 'República Tcheca',      shortName: 'CZE', flag: '🇨🇿', code: 'cz',     group: 'A', continent: 'UEFA' },
  // Group B
  { id: 'canada',         name: 'Canadá',                shortName: 'CAN', flag: '🇨🇦', code: 'ca',     group: 'B', continent: 'CONCACAF' },
  { id: 'bosnia',         name: 'Bósnia e Herzegovina',  shortName: 'BIH', flag: '🇧🇦', code: 'ba',     group: 'B', continent: 'UEFA' },
  { id: 'qatar',          name: 'Catar',                 shortName: 'QAT', flag: '🇶🇦', code: 'qa',     group: 'B', continent: 'AFC' },
  { id: 'switzerland',    name: 'Suíça',                 shortName: 'SUI', flag: '🇨🇭', code: 'ch',     group: 'B', continent: 'UEFA' },
  // Group C
  { id: 'brazil',         name: 'Brasil',                shortName: 'BRA', flag: '🇧🇷', code: 'br',     group: 'C', continent: 'CONMEBOL' },
  { id: 'morocco',        name: 'Marrocos',              shortName: 'MAR', flag: '🇲🇦', code: 'ma',     group: 'C', continent: 'CAF' },
  { id: 'haiti',          name: 'Haiti',                 shortName: 'HAI', flag: '🇭🇹', code: 'ht',     group: 'C', continent: 'CONCACAF' },
  { id: 'scotland',       name: 'Escócia',               shortName: 'SCO', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', code: 'gb-sct', group: 'C', continent: 'UEFA' },
  // Group D
  { id: 'usa',            name: 'Estados Unidos',        shortName: 'USA', flag: '🇺🇸', code: 'us',     group: 'D', continent: 'CONCACAF' },
  { id: 'paraguay',       name: 'Paraguai',              shortName: 'PAR', flag: '🇵🇾', code: 'py',     group: 'D', continent: 'CONMEBOL' },
  { id: 'australia',      name: 'Austrália',             shortName: 'AUS', flag: '🇦🇺', code: 'au',     group: 'D', continent: 'OFC' },
  { id: 'turkey',         name: 'Turquia',               shortName: 'TUR', flag: '🇹🇷', code: 'tr',     group: 'D', continent: 'UEFA' },
  // Group E
  { id: 'germany',        name: 'Alemanha',              shortName: 'GER', flag: '🇩🇪', code: 'de',     group: 'E', continent: 'UEFA' },
  { id: 'curacao',        name: 'Curaçao',               shortName: 'CUW', flag: '🇨🇼', code: 'cw',     group: 'E', continent: 'CONCACAF' },
  { id: 'ivory-coast',    name: 'Costa do Marfim',       shortName: 'CIV', flag: '🇨🇮', code: 'ci',     group: 'E', continent: 'CAF' },
  { id: 'ecuador',        name: 'Equador',               shortName: 'ECU', flag: '🇪🇨', code: 'ec',     group: 'E', continent: 'CONMEBOL' },
  // Group F
  { id: 'netherlands',    name: 'Holanda',               shortName: 'NED', flag: '🇳🇱', code: 'nl',     group: 'F', continent: 'UEFA' },
  { id: 'japan',          name: 'Japão',                 shortName: 'JPN', flag: '🇯🇵', code: 'jp',     group: 'F', continent: 'AFC' },
  { id: 'sweden',         name: 'Suécia',                shortName: 'SWE', flag: '🇸🇪', code: 'se',     group: 'F', continent: 'UEFA' },
  { id: 'tunisia',        name: 'Tunísia',               shortName: 'TUN', flag: '🇹🇳', code: 'tn',     group: 'F', continent: 'CAF' },
  // Group G
  { id: 'belgium',        name: 'Bélgica',               shortName: 'BEL', flag: '🇧🇪', code: 'be',     group: 'G', continent: 'UEFA' },
  { id: 'egypt',          name: 'Egito',                 shortName: 'EGY', flag: '🇪🇬', code: 'eg',     group: 'G', continent: 'CAF' },
  { id: 'iran',           name: 'Irã',                   shortName: 'IRN', flag: '🇮🇷', code: 'ir',     group: 'G', continent: 'AFC' },
  { id: 'new-zealand',    name: 'Nova Zelândia',         shortName: 'NZL', flag: '🇳🇿', code: 'nz',     group: 'G', continent: 'OFC' },
  // Group H
  { id: 'spain',          name: 'Espanha',               shortName: 'ESP', flag: '🇪🇸', code: 'es',     group: 'H', continent: 'UEFA' },
  { id: 'cape-verde',     name: 'Cabo Verde',            shortName: 'CPV', flag: '🇨🇻', code: 'cv',     group: 'H', continent: 'CAF' },
  { id: 'saudi-arabia',   name: 'Arábia Saudita',        shortName: 'KSA', flag: '🇸🇦', code: 'sa',     group: 'H', continent: 'AFC' },
  { id: 'uruguay',        name: 'Uruguai',               shortName: 'URU', flag: '🇺🇾', code: 'uy',     group: 'H', continent: 'CONMEBOL' },
  // Group I
  { id: 'france',         name: 'França',                shortName: 'FRA', flag: '🇫🇷', code: 'fr',     group: 'I', continent: 'UEFA' },
  { id: 'senegal',        name: 'Senegal',               shortName: 'SEN', flag: '🇸🇳', code: 'sn',     group: 'I', continent: 'CAF' },
  { id: 'iraq',           name: 'Iraque',                shortName: 'IRQ', flag: '🇮🇶', code: 'iq',     group: 'I', continent: 'AFC' },
  { id: 'norway',         name: 'Noruega',               shortName: 'NOR', flag: '🇳🇴', code: 'no',     group: 'I', continent: 'UEFA' },
  // Group J
  { id: 'argentina',      name: 'Argentina',             shortName: 'ARG', flag: '🇦🇷', code: 'ar',     group: 'J', continent: 'CONMEBOL' },
  { id: 'algeria',        name: 'Argélia',               shortName: 'ALG', flag: '🇩🇿', code: 'dz',     group: 'J', continent: 'CAF' },
  { id: 'austria',        name: 'Áustria',               shortName: 'AUT', flag: '🇦🇹', code: 'at',     group: 'J', continent: 'UEFA' },
  { id: 'jordan',         name: 'Jordânia',              shortName: 'JOR', flag: '🇯🇴', code: 'jo',     group: 'J', continent: 'AFC' },
  // Group K
  { id: 'portugal',       name: 'Portugal',              shortName: 'POR', flag: '🇵🇹', code: 'pt',     group: 'K', continent: 'UEFA' },
  { id: 'dr-congo',       name: 'Congo RD',              shortName: 'COD', flag: '🇨🇩', code: 'cd',     group: 'K', continent: 'CAF' },
  { id: 'uzbekistan',     name: 'Uzbequistão',           shortName: 'UZB', flag: '🇺🇿', code: 'uz',     group: 'K', continent: 'AFC' },
  { id: 'colombia',       name: 'Colômbia',              shortName: 'COL', flag: '🇨🇴', code: 'co',     group: 'K', continent: 'CONMEBOL' },
  // Group L
  { id: 'england',        name: 'Inglaterra',            shortName: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'gb-eng', group: 'L', continent: 'UEFA' },
  { id: 'croatia',        name: 'Croácia',               shortName: 'CRO', flag: '🇭🇷', code: 'hr',     group: 'L', continent: 'UEFA' },
  { id: 'ghana',          name: 'Gana',                  shortName: 'GHA', flag: '🇬🇭', code: 'gh',     group: 'L', continent: 'CAF' },
  { id: 'panama',         name: 'Panamá',                shortName: 'PAN', flag: '🇵🇦', code: 'pa',     group: 'L', continent: 'CONCACAF' },
];

export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map(t => [t.id, t]));

export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export function getGroupTeams(group: string): Team[] {
  return TEAMS.filter(t => t.group === group);
}
