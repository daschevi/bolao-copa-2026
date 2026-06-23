import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, sq, markServerActive } from '../lib/supabase';

// ── Tipos ────────────────────────────────────────────────────────────────────

export const STAGE_KEYS = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'] as const;
export type StageKey = typeof STAGE_KEYS[number];

export const STAGE_DISPLAY: Record<StageKey, string> = {
  group: 'Fase de Grupos',
  r32:   'Segunda Fase',
  r16:   'Oitavas de Final',
  qf:    'Quartas de Final',
  sf:    'Semifinais',
  third: 'Disputa do 3º Lugar',
  final: 'Final',
};

/**
 * Modo de prazo de palpite de uma fase:
 *   'auto3d' → 3 dias antes de cada jogo (kickoff − 3 dias) — padrão
 *   'auto1h' → 1 hora antes de cada jogo (kickoff − 1 hora)
 *   'fixed'  → data/hora fixa (betsDeadline), limitada ao kickoff
 */
export type DeadlineMode = 'auto3d' | 'auto1h' | 'fixed';

export interface PhaseConfig {
  visible: boolean;
  /** 'YYYY-MM-DDTHH:mm' em horário de Brasília (BRT). Só usado quando deadlineMode = 'fixed'. */
  betsDeadline: string | null;
  /** Modo do prazo. Opcional para retrocompat com cache/linhas antigas — use resolveDeadlineMode. */
  deadlineMode?: DeadlineMode;
}

/**
 * Resolve o modo de prazo, derivando para dados legados (sem deadlineMode):
 * betsDeadline preenchido → 'fixed'; vazio → 'auto3d'. Mantém cliente, store e
 * trigger do servidor com a MESMA interpretação.
 */
export function resolveDeadlineMode(cfg: { deadlineMode?: DeadlineMode; betsDeadline: string | null }): DeadlineMode {
  if (cfg.deadlineMode) return cfg.deadlineMode;
  return cfg.betsDeadline != null ? 'fixed' : 'auto3d';
}

// ── Estado inicial (tudo visível, prazo automático) ──────────────────────────

const INITIAL_PHASES: Record<StageKey, PhaseConfig> = Object.fromEntries(
  STAGE_KEYS.map(k => [k, { visible: true, betsDeadline: null }])
) as Record<StageKey, PhaseConfig>;

// ── Interface do store ───────────────────────────────────────────────────────

interface PhaseSettingsState {
  phases: Record<StageKey, PhaseConfig>;
  /**
   * Atualiza config de uma fase APENAS LOCALMENTE — NÃO persiste no Supabase.
   *
   * Esta função é deliberadamente local-only para suportar o padrão "rascunho"
   * do PhaseSettingsModal: o admin edita várias fases e só clica em "Salvar"
   * uma vez, que dispara `savePhaseSettings()` para enviar tudo de uma vez.
   *
   * ⚠️ Se você chamar `updatePhase` de um novo lugar, GARANTA que
   * `savePhaseSettings()` será chamado antes do componente desmontar — caso
   * contrário a mudança é perdida no próximo `syncPhaseSettings` (que vem do
   * BD e sobrescreve o estado local).
   */
  updatePhase: (stage: StageKey, cfg: Partial<PhaseConfig>) => void;
  /** Persiste todas as fases no Supabase. Chame após uma série de updatePhase. */
  savePhaseSettings: () => Promise<{ error: string | null }>;
  /** Busca configurações do Supabase e sobrescreve o estado local. */
  syncPhaseSettings: () => Promise<void>;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const usePhaseSettingsStore = create<PhaseSettingsState>()(
  persist(
    (set, get) => ({
      phases: INITIAL_PHASES,

      updatePhase: (stage, cfg) =>
        set(state => ({
          phases: { ...state.phases, [stage]: { ...state.phases[stage], ...cfg } },
        })),

      savePhaseSettings: async () => {
        if (!isSupabaseConfigured) return { error: null };

        const { phases } = get();
        // Normaliza `betsDeadline` para ISO BRT antes de enviar.
        // O input do admin (`<input type="datetime-local">`) produz
        // `'YYYY-MM-DDTHH:mm'` sem timezone — se enviarmos cru pra coluna
        // `timestamptz`, o Postgres interpreta como UTC e o admin que pensava
        // em 14:30 BRT acaba armazenando 14:30 UTC (= 11:30 BRT). Adicionando
        // `:00-03:00` explicitamos o fuso e o BD armazena o instante correto.
        const toIsoBrt = (s: string | null): string | null => {
          if (!s) return null;
          // Já tem timezone (caso a tela seja alimentada por ISO completo): mantém.
          if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
          return `${s.slice(0, 16)}:00-03:00`;
        };
        // includeMode=false é fallback p/ bancos sem a coluna deadline_mode
        // (migration 012 ainda não aplicada): mantém o save funcionando para
        // visível/fixo/auto-3d; só o modo 'auto1h' não persiste até migrar.
        const buildRows = (includeMode: boolean) => STAGE_KEYS.map(stage => {
          const cfg  = phases[stage];
          const mode = resolveDeadlineMode(cfg);
          const row: Record<string, unknown> = {
            stage,
            visible:       cfg.visible,
            // bets_deadline só faz sentido no modo 'fixed'; nos relativos vai null.
            bets_deadline: mode === 'fixed' ? toIsoBrt(cfg.betsDeadline) : null,
            updated_at:    new Date().toISOString(),
          };
          if (includeMode) row.deadline_mode = mode;
          return row;
        });

        let includeMode = true;
        let triedWithoutMode = false;
        let rows = buildRows(includeMode);

        // Retry até 3× com backoff — cobre cold start do Supabase free tier.
        // Usa Promise.race direto (não sq()) para capturar o objeto de erro completo
        // do Supabase (message + code + details + hint) e facilitar diagnóstico de
        // RLS, tabela inexistente ou outros problemas de banco.
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          // 10s na 1ª tentativa: erros de RLS/tabela voltam imediatamente.
          // 20s na 2ª/3ª: cobre cold start do free tier.
          const timeoutMs = attempt === 1 ? 10000 : 20000;
          try {
            type SupaErr = { message: string; code?: string; details?: string; hint?: string };
            const result = await Promise.race([
              supabase.from('phase_settings').upsert(rows, { onConflict: 'stage' }) as
                Promise<{ data: unknown; error: SupaErr | null }>,
              new Promise<{ data: null; error: SupaErr }>(r =>
                setTimeout(() => r({ data: null, error: { message: 'Tempo limite excedido. Verifique sua conexão.', code: 'TIMEOUT' } }), timeoutMs)
              ),
            ]);

            if (!result.error) {
              markServerActive();
              return { error: null };
            }

            const err = result.error;
            lastError = err.message;
            console.error(`[phaseSettings] savePhaseSettings tentativa ${attempt}/3:`, {
              message: err.message,
              code:    err.code,
              details: err.details,
              hint:    err.hint,
            });

            const lc = lastError.toLowerCase();

            // Coluna deadline_mode ausente (migration 012 pendente) → re-tenta sem ela.
            if (includeMode && !triedWithoutMode && lc.includes('deadline_mode')) {
              console.warn('[phaseSettings] coluna deadline_mode ausente — aplique a migration 012. Salvando sem o modo por ora (auto1h não persistirá).');
              includeMode = false;
              triedWithoutMode = true;
              rows = buildRows(false);
              continue; // re-tenta imediatamente sem a coluna
            }

            // Erros permanentes — re-tentar não vai resolver
            if (
              /row-level security|permission denied/.test(lc) ||
              /relation .* does not exist/.test(lc) ||
              /column .* does not exist/.test(lc) ||
              /pgrst204/.test(lc) ||
              err.code === '42501' || // permission denied (PostgreSQL)
              err.code === '42P01'    // undefined table (PostgreSQL)
            ) break;

          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            console.error(`[phaseSettings] savePhaseSettings exceção na tentativa ${attempt}/3:`, e);
            break; // exceção inesperada — não re-tenta
          }

          if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
        }

        console.error('[phaseSettings] savePhaseSettings falhou:', lastError);
        return { error: lastError ?? 'Erro desconhecido ao salvar.' };
      },

      syncPhaseSettings: async () => {
        if (!isSupabaseConfigured) return;

        for (let attempt = 1; attempt <= 3; attempt++) {
          // 15s na 1ª tentativa, 25s nas retentativas — cobre cold start do free tier.
          const timeoutMs = attempt === 1 ? 15000 : 25000;
          const { data, error } = await sq(
            () => supabase.from('phase_settings').select('*'),
            timeoutMs
          );

          if (error) {
            console.warn(`[phaseSettings] sync tentativa ${attempt}/3:`, error.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }

          if (!data?.length) return;

          set(state => {
            const phases = { ...state.phases };
            (data as { stage: string; visible: boolean; bets_deadline: string | null; deadline_mode?: string | null }[])
              .forEach(r => {
                if (STAGE_KEYS.includes(r.stage as StageKey)) {
                  phases[r.stage as StageKey] = {
                    visible:      r.visible,
                    betsDeadline: r.bets_deadline ?? null,
                    // deadline_mode pode vir undefined (coluna ainda não criada) → deriva.
                    deadlineMode: (r.deadline_mode as DeadlineMode | null | undefined)
                      ?? (r.bets_deadline ? 'fixed' : 'auto3d'),
                  };
                }
              });
            return { phases };
          });
          return;
        }

        console.error('[phaseSettings] syncPhaseSettings falhou após 3 tentativas');
      },
    }),
    { name: 'bolao-phase-settings', partialize: s => ({ phases: s.phases }) }
  )
);
