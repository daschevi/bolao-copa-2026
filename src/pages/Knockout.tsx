import { useMemo, useState } from 'react';
import { BracketMatch } from '../components/BracketMatch';
import { useTournamentStore } from '../store/tournamentStore';
import { TEAMS_BY_ID, TEAMS } from '../data/teams';

type KnockoutStage = 'r32' | 'r16' | 'qf' | 'sf' | 'final';

const STAGES: { id: KnockoutStage; label: string }[] = [
  { id: 'r32', label: 'Oitavas' },
  { id: 'r16', label: 'Quartas' },
  { id: 'qf', label: 'Semifinal' },
  { id: 'sf', label: 'Semi / 3º' },
  { id: 'final', label: 'Final' },
];

export function Knockout() {
  const { matches, setKnockoutTeams } = useTournamentStore();
  const [activeStage, setActiveStage] = useState<KnockoutStage>('r32');
  const [editMatch, setEditMatch] = useState<string | null>(null);
  const [selectedHome, setSelectedHome] = useState('');
  const [selectedAway, setSelectedAway] = useState('');

  const stageMatches = useMemo(() => {
    if (activeStage === 'sf') {
      return Object.values(matches).filter(m => m.stage === 'sf' || m.stage === 'third');
    }
    if (activeStage === 'final') {
      return Object.values(matches).filter(m => m.stage === 'final');
    }
    return Object.values(matches).filter(m => m.stage === activeStage);
  }, [matches, activeStage]);

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
      <h1 className="text-2xl font-bold text-white mb-4">Fase Eliminatória</h1>

      {winner && (
        <div className="card mb-6 text-center bg-gradient-to-r from-copa-navy to-slate-800 border-copa-gold">
          <div className="text-4xl mb-2">{winner.flag}</div>
          <div className="text-copa-gold font-bold text-xl">🏆 {winner.name} é o CAMPEÃO!</div>
        </div>
      )}

      {/* Stage tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {STAGES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveStage(s.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${activeStage === s.id ? 'bg-copa-green text-white' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Admin: set teams for matches */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {stageMatches.map(m => (
          <div key={m.id} className="space-y-1">
            <BracketMatch match={m} label={m.id} />
            <button
              onClick={() => { setEditMatch(m.id); setSelectedHome(m.homeTeamId ?? ''); setSelectedAway(m.awayTeamId ?? ''); }}
              className="text-xs text-gray-500 hover:text-copa-green transition-colors w-full text-center"
            >
              Definir times
            </button>
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
    </div>
  );
}
