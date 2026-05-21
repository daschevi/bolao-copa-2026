import type { Match } from '../types';
import { getGroupTeams, GROUPS } from './teams';

// Venues
const V = {
  AZTECA:   'Estádio Azteca · Cidade do México',
  AKRON:    'Estádio Akron · Guadalajara',
  BBVA:     'Estádio BBVA · Monterrey',
  METLIFE:  'MetLife Stadium · Nova York',
  LEVIS:    'Levi\'s Stadium · Santa Clara',
  SOFI:     'SoFi Stadium · Los Angeles',
  ATT:      'AT&T Stadium · Dallas',
  ARROW:    'Arrowhead Stadium · Kansas City',
  NRG:      'NRG Stadium · Houston',
  MERCEDES: 'Mercedes-Benz Stadium · Atlanta',
  HARDROCK: 'Hard Rock Stadium · Miami',
  GILLETTE: 'Gillette Stadium · Boston',
  LINCOLN:  'Lincoln Financial Field · Filadélfia',
  LUMEN:    'Lumen Field · Seattle',
  BCPLACE:  'BC Place · Vancouver',
  BMO:      'BMO Field · Toronto',
};

// Schedule: [date, time (BRT), venue] for each of the 6 matches per group
// Slots: 0=MD1(t1×t2), 1=MD1(t3×t4), 2=MD2(t1×t3), 3=MD2(t2×t4), 4=MD3(t1×t4), 5=MD3(t2×t3)
// Horários em BRT (UTC-3). Fonte: FIFA / calendário oficial FIFA 2026.
const SCHEDULE: Record<string, [string, string, string][]> = {
  // Grupo A: t1=México, t2=África do Sul, t3=Coreia do Sul, t4=Rep. Tcheca
  A: [
    ['2026-06-11', '16:00', V.AZTECA],   // MD1 México × África do Sul
    ['2026-06-11', '23:00', V.AKRON],    // MD1 Coreia do Sul × Rep. Tcheca
    ['2026-06-18', '22:00', V.AKRON],    // MD2 México × Coreia do Sul
    ['2026-06-18', '13:00', V.MERCEDES], // MD2 África do Sul × Rep. Tcheca
    ['2026-06-24', '22:00', V.AZTECA],   // MD3 México × Rep. Tcheca
    ['2026-06-24', '22:00', V.BBVA],     // MD3 África do Sul × Coreia do Sul
  ],
  // Grupo B: t1=Canadá, t2=Bósnia, t3=Catar, t4=Suíça
  B: [
    ['2026-06-12', '16:00', V.BMO],      // MD1 Canadá × Bósnia
    ['2026-06-13', '16:00', V.LEVIS],    // MD1 Catar × Suíça
    ['2026-06-18', '19:00', V.BCPLACE],  // MD2 Canadá × Catar
    ['2026-06-18', '16:00', V.SOFI],     // MD2 Bósnia × Suíça
    ['2026-06-24', '16:00', V.BCPLACE],  // MD3 Canadá × Suíça
    ['2026-06-24', '16:00', V.LUMEN],    // MD3 Bósnia × Catar
  ],
  // Grupo C: t1=Brasil, t2=Marrocos, t3=Haiti, t4=Escócia
  C: [
    ['2026-06-13', '19:00', V.METLIFE],  // MD1 Brasil × Marrocos
    ['2026-06-13', '22:00', V.GILLETTE], // MD1 Haiti × Escócia
    ['2026-06-19', '21:30', V.LINCOLN],  // MD2 Brasil × Haiti
    ['2026-06-19', '19:00', V.GILLETTE], // MD2 Marrocos × Escócia
    ['2026-06-24', '19:00', V.HARDROCK], // MD3 Brasil × Escócia
    ['2026-06-24', '19:00', V.MERCEDES], // MD3 Marrocos × Haiti
  ],
  // Grupo D: t1=EUA, t2=Paraguai, t3=Austrália, t4=Turquia
  D: [
    ['2026-06-12', '22:00', V.SOFI],     // MD1 EUA × Paraguai
    ['2026-06-14', '01:00', V.BCPLACE],  // MD1 Austrália × Turquia
    ['2026-06-19', '16:00', V.LUMEN],    // MD2 EUA × Austrália
    ['2026-06-20', '01:00', V.LEVIS],    // MD2 Paraguai × Turquia
    ['2026-06-25', '23:00', V.SOFI],     // MD3 EUA × Turquia
    ['2026-06-25', '23:00', V.LEVIS],    // MD3 Paraguai × Austrália
  ],
  // Grupo E: t1=Alemanha, t2=Curaçao, t3=Costa do Marfim, t4=Equador
  E: [
    ['2026-06-14', '14:00', V.NRG],      // MD1 Alemanha × Curaçao
    ['2026-06-14', '20:00', V.LINCOLN],  // MD1 Costa do Marfim × Equador
    ['2026-06-20', '17:00', V.BMO],      // MD2 Alemanha × Costa do Marfim
    ['2026-06-20', '21:00', V.ARROW],    // MD2 Curaçao × Equador
    ['2026-06-25', '17:00', V.METLIFE],  // MD3 Alemanha × Equador
    ['2026-06-25', '17:00', V.LINCOLN],  // MD3 Curaçao × Costa do Marfim
  ],
  // Grupo F: t1=Holanda, t2=Japão, t3=Suécia, t4=Tunísia
  F: [
    ['2026-06-14', '17:00', V.ATT],      // MD1 Holanda × Japão
    ['2026-06-14', '23:00', V.BBVA],     // MD1 Suécia × Tunísia
    ['2026-06-20', '14:00', V.NRG],      // MD2 Holanda × Suécia
    ['2026-06-21', '01:00', V.BBVA],     // MD2 Japão × Tunísia
    ['2026-06-25', '20:00', V.ARROW],    // MD3 Holanda × Tunísia
    ['2026-06-25', '20:00', V.ATT],      // MD3 Japão × Suécia
  ],
  // Grupo G: t1=Bélgica, t2=Egito, t3=Irã, t4=Nova Zelândia
  G: [
    ['2026-06-15', '16:00', V.LUMEN],    // MD1 Bélgica × Egito
    ['2026-06-15', '22:00', V.SOFI],     // MD1 Irã × Nova Zelândia
    ['2026-06-21', '16:00', V.SOFI],     // MD2 Bélgica × Irã
    ['2026-06-21', '22:00', V.BCPLACE],  // MD2 Egito × Nova Zelândia
    ['2026-06-27', '00:00', V.BCPLACE],  // MD3 Bélgica × Nova Zelândia
    ['2026-06-27', '00:00', V.LUMEN],    // MD3 Egito × Irã
  ],
  // Grupo H: t1=Espanha, t2=Cabo Verde, t3=Arábia Saudita, t4=Uruguai
  H: [
    ['2026-06-15', '13:00', V.MERCEDES], // MD1 Espanha × Cabo Verde
    ['2026-06-15', '19:00', V.HARDROCK], // MD1 Arábia Saudita × Uruguai
    ['2026-06-21', '13:00', V.MERCEDES], // MD2 Espanha × Arábia Saudita
    ['2026-06-21', '19:00', V.HARDROCK], // MD2 Cabo Verde × Uruguai
    ['2026-06-26', '21:00', V.AKRON],    // MD3 Espanha × Uruguai
    ['2026-06-26', '21:00', V.NRG],      // MD3 Cabo Verde × Arábia Saudita
  ],
  // Grupo I: t1=França, t2=Senegal, t3=Iraque, t4=Noruega
  I: [
    ['2026-06-16', '16:00', V.METLIFE],  // MD1 França × Senegal
    ['2026-06-16', '19:00', V.GILLETTE], // MD1 Iraque × Noruega
    ['2026-06-22', '18:00', V.LINCOLN],  // MD2 França × Iraque
    ['2026-06-22', '21:00', V.METLIFE],  // MD2 Senegal × Noruega
    ['2026-06-26', '16:00', V.GILLETTE], // MD3 França × Noruega
    ['2026-06-26', '16:00', V.BMO],      // MD3 Senegal × Iraque
  ],
  // Grupo J: t1=Argentina, t2=Argélia, t3=Áustria, t4=Jordânia
  J: [
    ['2026-06-16', '22:00', V.ARROW],    // MD1 Argentina × Argélia
    ['2026-06-17', '01:00', V.LEVIS],    // MD1 Áustria × Jordânia
    ['2026-06-22', '14:00', V.ATT],      // MD2 Argentina × Áustria
    ['2026-06-23', '00:00', V.LEVIS],    // MD2 Argélia × Jordânia
    ['2026-06-27', '23:00', V.ATT],      // MD3 Argentina × Jordânia
    ['2026-06-27', '23:00', V.ARROW],    // MD3 Argélia × Áustria
  ],
  // Grupo K: t1=Portugal, t2=Congo RD, t3=Uzbequistão, t4=Colômbia
  K: [
    ['2026-06-17', '14:00', V.NRG],      // MD1 Portugal × Congo RD
    ['2026-06-17', '23:00', V.AZTECA],   // MD1 Uzbequistão × Colômbia
    ['2026-06-23', '14:00', V.NRG],      // MD2 Portugal × Uzbequistão
    ['2026-06-23', '23:00', V.AKRON],    // MD2 Congo RD × Colômbia
    ['2026-06-27', '20:30', V.HARDROCK], // MD3 Portugal × Colômbia
    ['2026-06-27', '20:30', V.MERCEDES], // MD3 Congo RD × Uzbequistão
  ],
  // Grupo L: t1=Inglaterra, t2=Croácia, t3=Gana, t4=Panamá
  L: [
    ['2026-06-17', '17:00', V.ATT],      // MD1 Inglaterra × Croácia
    ['2026-06-17', '20:00', V.BMO],      // MD1 Gana × Panamá
    ['2026-06-23', '17:00', V.GILLETTE], // MD2 Inglaterra × Gana
    ['2026-06-23', '20:00', V.BMO],      // MD2 Croácia × Panamá
    ['2026-06-27', '18:00', V.METLIFE],  // MD3 Inglaterra × Panamá
    ['2026-06-27', '18:00', V.LINCOLN],  // MD3 Croácia × Gana
  ],
};

function makeGroupMatches(group: string): Match[] {
  const teams = getGroupTeams(group).map(t => t.id);
  const [t1, t2, t3, t4] = teams;
  const p = `G${group}`;
  const sched = SCHEDULE[group] ?? [];
  const s = (i: number) => ({ date: sched[i]?.[0], time: sched[i]?.[1], venue: sched[i]?.[2] });
  const base = { stage: 'group' as const, group, homeScore: null, awayScore: null, played: false };
  return [
    { ...base, id: `${p}-1`, matchDay: 1, homeTeamId: t1, awayTeamId: t2, ...s(0) },
    { ...base, id: `${p}-2`, matchDay: 1, homeTeamId: t3, awayTeamId: t4, ...s(1) },
    { ...base, id: `${p}-3`, matchDay: 2, homeTeamId: t1, awayTeamId: t3, ...s(2) },
    { ...base, id: `${p}-4`, matchDay: 2, homeTeamId: t2, awayTeamId: t4, ...s(3) },
    { ...base, id: `${p}-5`, matchDay: 3, homeTeamId: t1, awayTeamId: t4, ...s(4) },
    { ...base, id: `${p}-6`, matchDay: 3, homeTeamId: t2, awayTeamId: t3, ...s(5) },
  ];
}

const GROUP_MATCHES: Match[] = GROUPS.flatMap(makeGroupMatches);

const tbd = { homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, played: false };

// FIFA 2026 — Rodada de 32 (chaveamento oficial)
// Fonte: https://www.fifa.com/pt/tournaments/mens/worldcup/canadamexicousa2026
const KNOCKOUT_MATCHES: Match[] = [
  // ── Rodada de 32 (29 jun – 6 jul) ───────────────────────────────────────
  { ...tbd, id: 'R32-1',  stage: 'r32', homeFromSlot: '2A',       awayFromSlot: '2B',       date: '2026-06-29', time: '18:00', venue: V.GILLETTE  },
  { ...tbd, id: 'R32-2',  stage: 'r32', homeFromSlot: '1E',       awayFromSlot: '3ª ABCDF', date: '2026-06-29', time: '22:00', venue: V.METLIFE   },
  { ...tbd, id: 'R32-3',  stage: 'r32', homeFromSlot: '1F',       awayFromSlot: '2C',       date: '2026-06-30', time: '18:00', venue: V.LUMEN     },
  { ...tbd, id: 'R32-4',  stage: 'r32', homeFromSlot: '1C',       awayFromSlot: '2F',       date: '2026-06-30', time: '22:00', venue: V.SOFI      },
  { ...tbd, id: 'R32-5',  stage: 'r32', homeFromSlot: '1I',       awayFromSlot: '3ª CDFGH', date: '2026-07-01', time: '18:00', venue: V.ARROW     },
  { ...tbd, id: 'R32-6',  stage: 'r32', homeFromSlot: '2E',       awayFromSlot: '2I',       date: '2026-07-01', time: '22:00', venue: V.MERCEDES  },
  { ...tbd, id: 'R32-7',  stage: 'r32', homeFromSlot: '1A',       awayFromSlot: '3ª CEFHI', date: '2026-07-02', time: '18:00', venue: V.AZTECA    },
  { ...tbd, id: 'R32-8',  stage: 'r32', homeFromSlot: '1L',       awayFromSlot: '3ª EHIJK', date: '2026-07-02', time: '22:00', venue: V.HARDROCK  },
  { ...tbd, id: 'R32-9',  stage: 'r32', homeFromSlot: '1D',       awayFromSlot: '3ª BEFIJ', date: '2026-07-03', time: '18:00', venue: V.BMO       },
  { ...tbd, id: 'R32-10', stage: 'r32', homeFromSlot: '1G',       awayFromSlot: '3ª AEHIJ', date: '2026-07-03', time: '22:00', venue: V.ATT       },
  { ...tbd, id: 'R32-11', stage: 'r32', homeFromSlot: '2K',       awayFromSlot: '2L',       date: '2026-07-04', time: '18:00', venue: V.LINCOLN   },
  { ...tbd, id: 'R32-12', stage: 'r32', homeFromSlot: '1H',       awayFromSlot: '2J',       date: '2026-07-04', time: '22:00', venue: V.LEVIS  },
  { ...tbd, id: 'R32-13', stage: 'r32', homeFromSlot: '1B',       awayFromSlot: '3ª EFGIJ', date: '2026-07-05', time: '18:00', venue: V.BCPLACE   },
  { ...tbd, id: 'R32-14', stage: 'r32', homeFromSlot: '1J',       awayFromSlot: '2H',       date: '2026-07-05', time: '22:00', venue: V.NRG       },
  { ...tbd, id: 'R32-15', stage: 'r32', homeFromSlot: '1K',       awayFromSlot: '3ª DEIJL', date: '2026-07-06', time: '18:00', venue: V.AKRON     },
  { ...tbd, id: 'R32-16', stage: 'r32', homeFromSlot: '2D',       awayFromSlot: '2G',       date: '2026-07-06', time: '22:00', venue: V.BBVA      },
  // ── Oitavas de Final (9–12 jul) ──────────────────────────────────────────
  { ...tbd, id: 'R16-1',  stage: 'r16', homeFromSlot: 'W R32-2',  awayFromSlot: 'W R32-5',  date: '2026-07-09', time: '18:00', venue: V.METLIFE   },
  { ...tbd, id: 'R16-2',  stage: 'r16', homeFromSlot: 'W R32-1',  awayFromSlot: 'W R32-3',  date: '2026-07-09', time: '22:00', venue: V.LUMEN     },
  { ...tbd, id: 'R16-3',  stage: 'r16', homeFromSlot: 'W R32-4',  awayFromSlot: 'W R32-6',  date: '2026-07-10', time: '18:00', venue: V.SOFI      },
  { ...tbd, id: 'R16-4',  stage: 'r16', homeFromSlot: 'W R32-7',  awayFromSlot: 'W R32-8',  date: '2026-07-10', time: '22:00', venue: V.AZTECA    },
  { ...tbd, id: 'R16-5',  stage: 'r16', homeFromSlot: 'W R32-11', awayFromSlot: 'W R32-12', date: '2026-07-11', time: '18:00', venue: V.ATT       },
  { ...tbd, id: 'R16-6',  stage: 'r16', homeFromSlot: 'W R32-9',  awayFromSlot: 'W R32-10', date: '2026-07-11', time: '22:00', venue: V.LEVIS  },
  { ...tbd, id: 'R16-7',  stage: 'r16', homeFromSlot: 'W R32-14', awayFromSlot: 'W R32-16', date: '2026-07-12', time: '18:00', venue: V.MERCEDES  },
  { ...tbd, id: 'R16-8',  stage: 'r16', homeFromSlot: 'W R32-13', awayFromSlot: 'W R32-15', date: '2026-07-12', time: '22:00', venue: V.HARDROCK  },
  // ── Quartas de Final (15–16 jul) ─────────────────────────────────────────
  { ...tbd, id: 'QF-1',   stage: 'qf',  homeFromSlot: 'W R16-1',  awayFromSlot: 'W R16-2',  date: '2026-07-15', time: '22:00', venue: V.METLIFE   },
  { ...tbd, id: 'QF-2',   stage: 'qf',  homeFromSlot: 'W R16-5',  awayFromSlot: 'W R16-6',  date: '2026-07-15', time: '18:00', venue: V.ATT       },
  { ...tbd, id: 'QF-3',   stage: 'qf',  homeFromSlot: 'W R16-3',  awayFromSlot: 'W R16-4',  date: '2026-07-16', time: '18:00', venue: V.SOFI      },
  { ...tbd, id: 'QF-4',   stage: 'qf',  homeFromSlot: 'W R16-7',  awayFromSlot: 'W R16-8',  date: '2026-07-16', time: '22:00', venue: V.LEVIS  },
  // ── Semifinais (19–20 jul) ───────────────────────────────────────────────
  { ...tbd, id: 'SF-1',   stage: 'sf',  homeFromSlot: 'W QF-1',   awayFromSlot: 'W QF-2',   date: '2026-07-19', time: '22:00', venue: V.ATT       },
  { ...tbd, id: 'SF-2',   stage: 'sf',  homeFromSlot: 'W QF-3',   awayFromSlot: 'W QF-4',   date: '2026-07-20', time: '22:00', venue: V.LEVIS  },
  // ── 3º Lugar / Final ────────────────────────────────────────────────────
  { ...tbd, id: 'THIRD',  stage: 'third', homeFromSlot: 'L SF-1', awayFromSlot: 'L SF-2',   date: '2026-07-23', time: '16:00', venue: V.HARDROCK  },
  { ...tbd, id: 'FINAL',  stage: 'final', homeFromSlot: 'W SF-1', awayFromSlot: 'W SF-2',   date: '2026-07-23', time: '22:00', venue: V.METLIFE   },
];

export const ALL_MATCHES: Match[] = [...GROUP_MATCHES, ...KNOCKOUT_MATCHES];
export const MATCHES_BY_ID: Record<string, Match> = Object.fromEntries(ALL_MATCHES.map(m => [m.id, m]));

export const STAGE_LABELS: Record<string, string> = {
  group: 'Fase de Grupos',
  r32:   'Segunda Fase',
  r16:   'Oitavas de Final',
  qf:    'Quartas de Final',
  sf:    'Semifinais',
  third: 'Disputa do 3º Lugar',
  final: 'Final',
};

export function formatMatchDate(date?: string, time?: string): string {
  if (!date) return '';
  const [, m, d] = date.split('-');
  const months = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${parseInt(d)} ${months[parseInt(m)]}${time ? ` · ${time}` : ''}`;
}
