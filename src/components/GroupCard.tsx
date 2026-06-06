import { useTournamentStore } from '../store/tournamentStore';
import { TEAMS_BY_ID } from '../data/teams';
import { MatchCard } from './MatchCard';
import { Flag } from './Flag';
import type { Match } from '../types';

interface Props {
  group: string;
  matches: Match[];
}

export function GroupCard({ group, matches }: Props) {
  const { getGroupStandings } = useTournamentStore();
  const standings = getGroupStandings(group);

  return (
    <div className="card">
      <h2 className="text-copa-green font-bold text-lg mb-3">Grupo {group}</h2>

      {/* Standings table */}
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-slate-700">
              <th className="text-left pb-1 pr-2">#</th>
              <th className="text-left pb-1">Seleção</th>
              <th className="pb-1 px-1">J</th>
              <th className="pb-1 px-1">V</th>
              <th className="pb-1 px-1">E</th>
              <th className="pb-1 px-1">D</th>
              <th className="pb-1 px-1">SG</th>
              <th className="pb-1 px-1 font-bold text-white">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const team = TEAMS_BY_ID[s.teamId];
              const qualified = i < 2;
              return (
                <tr key={s.teamId} className={`border-b border-slate-800 ${qualified ? '' : 'opacity-70'}`}>
                  <td className="py-1 pr-2 text-gray-500">{i + 1}</td>
                  <td className="py-1 w-full max-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${i < 2 ? 'bg-copa-green' : i < 3 ? 'bg-copa-gold' : 'bg-transparent border border-gray-700'}`} />
                      {team && <Flag code={team.code} name={team.name} size="sm" />}
                      <span className="text-white text-xs truncate min-w-0" title={team?.name}>{team?.name}</span>
                    </div>
                  </td>
                  <td className="text-center py-1 px-1 text-gray-300">{s.played}</td>
                  <td className="text-center py-1 px-1 text-gray-300">{s.won}</td>
                  <td className="text-center py-1 px-1 text-gray-300">{s.drawn}</td>
                  <td className="text-center py-1 px-1 text-gray-300">{s.lost}</td>
                  <td className="text-center py-1 px-1 text-gray-300">{s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}</td>
                  <td className="text-center py-1 px-1 font-bold text-white">{s.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 flex gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-copa-green inline-block" /> Classificado</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-copa-gold inline-block" /> Possível 3º</span>
        </div>
      </div>

      {/* Matches */}
      <div className="grid gap-2">
        {matches.map(m => <MatchCard key={m.id} match={m} />)}
      </div>
    </div>
  );
}
