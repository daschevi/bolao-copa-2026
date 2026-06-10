import { useState } from 'react';
import {
  usePhaseSettingsStore,
  STAGE_KEYS, STAGE_DISPLAY,
  type StageKey, type PhaseConfig,
} from '../store/phaseSettingsStore';
import { useTournamentStore } from '../store/tournamentStore';

interface Props { onClose: () => void }

/**
 * Converte o valor salvo de betsDeadline para o formato que o
 * `<input type="datetime-local">` exige: `YYYY-MM-DDTHH:mm` (sem segundos,
 * sem fuso), sempre no horário de Brasília.
 *
 * Necessário porque o banco devolve o ISO completo (`2026-06-10T23:59:00-03:00`)
 * — formato que o input NÃO renderiza, deixando o campo em branco mesmo com
 * valor salvo. Aceita os dois casos:
 *   • Com fuso (Z ou ±HH:mm)  → converte o instante para BRT e formata curto.
 *   • Sem fuso (formato curto) → usa os 16 primeiros chars direto.
 */
function toDatetimeLocal(s: string | null): string {
  if (!s) return '';
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) return s.slice(0, 16); // já é local curto (BRT)

  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 16);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function PhaseSettingsModal({ onClose }: Props) {
  const { phases, updatePhase, savePhaseSettings, syncPhaseSettings } = usePhaseSettingsStore();
  const syncFromSupabase = useTournamentStore(s => s.syncFromSupabase);

  // Rascunho local — só aplica ao store ao clicar em "Salvar"
  const [draft, setDraft] = useState<Record<StageKey, PhaseConfig>>(
    () => JSON.parse(JSON.stringify(phases))
  );
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved]       = useState(false);

  const patch = (stage: StageKey, cfg: Partial<PhaseConfig>) =>
    setDraft(d => ({ ...d, [stage]: { ...d[stage], ...cfg } }));

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    STAGE_KEYS.forEach(stage => updatePhase(stage, draft[stage]));
    const { error } = await savePhaseSettings();
    setSaving(false);
    if (error) {
      setSaveError(error);
    } else {
      setSaved(true);
      // Re-busca imediatamente após salvar para refletir nas outras páginas
      // sem precisar de logout/login. Roda em background — não bloqueia o fechamento.
      Promise.allSettled([syncPhaseSettings(), syncFromSupabase()]);
      setTimeout(onClose, 900);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 shrink-0">
          <h2
            className="font-black text-white text-lg uppercase"
            style={{ fontStyle: 'italic' }}
          >
            ⚙️ Configurar Fases
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none"
          >✕</button>
        </div>

        {/* Rows */}
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {STAGE_KEYS.map(stage => (
            <PhaseRow
              key={stage}
              label={STAGE_DISPLAY[stage]}
              stage={stage}
              config={draft[stage]}
              onChange={cfg => patch(stage, cfg)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="mt-5 pt-4 shrink-0" style={{ borderTop: '1px solid #1F1F1F' }}>
          {saveError && (
            <div
              className="mb-3 text-xs text-center rounded-lg px-3 py-2"
              style={{ background: '#EF444418', border: '1px solid #EF444440', color: '#FCA5A5' }}
            >
              ⚠️ {saveError}
              {/tempo limite/i.test(saveError) && (
                <p className="mt-1 opacity-70">
                  O servidor pode estar iniciando (free tier). Aguarde alguns segundos e tente novamente.
                </p>
              )}
              {/row-level security|permission denied/i.test(saveError) && (
                <p className="mt-1 opacity-70">
                  Sem permissão de escrita. Verifique se seu usuário tem <code>is_admin = true</code> na tabela profiles.
                </p>
              )}
              {/relation .* does not exist|table .* does not exist/i.test(saveError) && (
                <p className="mt-1 opacity-70">
                  Tabela <code>phase_settings</code> não encontrada — execute o SQL de criação no Supabase.
                </p>
              )}
            </div>
          )}
          {saved && (
            <p className="mb-3 text-xs text-center text-copa-green">✓ Configurações salvas!</p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar Configurações'}
            </button>
          </div>
          <p className="mt-3 text-[10px] text-gray-600 text-center leading-relaxed">
            Persiste em <code>phase_settings</code> no Supabase · 3 tentativas automáticas em caso de falha.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Linha de uma fase ─────────────────────────────────────────────────────────

function PhaseRow({
  stage, label, config, onChange,
}: {
  stage: StageKey;
  label: string;
  config: PhaseConfig;
  onChange: (cfg: Partial<PhaseConfig>) => void;
}) {
  const hasCustomDeadline = config.betsDeadline !== null;

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: '#111', border: '1px solid #222' }}
    >
      {/* Nome + toggle visível */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-white">{label}</span>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs" style={{ color: config.visible ? '#8300ff' : '#6B7280' }}>
            {config.visible ? 'Visível' : 'Oculta'}
          </span>
          <div
            className="relative w-10 h-6 rounded-full transition-colors cursor-pointer"
            style={{ background: config.visible ? '#8300ff' : '#374151' }}
            onClick={() => onChange({ visible: !config.visible })}
          >
            <div
              className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
              style={{ left: config.visible ? '22px' : '2px' }}
            />
          </div>
        </label>
      </div>

      {/* Prazo de palpites */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Prazo para palpites:</p>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={`dl-${stage}`}
              checked={!hasCustomDeadline}
              onChange={() => onChange({ betsDeadline: null })}
              className="accent-copa-green"
            />
            <span className="text-xs text-gray-300">Automático — 3 dias antes de cada jogo</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={`dl-${stage}`}
              checked={hasCustomDeadline}
              onChange={() => onChange({ betsDeadline: config.betsDeadline ?? '' })}
              className="accent-copa-green"
            />
            <span className="text-xs text-gray-300">Data e hora fixas (horário de Brasília)</span>
          </label>
        </div>

        {hasCustomDeadline && (
          <input
            type="datetime-local"
            value={toDatetimeLocal(config.betsDeadline)}
            onChange={e => onChange({ betsDeadline: e.target.value || null })}
            className="input text-xs mt-1"
          />
        )}
      </div>
    </div>
  );
}
