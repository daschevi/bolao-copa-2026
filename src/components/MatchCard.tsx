import { useState } from 'react';
import type { Match } from '../types';
import { TEAMS_BY_ID } from '../data/teams';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { calcPoints } from '../types';

interface Props {
  match: Match;
  showBet?: boolean;
}

function TeamDisplay({ teamId, slot }: { teamId: string | null; slot?: string }) {
  const team = teamId ? TEAMS_BY_ID[teamId] : null;
  return (
    <div className="flex flex-col items-center gap-1 w-24">
      <span className="text-2xl">{team?.flag ?? '🏳️'}</span>
      <span className="text-xs text-center text-gray-300 font-medium leading-tight">
        {team?.shortName ?? slot ?? 'TBD'}
      </span>
    </div>
  );
}

export function MatchCard({ match, showBet = true }: Props) {
  const { profile } = useAuthStore();
  const { getBet, saveBet } = useBetsStore();
  const { setResult, resetMatch } = useTournamentStore();

  const [open, setOpen] = useState(false);
  const [betHome, setBetHome] = useState('');
  const [betAway, setBetAway] = useState('');
  const [resHome, setResHome] = useState('');
  const [resAway, setResAway] = useState('');
  const [penHome, setPenHome] = useState('');
  const [penAway, setPenAway] = useState('');
  const [tab, setTab] = useState<'bet' | 'result'>('bet');

  const userBet = profile ? getBet(profile.id, match.id) : undefined;
  const isPlayed = match.played && match.homeScore !== null;

  const betPoints = isPlayed && userBet ? calcPoints(userBet, match) : null;
  const pointsColor = betPoints === 3 ? 'text-green-400' : betPoints === 1 ? 'text-yellow-400' : betPoints === 0 && userBet ? 'text-red-400' : 'text-gray-500';

  const handleSaveBet = async () => {
    if (!profile || betHome === '' || betAway === '') return;
    await saveBet(profile.id, match.id, Number(betHome), Number(betAway));
    setOpen(false);
  };

  const handleSaveResult = async () => {
    if (resHome === '' || resAway === '') return;
    const isKnockout = match.stage !== 'group';
    const homeGoals = Number(resHome);
    const awayGoals = Number(resAway);
    const needsPens = isKnockout && homeGoals === awayGoals;
    await setResult(match.id, homeGoals, awayGoals, needsPens && penHome ? Number(penHome) : null, needsPens && penAway ? Number(penAway) : null);
    setOpen(false);
  };

  const stageLabel: Record<string, string> = { group: `Grupo ${match.group} · MD${match.matchDay}`, r32: 'Oitavas', r16: 'Quartas', qf: 'Semifinal', sf: 'Semifinal', third: '3º Lugar', final: 'Final' };

  return (
    <>
      <button
        onClick={() => {
          setBetHome(userBet?.homeScore?.toString() ?? '');
          setBetAway(userBet?.awayScore?.toString() ?? '');
          setResHome(match.homeScore?.toString() ?? '');
          setResAway(match.awayScore?.toString() ?? '');
          setOpen(true);
        }}
        className="card hover:border-copa-green transition-colors w-full text-left"
      >
        <div className="text-xs text-gray-500 mb-2 text-center">{stageLabel[match.stage] ?? match.stage}</div>
        <div className="flex items-center justify-between gap-2">
          <TeamDisplay teamId={match.homeTeamId} slot={match.homeFromSlot} />
          <div className="flex flex-col items-center gap-1">
            {isPlayed ? (
              <div className="text-xl font-bold text-white">{match.homeScore} — {match.awayScore}</div>
            ) : (
              <div className="text-sm text-gray-500">vs</div>
            )}
            {showBet && userBet && (
              <div className={`text-xs font-semibold ${pointsColor}`}>
                Palpite: {userBet.homeScore}×{userBet.awayScore}
                {betPoints !== null && ` · ${betPoints}pt`}
              </div>
            )}
          </div>
          <TeamDisplay teamId={match.awayTeamId} slot={match.awayFromSlot} />
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{stageLabel[match.stage]}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="flex items-center justify-around mb-4">
              <TeamDisplay teamId={match.homeTeamId} slot={match.homeFromSlot} />
              {isPlayed && <div className="font-bold text-white text-lg">{match.homeScore} — {match.awayScore}</div>}
              <TeamDisplay teamId={match.awayTeamId} slot={match.awayFromSlot} />
            </div>

            {profile?.isAdmin && (
              <div className="flex mb-3 rounded-lg overflow-hidden border border-slate-600">
                <button onClick={() => setTab('bet')} className={`flex-1 py-1.5 text-sm font-medium transition-colors ${tab === 'bet' ? 'bg-copa-green text-white' : 'text-gray-400 hover:text-white'}`}>Meu Palpite</button>
                <button onClick={() => setTab('result')} className={`flex-1 py-1.5 text-sm font-medium transition-colors ${tab === 'result' ? 'bg-copa-red text-white' : 'text-gray-400 hover:text-white'}`}>Resultado Oficial</button>
              </div>
            )}

            {(tab === 'bet' || !profile?.isAdmin) && profile && (
              <div>
                <p className="text-sm text-gray-400 mb-2">Seu palpite para o placar:</p>
                <div className="flex items-center gap-3 justify-center mb-3">
                  <input type="number" min={0} max={20} className="score-input" placeholder="0" value={betHome} onChange={e => setBetHome(e.target.value)} />
                  <span className="text-gray-400 font-bold">×</span>
                  <input type="number" min={0} max={20} className="score-input" placeholder="0" value={betAway} onChange={e => setBetAway(e.target.value)} />
                </div>
                <button onClick={handleSaveBet} className="btn-primary w-full">Salvar Palpite</button>
              </div>
            )}

            {tab === 'result' && profile?.isAdmin && (
              <div>
                <p className="text-sm text-gray-400 mb-2">Resultado oficial do jogo:</p>
                <div className="flex items-center gap-3 justify-center mb-2">
                  <input type="number" min={0} max={20} className="score-input" placeholder="0" value={resHome} onChange={e => setResHome(e.target.value)} />
                  <span className="text-gray-400 font-bold">×</span>
                  <input type="number" min={0} max={20} className="score-input" placeholder="0" value={resAway} onChange={e => setResAway(e.target.value)} />
                </div>
                {match.stage !== 'group' && resHome !== '' && resAway !== '' && Number(resHome) === Number(resAway) && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Pênaltis:</p>
                    <div className="flex items-center gap-3 justify-center">
                      <input type="number" min={0} className="score-input" placeholder="0" value={penHome} onChange={e => setPenHome(e.target.value)} />
                      <span className="text-gray-400">×</span>
                      <input type="number" min={0} className="score-input" placeholder="0" value={penAway} onChange={e => setPenAway(e.target.value)} />
                    </div>
                  </div>
                )}
                <button onClick={handleSaveResult} className="mt-3 w-full bg-copa-red hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors">Salvar Resultado</button>
                {isPlayed && (
                  <button onClick={() => { resetMatch(match.id); setOpen(false); }} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors">Resetar resultado</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
