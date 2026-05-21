import { MatchCard } from './MatchCard';
import type { Match } from '../types';

interface Props {
  match: Match;
}

export function BracketMatch({ match }: Props) {
  return (
    <div className="min-w-[180px]">
      <MatchCard match={match} showBet={true} />
    </div>
  );
}
