import { useMemo, useState } from 'react';
import { BracketMatch } from '../components/BracketMatch';
import { useTournamentStore } from '../store/tournamentStore';
import { useAuthStore } from '../store/authStore';
import { usePhaseSettingsStore, type StageKey } from '../store/phaseSettingsStore';
import { usePageSync } from '../hooks/usePageSync';
import { TEAMS_BY_ID, TEAMS } from '../data/teams';

type KnockoutStage = 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

const ALL_STAGES: { id: KnockoutStage; label: string }[] = [
  { id: 'r32',   label: 'Segunda Fase' },
  { id: 'r16',   label: 'Oitavas' },
  { id: 'qf',    label: 'Quartas' },
  { id: 'sf',    label: 'Semifinal' },
  { id: 'third', label: '3º Lugar' },
  { id: 'final', label: 'Final' },
];

export function Knockout() {
  usePageSync({ phases: true });

  // Seletores granulares: este componente só re-renderiza quando matches,
  // setKnockoutTeams, profile ou phases efetivamente mudam — não a cada `set`
  // arbitrário em qualquer um dos stores.
  const matches          = useTournamentStore(s => s.matches);
  const setKnockoutTeams = useTournamentStore(s => s.setKnockoutTeams);
  const profile          = useAuthStore(s => s.profile);
  const isAdmin = profile?.isAdmin ?? false;
  const phases  = usePhaseSettingsStore(s => s.phases);

  // Admin vê todas as abas; usuário comum só vê as fases visíveis
  const STAGES = useMemo(
    () => isAdmin ? ALL_STAGES : ALL_STAGES.filter(s => phases[s.id as StageKey]?.visible !== false),
    [isAdmin, phases]
  );

  const [activeStage, setActiveStage] = useState<KnockoutStage>('r32');
  const [editMatch, setEditMatch] = useState<string | null>(null);
  const [selectedHome, setSelectedHome] = useState('');
  const [selectedAway, setSelectedAway] = useState('');

  // Se o activeStage atual ficou oculto, muda para a primeira aba disponível
  const effectiveStage: KnockoutStage =
    STAGES.find(s => s.id === activeStage) ? activeStage : (STAGES[0]?.id ?? 'r32');

  const stageMatches = useMemo(() => {
    return Object.values(matches).filter(m => m.stage === effectiveStage);
  }, [matches, effectiveStage]);

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

  const handleSetTeams = () => {
    if (!editMatch) return;
    setKnockoutTeams(editMatch, selectedHome || null, selectedAway || null);
    setEditMatch(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
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

      {/* Stage tabs */}
      {STAGES.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
          <div className="text-5xl">🔒</div>
          <p className="text-gray-500 text-sm text-center">
            Nenhuma fase eliminatória disponível no momento.
          </p>
        </div>
      ) : (
      <>
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {STAGES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveStage(s.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${effectiveStage === s.id ? 'bg-copa-green text-white' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
          >
            {s.label}
            {isAdmin && phases[s.id as StageKey]?.visible === false && (
              <span className="ml-1 text-[10px] opacity-60">🔒</span>
            )}
          </button>
        ))}
      </div>

      {/* Admin: set teams for matches */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {stageMatches.map(m => (
          <div key={m.id} className="space-y-1">
            <BracketMatch match={m} />
            {isAdmin && (
              <button
                onClick={() => { setEditMatch(m.id); setSelectedHome(m.homeTeamId ?? ''); setSelectedAway(m.awayTeamId ?? ''); }}
                className="text-xs text-gray-600 hover:text-copa-green transition-colors w-full text-center py-0.5"
              >
                ✎ ajustar times
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Team assignment modal */}
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
      </>
      )}
    </div>
  );
}
