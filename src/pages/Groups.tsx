import { useMemo, useState } from 'react';
import { GroupCard } from '../components/GroupCard';
import { useTournamentStore } from '../store/tournamentStore';
import { GROUPS } from '../data/teams';

export function Groups() {
  const { matches } = useTournamentStore();
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const visibleGroups = useMemo(() => {
    return activeGroup ? [activeGroup] : GROUPS;
  }, [activeGroup]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-4">Fase de Grupos</h1>

      {/* Group filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setActiveGroup(null)}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${activeGroup === null ? 'bg-copa-green text-white' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
        >
          Todos
        </button>
        {GROUPS.map(g => (
          <button
            key={g}
            onClick={() => setActiveGroup(activeGroup === g ? null : g)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${activeGroup === g ? 'bg-copa-gold text-black' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
          >
            Grupo {g}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleGroups.map(group => {
          const groupMatches = Object.values(matches).filter(m => m.stage === 'group' && m.group === group);
          return <GroupCard key={group} group={group} matches={groupMatches} />;
        })}
      </div>
    </div>
  );
}
