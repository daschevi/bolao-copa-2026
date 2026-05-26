import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, isSupabaseConfigured, sq } from '../lib/supabase';

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

export interface PhaseConfig {
  visible: boolean;
  /** 'YYYY-MM-DDTHH:mm' em horário de Brasília (BRT). null = automático (3 dias antes de cada jogo). */
  betsDeadline: string | null;
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
        const rows = STAGE_KEYS.map(stage => ({
          stage,
          visible:       phases[stage].visible,
          bets_deadline: phases[stage].betsDeadline ?? null,
          updated_at:    new Date().toISOString(),
        }));

        // Retry até 3× com backoff — cobre cold start do Supabase free tier
        // (free tier dorme após inatividade; o 1º request pode levar >12s para acordar).
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          // Timeouts progressivos: 1ª tentativa generosa para cobrir cold start
          const timeoutMs = attempt === 1 ? 20000 : 30000;
          const { error } = await sq(
            () => supabase.from('phase_settings').upsert(rows, { onConflict: 'stage' }),
            timeoutMs
          );

          if (!error) return { error: null };

          lastError = error.message;
          console.warn(`[phaseSettings] savePhaseSettings tentativa ${attempt}/3:`, lastError);

          // Erro permanente: re-tentar não vai resolver — aborta já
          const lc = lastError.toLowerCase();
          if (
            /row-level security/.test(lc)  ||
            /relation .* does not exist/.test(lc) ||
            /column .* does not exist/.test(lc) ||
            /pgrst204/.test(lc)
          ) break;

          if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
        }

        console.error('[phaseSettings] savePhaseSettings falhou após 3 tentativas:', lastError);
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
            (data as { stage: string; visible: boolean; bets_deadline: string | null }[])
              .forEach(r => {
                if (STAGE_KEYS.includes(r.stage as StageKey)) {
                  phases[r.stage as StageKey] = {
                    visible:      r.visible,
                    betsDeadline: r.bets_deadline ?? null,
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
