import { useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { useTournamentStore } from '../store/tournamentStore';
import { useAuthStore } from '../store/authStore';
import { usePhaseSettingsStore, type StageKey } from '../store/phaseSettingsStore';
import { usePageSync } from '../hooks/usePageSync';
import { TEAMS_BY_ID, TEAMS } from '../data/teams';
import type { Match } from '../types';

type KnockoutStage = 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

// Rótulos estilo ESPN — só apresentação, as chaves `stage` e os IDs não mudam.
const STAGE_LABEL_FULL: Record<KnockoutStage, string> = {
  r32:   '16 avos de final',
  r16:   'Oitavas de final',
  qf:    'Quartas de final',
  sf:    'Semifinais',
  final: 'Final',
  third: 'Disputa de 3º lugar',
};

// Abas (mobile) — uma rodada por vez, em ordem cronológica.
const TAB_STAGES: { id: KnockoutStage; label: string }[] = [
  { id: 'r32',   label: '16 avos' },
  { id: 'r16',   label: 'Oitavas' },
  { id: 'qf',    label: 'Quartas' },
  { id: 'sf',    label: 'Semis' },
  { id: 'third', label: '3º Lugar' },
  { id: 'final', label: 'Final' },
];

// Ordem vertical da árvore (derivada de KNOCKOUT_PROPAGATION por travessia a
// partir da Final). É embaralhada de propósito: assim cada confronto fica
// centrado entre os dois que o alimentam, sem cruzamento de linhas.
const R32_ORDER = ['R32-2','R32-5','R32-1','R32-3','R32-11','R32-12','R32-9','R32-10',
                   'R32-4','R32-6','R32-7','R32-8','R32-14','R32-16','R32-13','R32-15'];
const R16_ORDER = ['R16-1','R16-2','R16-5','R16-6','R16-3','R16-4','R16-7','R16-8'];
const QF_ORDER  = ['QF-1','QF-2','QF-3','QF-4'];
const SF_ORDER  = ['SF-1','SF-2'];
const FINAL_ORDER = ['FINAL'];

const ROUNDS: { stage: KnockoutStage; order: string[] }[] = [
  { stage: 'r32',   order: R32_ORDER },
  { stage: 'r16',   order: R16_ORDER },
  { stage: 'qf',    order: QF_ORDER },
  { stage: 'sf',    order: SF_ORDER },
  { stage: 'final', order: FINAL_ORDER },
];

// CSS da árvore: colunas flex; cada confronto numa célula flex:1 (divide a altura
// da coluna em partes iguais) e o nó centrado nela. Os "cotovelos" são desenhados
// com pseudo-elementos: a célula ímpar liga para baixo, a par para cima, juntando
// o par no ponto médio — que coincide com o centro do nó da rodada seguinte.
// --kcellh: altura mínima de cada célula (≈ altura do card); ajuste se os cards
// encostarem ou sobrar espaço demais.
const BRACKET_CSS = `
.kbracket { display: flex; align-items: stretch; width: max-content; --kline: #2A2A2A; --kcellh: 18rem; }
.kround { display: flex; flex-direction: column; margin-right: 3rem; }
.kround:last-child { margin-right: 0; }
.kround-body { display: flex; flex-direction: column; flex: 1 1 auto; }
.kcell { flex: 1 1 0; min-height: var(--kcellh); display: flex; align-items: center; position: relative; }
.knode { width: 13rem; }
.kround:not(:last-child) .kcell::after {
  content: ''; position: absolute; left: 13rem; width: 1.5rem; box-sizing: border-box;
}
.kround:not(:last-child) .kcell:nth-child(odd)::after  { top: 50%; height: 50%; border-right: 2px solid var(--kline); border-top: 2px solid var(--kline); }
.kround:not(:last-child) .kcell:nth-child(even)::after { top: 0;   height: 50%; border-right: 2px solid var(--kline); border-bottom: 2px solid var(--kline); }
.kround:not(:first-child) .kcell::before {
  content: ''; position: absolute; right: 100%; width: 1.5rem; top: 50%; border-top: 2px solid var(--kline);
}
`;

export function Knockout() {
  usePageSync({ phases: true });

  const matches          = useTournamentStore(s => s.matches);
  const setKnockoutTeams = useTournamentStore(s => s.setKnockoutTeams);
  const profile          = useAuthStore(s => s.profile);
  const isAdmin = profile?.isAdmin ?? false;
  const phases  = usePhaseSettingsStore(s => s.phases);

  const [activeStage, setActiveStage]   = useState<KnockoutStage>('r32');
  const [editMatch, setEditMatch]       = useState<string | null>(null);
  const [selectedHome, setSelectedHome] = useState('');
  const [selectedAway, setSelectedAway] = useState('');

  // Admin vê todas as fases; usuário comum só as visíveis.
  const stageVisible = (stage: KnockoutStage) =>
    isAdmin || phases[stage as StageKey]?.visible !== false;

  // Abas do mobile: só fases visíveis (admin vê todas, com 🔒).
  const tabs = useMemo(
    () => TAB_STAGES.filter(t => stageVisible(t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, phases],
  );
  const effectiveStage: KnockoutStage =
    tabs.find(t => t.id === activeStage) ? activeStage : (tabs[0]?.id ?? 'r32');

  const stageMatches = useMemo(
    () => Object.values(matches).filter(m => m.stage === effectiveStage),
    [matches, effectiveStage],
  );

  const winner = useMemo(() => {
    const final = Object.values(matches).find(m => m.stage === 'final');
    if (!final?.played || final.homeScore === null || final.awayScore === null) return null;
    if (final.homeScore > final.awayScore) return TEAMS_BY_ID[final.homeTeamId!];
    if (final.awayScore > final.homeScore) return TEAMS_BY_ID[final.awayTeamId!];
    if (final.homePenalties !== null && final.awayPenalties !== null) {
      return final.homePenalties! > final.awayPenalties! ? TEAMS_BY_ID[final.homeTeamId!] : TEAMS_BY_ID[final.awayTeamId!];
    }
    return null;
  }, [matches]);

  const openEdit = (m: Match) => {
    setEditMatch(m.id);
    setSelectedHome(m.homeTeamId ?? '');
    setSelectedAway(m.awayTeamId ?? '');
  };

  const handleSetTeams = () => {
    if (!editMatch) return;
    setKnockoutTeams(editMatch, selectedHome || null, selectedAway || null);
    setEditMatch(null);
  };

  // Nó da árvore/lista: o MatchCard existente (clique abre o modal de palpite),
  // restrito em largura. Fase oculta a usuário comum → card travado (🔒).
  //
  // É uma FUNÇÃO de render (não um componente) de propósito: como componente
  // definido dentro de Knockout, cada re-render criava um novo tipo e o React
  // remontava o MatchCard — zerando o estado `open` do modal (modal piscava e
  // fechava). Como função, o tipo retornado é sempre o MatchCard (estável), o
  // React reconcilia por posição/key e o modal permanece aberto.
  const renderNode = (matchId: string) => {
    const m = matches[matchId];
    if (!m) return null;
    const visible = stageVisible(m.stage as KnockoutStage);
    return (
      <div className="knode">
        {visible ? (
          <MatchCard match={m} showBet />
        ) : (
          <div className="card flex flex-col items-center justify-center gap-1 py-8">
            <div className="text-2xl">🔒</div>
            <div className="text-[10px] text-gray-500 text-center">Fase ainda não liberada</div>
          </div>
        )}
        {isAdmin && visible && (
          <button
            onClick={() => openEdit(m)}
            className="text-xs text-gray-600 hover:text-copa-green transition-colors w-full text-center py-0.5"
          >
            ✎ ajustar times
          </button>
        )}
      </div>
    );
  };

  const thirdMatch = matches['THIRD'];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <style>{BRACKET_CSS}</style>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-2xl font-black text-white uppercase" style={{ fontStyle: 'italic' }}>
          Fase Eliminatória ⚡
        </h1>
      </div>

      {winner && (
        <div className="card mb-6 text-center bg-gradient-to-r from-copa-navy to-slate-800 border-copa-gold">
          <div className="text-4xl mb-2">{winner.flag}</div>
          <div className="text-copa-gold font-bold text-xl">🏆 {winner.name} é o CAMPEÃO!</div>
        </div>
      )}

      {tabs.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
          <div className="text-5xl">🔒</div>
          <p className="text-gray-500 text-sm text-center">
            Nenhuma fase eliminatória disponível no momento.
          </p>
        </div>
      ) : (
        <>
          {/* ── Desktop (≥ lg): árvore conectada estilo ESPN ───────────────── */}
          <div className="hidden lg:block overflow-x-auto pb-4">
            <div className="kbracket">
              {ROUNDS.map(round => (
                <div key={round.stage} className="kround">
                  <div className="text-center text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#6B7280' }}>
                    {STAGE_LABEL_FULL[round.stage]}
                    {isAdmin && phases[round.stage as StageKey]?.visible === false && (
                      <span className="ml-1 opacity-60">🔒</span>
                    )}
                  </div>
                  <div className="kround-body">
                    {round.order.map(id => (
                      <div key={id} className="kcell">
                        {round.stage === 'final' ? (
                          // Final + disputa de 3º lugar empilhados na mesma célula
                          // (centrada na coluna) — o 3º fica logo abaixo da Final.
                          <div className="flex flex-col items-center gap-6">
                            {renderNode(id)}
                            {thirdMatch && stageVisible('third') && (
                              <div className="flex flex-col items-center gap-1">
                                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#6B7280' }}>
                                  {STAGE_LABEL_FULL.third}
                                  {isAdmin && phases.third?.visible === false && <span className="ml-1 opacity-60">🔒</span>}
                                </div>
                                {renderNode('THIRD')}
                              </div>
                            )}
                          </div>
                        ) : (
                          renderNode(id)
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Mobile (< lg): abas, uma rodada por vez ─────────────────────── */}
          <div className="lg:hidden">
            <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
              {tabs.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveStage(s.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${effectiveStage === s.id ? 'bg-copa-green text-white' : 'bg-slate-800 text-gray-400 hover:text-copa-green'}`}
                >
                  {s.label}
                  {isAdmin && phases[s.id as StageKey]?.visible === false && (
                    <span className="ml-1 text-[10px] opacity-60">🔒</span>
                  )}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stageMatches.map(m => (
                <div key={m.id} className="space-y-1">
                  <MatchCard match={m} showBet />
                  {isAdmin && (
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs text-gray-600 hover:text-copa-green transition-colors w-full text-center py-0.5"
                    >
                      ✎ ajustar times
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Modal de definição de times (admin) — inalterado */}
      {editMatch && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditMatch(null)}>
          <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-4">Definir times — {editMatch}</h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Time da casa</label>
                <select className="input" value={selectedHome} onChange={e => setSelectedHome(e.target.value)}>
                  <option value="">TBD</option>
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.flag} {t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Time visitante</label>
                <select className="input" value={selectedAway} onChange={e => setSelectedAway(e.target.value)}>
                  <option value="">TBD</option>
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.flag} {t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditMatch(null)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSetTeams} className="btn-primary flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
