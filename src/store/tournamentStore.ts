import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALL_MATCHES } from '../data/matches';
import { getGroupTeams, GROUPS } from '../data/teams';
import type { Match, GroupStanding } from '../types';
import { supabase, isSupabaseConfigured, sq, persistOp, hasPendingOutboxOpForMatch } from '../lib/supabase';

interface TournamentState {
  matches: Record<string, Match>;
  setResult: (matchId: string, homeScore: number, awayScore: number, homePenalties?: number | null, awayPenalties?: number | null, onError?: (msg: string) => void) => { error: string | null };
  setKnockoutTeams: (matchId: string, homeTeamId: string | null, awayTeamId: string | null, onError?: (msg: string) => void) => void;
  getGroupStandings: (group: string) => GroupStanding[];
  getAllThirdPlace: () => (GroupStanding & { group: string })[];
  resetMatch: (matchId: string, onError?: (msg: string) => void) => void;
  syncFromSupabase: () => Promise<void>;
  autoPopulateKnockout: () => void;
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
      if (m.homeScore! > m.awayScore!)       { h.won++;   h.points += 3; a.lost++; }
      else if (m.homeScore! === m.awayScore!) { h.drawn++; h.points++;   a.drawn++; a.points++; }
      else                                    { a.won++;   a.points += 3; h.lost++; }
      h.goalDifference = h.goalsFor - h.goalsAgainst;
      a.goalDifference = a.goalsFor - a.goalsAgainst;
    });

  return Object.values(standings).sort((a, b) =>
    b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
}

/** Retorna o time vencedor de uma partida eliminatória (ou null se ainda não decidido). */
function getMatchWinner(m: Match): string | null {
  if (!m.played || m.homeScore === null || m.awayScore === null) return null;
  if (m.homeScore > m.awayScore) return m.homeTeamId;
  if (m.awayScore > m.homeScore) return m.awayTeamId;
  if (m.homePenalties != null && m.awayPenalties != null) {
    return m.homePenalties > m.awayPenalties ? m.homeTeamId : m.awayTeamId;
  }
  return null;
}

/** Retorna o time perdedor de uma partida eliminatória (para o 3º lugar). */
function getMatchLoser(m: Match): string | null {
  if (!m.played || m.homeScore === null || m.awayScore === null) return null;
  if (m.homeScore > m.awayScore) return m.awayTeamId;
  if (m.awayScore > m.homeScore) return m.homeTeamId;
  if (m.homePenalties != null && m.awayPenalties != null) {
    return m.homePenalties > m.awayPenalties ? m.awayTeamId : m.homeTeamId;
  }
  return null;
}

/** Mapa de propagação: quem vence/perde cada partida vai para qual slot da próxima fase. */
const KNOCKOUT_PROPAGATION: Array<{
  src: string; outcome: 'winner' | 'loser';
  dst: string; side: 'homeTeamId' | 'awayTeamId';
}> = [
  // R32 → Oitavas (R16)
  { src: 'R32-2',  outcome: 'winner', dst: 'R16-1', side: 'homeTeamId' },
  { src: 'R32-5',  outcome: 'winner', dst: 'R16-1', side: 'awayTeamId' },
  { src: 'R32-1',  outcome: 'winner', dst: 'R16-2', side: 'homeTeamId' },
  { src: 'R32-3',  outcome: 'winner', dst: 'R16-2', side: 'awayTeamId' },
  { src: 'R32-4',  outcome: 'winner', dst: 'R16-3', side: 'homeTeamId' },
  { src: 'R32-6',  outcome: 'winner', dst: 'R16-3', side: 'awayTeamId' },
  { src: 'R32-7',  outcome: 'winner', dst: 'R16-4', side: 'homeTeamId' },
  { src: 'R32-8',  outcome: 'winner', dst: 'R16-4', side: 'awayTeamId' },
  { src: 'R32-11', outcome: 'winner', dst: 'R16-5', side: 'homeTeamId' },
  { src: 'R32-12', outcome: 'winner', dst: 'R16-5', side: 'awayTeamId' },
  { src: 'R32-9',  outcome: 'winner', dst: 'R16-6', side: 'homeTeamId' },
  { src: 'R32-10', outcome: 'winner', dst: 'R16-6', side: 'awayTeamId' },
  { src: 'R32-14', outcome: 'winner', dst: 'R16-7', side: 'homeTeamId' },
  { src: 'R32-16', outcome: 'winner', dst: 'R16-7', side: 'awayTeamId' },
  { src: 'R32-13', outcome: 'winner', dst: 'R16-8', side: 'homeTeamId' },
  { src: 'R32-15', outcome: 'winner', dst: 'R16-8', side: 'awayTeamId' },
  // Oitavas (R16) → Quartas (QF)
  { src: 'R16-1',  outcome: 'winner', dst: 'QF-1', side: 'homeTeamId' },
  { src: 'R16-2',  outcome: 'winner', dst: 'QF-1', side: 'awayTeamId' },
  { src: 'R16-5',  outcome: 'winner', dst: 'QF-2', side: 'homeTeamId' },
  { src: 'R16-6',  outcome: 'winner', dst: 'QF-2', side: 'awayTeamId' },
  { src: 'R16-3',  outcome: 'winner', dst: 'QF-3', side: 'homeTeamId' },
  { src: 'R16-4',  outcome: 'winner', dst: 'QF-3', side: 'awayTeamId' },
  { src: 'R16-7',  outcome: 'winner', dst: 'QF-4', side: 'homeTeamId' },
  { src: 'R16-8',  outcome: 'winner', dst: 'QF-4', side: 'awayTeamId' },
  // Quartas (QF) → Semifinais (SF)
  { src: 'QF-1',   outcome: 'winner', dst: 'SF-1',  side: 'homeTeamId' },
  { src: 'QF-2',   outcome: 'winner', dst: 'SF-1',  side: 'awayTeamId' },
  { src: 'QF-3',   outcome: 'winner', dst: 'SF-2',  side: 'homeTeamId' },
  { src: 'QF-4',   outcome: 'winner', dst: 'SF-2',  side: 'awayTeamId' },
  // Semifinais → Final + 3º Lugar
  { src: 'SF-1',   outcome: 'winner', dst: 'FINAL', side: 'homeTeamId' },
  { src: 'SF-2',   outcome: 'winner', dst: 'FINAL', side: 'awayTeamId' },
  { src: 'SF-1',   outcome: 'loser',  dst: 'THIRD', side: 'homeTeamId' },
  { src: 'SF-2',   outcome: 'loser',  dst: 'THIRD', side: 'awayTeamId' },
];

const initialMatches = Object.fromEntries(ALL_MATCHES.map(m => [m.id, { ...m }]));

export const useTournamentStore = create<TournamentState>()(
  persist(
    (set, get) => ({
      matches: initialMatches,

      setResult: (matchId, homeScore, awayScore, homePenalties, awayPenalties, onError) => {
        // 1. Atualiza estado local imediatamente (síncrono — UI responde na hora)
        set(state => ({
          matches: {
            ...state.matches,
            [matchId]: {
              ...state.matches[matchId],
              homeScore,
              awayScore,
              homePenalties: homePenalties ?? null,
              awayPenalties: awayPenalties ?? null,
              played: true,
            },
          },
        }));

        // 1b. Auto-popula chaveamento (qualquer fase)
        get().autoPopulateKnockout();

        // 2. Persiste no Supabase em background (não bloqueia a UI)
        // A op vai pra outbox em localStorage — se a aba fechar antes do retry
        // terminar, a sincronização acontece no próximo boot.
        if (isSupabaseConfigured) {
          persistOp(
            {
              kind: 'upsert',
              table: 'match_results',
              payload: {
                match_id:       matchId,
                home_score:     homeScore,
                away_score:     awayScore,
                home_penalties: homePenalties ?? null,
                away_penalties: awayPenalties ?? null,
              },
              onConflict: 'match_id',
              label: `setResult:${matchId}`,
            },
            { onError }
          );
        }

        return { error: null };
      },

      setKnockoutTeams: (matchId, homeTeamId, awayTeamId, onError) => {
        set(state => ({
          matches: {
            ...state.matches,
            [matchId]: { ...state.matches[matchId], homeTeamId, awayTeamId },
          },
        }));

        // Persiste os times no Supabase para sincronizar entre devices
        if (isSupabaseConfigured) {
          persistOp(
            {
              kind: 'upsert',
              table: 'match_results',
              payload: {
                match_id:     matchId,
                home_team_id: homeTeamId ?? null,
                away_team_id: awayTeamId ?? null,
              },
              onConflict: 'match_id',
              label: `setKnockoutTeams:${matchId}`,
            },
            { onError }
          );
        }
      },

      resetMatch: (matchId, onError) => {
        // Reseta localmente (síncrono — UI responde na hora)
        set(state => ({
          matches: {
            ...state.matches,
            [matchId]: {
              ...state.matches[matchId],
              homeScore: null,
              awayScore: null,
              homePenalties: null,
              awayPenalties: null,
              played: false,
            },
          },
        }));

        // Recalcula chaveamento após reset
        get().autoPopulateKnockout();

        // Remove do Supabase em background
        if (isSupabaseConfigured) {
          persistOp(
            {
              kind: 'delete',
              table: 'match_results',
              match: { column: 'match_id', value: matchId },
              label: `resetMatch:${matchId}`,
            },
            { onError }
          );
        }
      },

      getGroupStandings: (group) => computeStandings(group, get().matches),

      // ── Auto-popula R32 com os classificados dos grupos ──────────────────
      autoPopulateKnockout: () => {
        const { matches, getGroupStandings } = get();

        // Descobre quais grupos estão com todos os 6 jogos encerrados
        const groupComplete: Record<string, boolean> = {};
        GROUPS.forEach(g => {
          const gm = Object.values(matches).filter(m => m.stage === 'group' && m.group === g);
          groupComplete[g] = gm.length === 6 && gm.every(m => m.played);
        });

        // Classificação de cada grupo completo
        const standings: Record<string, GroupStanding[]> = {};
        GROUPS.filter(g => groupComplete[g]).forEach(g => {
          standings[g] = getGroupStandings(g);
        });

        const updatedMatches = { ...matches };
        let changed = false;

        const assign = (matchId: string, side: 'homeTeamId' | 'awayTeamId', teamId: string | null) => {
          if (teamId && updatedMatches[matchId] && updatedMatches[matchId][side] !== teamId) {
            updatedMatches[matchId] = { ...updatedMatches[matchId], [side]: teamId };
            changed = true;
          }
        };

        // Mapeamento 1º/2º lugar → partida R32 (rank 0 = 1º, rank 1 = 2º)
        const direct: Array<{ matchId: string; side: 'homeTeamId' | 'awayTeamId'; rank: 0 | 1; group: string }> = [
          { matchId: 'R32-1',  side: 'homeTeamId', rank: 1, group: 'A' },
          { matchId: 'R32-1',  side: 'awayTeamId', rank: 1, group: 'B' },
          { matchId: 'R32-2',  side: 'homeTeamId', rank: 0, group: 'E' },
          { matchId: 'R32-3',  side: 'homeTeamId', rank: 0, group: 'F' },
          { matchId: 'R32-3',  side: 'awayTeamId', rank: 1, group: 'C' },
          { matchId: 'R32-4',  side: 'homeTeamId', rank: 0, group: 'C' },
          { matchId: 'R32-4',  side: 'awayTeamId', rank: 1, group: 'F' },
          { matchId: 'R32-5',  side: 'homeTeamId', rank: 0, group: 'I' },
          { matchId: 'R32-6',  side: 'homeTeamId', rank: 1, group: 'E' },
          { matchId: 'R32-6',  side: 'awayTeamId', rank: 1, group: 'I' },
          { matchId: 'R32-7',  side: 'homeTeamId', rank: 0, group: 'A' },
          { matchId: 'R32-8',  side: 'homeTeamId', rank: 0, group: 'L' },
          { matchId: 'R32-9',  side: 'homeTeamId', rank: 0, group: 'D' },
          { matchId: 'R32-10', side: 'homeTeamId', rank: 0, group: 'G' },
          { matchId: 'R32-11', side: 'homeTeamId', rank: 1, group: 'K' },
          { matchId: 'R32-11', side: 'awayTeamId', rank: 1, group: 'L' },
          { matchId: 'R32-12', side: 'homeTeamId', rank: 0, group: 'H' },
          { matchId: 'R32-12', side: 'awayTeamId', rank: 1, group: 'J' },
          { matchId: 'R32-13', side: 'homeTeamId', rank: 0, group: 'B' },
          { matchId: 'R32-14', side: 'homeTeamId', rank: 0, group: 'J' },
          { matchId: 'R32-14', side: 'awayTeamId', rank: 1, group: 'H' },
          { matchId: 'R32-15', side: 'homeTeamId', rank: 0, group: 'K' },
          { matchId: 'R32-16', side: 'homeTeamId', rank: 1, group: 'D' },
          { matchId: 'R32-16', side: 'awayTeamId', rank: 1, group: 'G' },
        ];

        direct.forEach(({ matchId, side, rank, group }) => {
          if (!groupComplete[group]) return;
          assign(matchId, side, standings[group]?.[rank]?.teamId ?? null);
        });

        // 3ºs lugares — só quando todos os 12 grupos estiverem concluídos
        if (GROUPS.every(g => groupComplete[g])) {
          const allThird = GROUPS.map(g => ({
            group: g,
            teamId:  standings[g]?.[2]?.teamId  ?? null,
            points:  standings[g]?.[2]?.points   ?? 0,
            gd:      standings[g]?.[2]?.goalDifference ?? 0,
            gf:      standings[g]?.[2]?.goalsFor ?? 0,
          })).filter(t => t.teamId !== null);

          const ranked = [...allThird].sort((a, b) =>
            b.points - a.points || b.gd - a.gd || b.gf - a.gf
          );
          const qualified = ranked.slice(0, 8);

          // Cada slot '3ª XYZ' tem grupos elegíveis (conforme tabela FIFA)
          const thirdSlots: Array<{ matchId: string; eligible: string[] }> = [
            { matchId: 'R32-2',  eligible: ['A','B','C','D','F'] },
            { matchId: 'R32-5',  eligible: ['C','D','F','G','H'] },
            { matchId: 'R32-7',  eligible: ['C','E','F','H','I'] },
            { matchId: 'R32-8',  eligible: ['E','H','I','J','K'] },
            { matchId: 'R32-9',  eligible: ['B','E','F','I','J'] },
            { matchId: 'R32-10', eligible: ['A','E','H','I','J'] },
            { matchId: 'R32-13', eligible: ['E','F','G','I','J'] },
            { matchId: 'R32-15', eligible: ['D','E','I','J','L'] },
          ];

          // Backtracking para garantir que todos os 8 slots sejam preenchidos.
          // O greedy falha quando escolhas iniciais bloqueiam slots posteriores.
          const thirdMatching = new Map<string, string>();
          function findThirdMatching(idx: number, used: Set<string>): boolean {
            if (idx === thirdSlots.length) return true;
            const { matchId, eligible } = thirdSlots[idx];
            for (const team of qualified) {
              if (!team.teamId || !eligible.includes(team.group) || used.has(team.group)) continue;
              used.add(team.group);
              thirdMatching.set(matchId, team.teamId);
              if (findThirdMatching(idx + 1, used)) return true;
              used.delete(team.group);
              thirdMatching.delete(matchId);
            }
            return false;
          }
          findThirdMatching(0, new Set<string>());
          thirdMatching.forEach((teamId, matchId) => assign(matchId, 'awayTeamId', teamId));
        }

        // ── Propaga vencedores/perdedores entre todas as fases eliminatórias ──
        KNOCKOUT_PROPAGATION.forEach(({ src, outcome, dst, side }) => {
          const srcMatch = updatedMatches[src];
          if (!srcMatch) return;
          const teamId = outcome === 'winner' ? getMatchWinner(srcMatch) : getMatchLoser(srcMatch);
          assign(dst, side, teamId);
        });

        if (changed) set({ matches: updatedMatches });
      },

      getAllThirdPlace: () => {
        return GROUPS.map(g => {
          const standings = computeStandings(g, get().matches);
          return standings[2] ? { ...standings[2], group: g } : null;
        }).filter(Boolean) as (GroupStanding & { group: string })[];
      },

      syncFromSupabase: async () => {
        if (!isSupabaseConfigured) return;

        // Retry até 3× com backoff — necessário quando o Supabase (free tier) acorda do sleep
        for (let attempt = 1; attempt <= 3; attempt++) {
          // 15s na 1ª tentativa, 25s nas retentativas — cobre cold start do free tier.
          const timeoutMs = attempt === 1 ? 15000 : 25000;
          const { data, error } = await sq(() => supabase.from('match_results').select('*'), timeoutMs);

          if (error) {
            console.warn(`[tournamentStore] syncFromSupabase tentativa ${attempt}/3:`, error.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }

          // Aplica resultados, times do mata-mata e limpa partidas resetadas no BD
          const rows = data ?? [];

          // Mapa indexado por match_id para lookup O(1)
          type DbRow = {
            match_id: string;
            home_score: number | null;
            away_score: number | null;
            home_penalties: number | null;
            away_penalties: number | null;
            home_team_id: string | null;
            away_team_id: string | null;
          };
          const dbMap = new Map<string, DbRow>(
            rows.map((r: DbRow) => [r.match_id, r])
          );

          set(state => {
            const updated = { ...state.matches };

            // 1. Aplica scores e times vindos do BD
            dbMap.forEach((r, matchId) => {
              if (!updated[matchId]) return;
              const patch: Partial<typeof updated[string]> = {};

              // Scores (só aplica se ambos presentes)
              if (r.home_score !== null && r.away_score !== null) {
                patch.homeScore     = r.home_score;
                patch.awayScore     = r.away_score;
                patch.homePenalties = r.home_penalties;
                patch.awayPenalties = r.away_penalties;
                patch.played        = true;
              }

              // Times do mata-mata (persiste override do admin)
              if (r.home_team_id) patch.homeTeamId = r.home_team_id;
              if (r.away_team_id) patch.awayTeamId = r.away_team_id;

              updated[matchId] = { ...updated[matchId], ...patch };
            });

            // 2. Zera resultados locais ausentes no BD sem op pendente na outbox.
            //
            // Distingue dois cenários para match com resultado local mas sem
            // linha no BD:
            //   • hasPendingOutboxOpForMatch = true  → escrita ainda em voo
            //     (admin acabou de lançar, retry em andamento) → preserva local
            //   • hasPendingOutboxOpForMatch = false → resultado foi deletado
            //     diretamente no BD (ex: admin limpou) → zera local
            //
            // Antes zerávamos via "ausência no BD" sem essa verificação, o que
            // causava perda de placares recém marcados quando o sync rodava
            // antes do retry da outbox completar. Agora o outbox é consultado
            // como árbitro antes de zerar.
            Object.keys(updated).forEach(matchId => {
              const local = updated[matchId];
              if (local.played && !dbMap.has(matchId) && !hasPendingOutboxOpForMatch(matchId)) {
                updated[matchId] = {
                  ...local,
                  homeScore:     null,
                  awayScore:     null,
                  homePenalties: null,
                  awayPenalties: null,
                  played:        false,
                };
              }
            });

            return { matches: updated };
          });

          // Auto-popula chaveamento com os dados sincronizados
          get().autoPopulateKnockout();
          return; // sucesso — sai do loop
        }

        console.error('[tournamentStore] syncFromSupabase falhou após 3 tentativas');
      },
    }),
    {
      name: 'bolao-tournament-v2',
      version: 2,
      migrate: (persisted, version): TournamentState => {
        // version < 1 = cache gerado antes do sistema de versioning.
        if (version < 1) return { matches: initialMatches } as unknown as TournamentState;
        return persisted as unknown as TournamentState;
      },
      // Merge custom: a metadata estática (date, time, venue, slots, teams de
      // grupo) vem SEMPRE de matches.ts (fonte da verdade). Apenas os campos
      // voláteis (scores, knockout teams atribuídos) são preservados do cache.
      // Isso garante que editar matches.ts (corrigir horário, adicionar venue)
      // se reflete em usuários antigos sem precisar bumpar a versão e descartar
      // os placares já marcados.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<TournamentState> | undefined;
        const cached = persisted?.matches ?? {};
        const merged: Record<string, Match> = {};
        Object.keys(initialMatches).forEach(id => {
          const init = initialMatches[id];
          const c = cached[id];
          if (!c) {
            merged[id] = init;
            return;
          }
          const isGroup = init.stage === 'group';
          merged[id] = {
            ...init, // base estática (date, time, venue, slot labels…)
            // Campos voláteis: cache vence
            homeScore:     c.homeScore ?? null,
            awayScore:     c.awayScore ?? null,
            homePenalties: c.homePenalties ?? null,
            awayPenalties: c.awayPenalties ?? null,
            played:        c.played ?? false,
            // Times: para grupos, init é fonte da verdade (são fixos no draw);
            // para knockout, cache vence (autoPopulateKnockout / admin override)
            homeTeamId: isGroup ? init.homeTeamId : (c.homeTeamId ?? init.homeTeamId ?? null),
            awayTeamId: isGroup ? init.awayTeamId : (c.awayTeamId ?? init.awayTeamId ?? null),
          };
        });
        return { ...currentState, matches: merged };
      },
      // Persiste apenas campos voláteis (~70% menos dados no localStorage).
      // A metadata estática (date, time, venue, slot labels) é sempre
      // reconstituída do initialMatches pela função `merge` acima.
      // `as unknown as TournamentState`: Zustand espera que partialize retorne
      // o estado completo; usamos cast porque o `merge` custom reconstrói os
      // campos estáticos a partir de initialMatches no momento da reidratação.
      partialize: (s) => ({
        matches: Object.fromEntries(
          Object.entries(s.matches).map(([id, m]) => [id, {
            homeScore:     m.homeScore,
            awayScore:     m.awayScore,
            homePenalties: m.homePenalties,
            awayPenalties: m.awayPenalties,
            played:        m.played,
            // Times de grupo são fixos no draw — não precisam persistir
            homeTeamId: m.stage === 'group' ? undefined : m.homeTeamId,
            awayTeamId: m.stage === 'group' ? undefined : m.awayTeamId,
          }])
        ),
      }) as unknown as TournamentState,
    }
  )
);
