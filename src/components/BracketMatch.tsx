import { MatchCard } from './MatchCard';
import type { Match } from '../types';

interface Props {
  match: Match;
  label?: string;
}

export function BracketMatch({ match, label }: Props) {
  return (
    <div className="min-w-[180px]">
      {label && <p className="text-xs text-gray-500 text-center mb-1">{label}</p>}
      <MatchCard match={match} showBet={true} />
    </div>
  );
}
