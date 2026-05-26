import { useState } from 'react';
import type { Match } from '../types';
import { TEAMS_BY_ID } from '../data/teams';
import { formatMatchDate } from '../data/matches';
import { useAuthStore } from '../store/authStore';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { usePhaseSettingsStore, type StageKey } from '../store/phaseSettingsStore';
import { calcPoints } from '../types';
import { Flag } from './Flag';

interface Props {
  match: Match;
  showBet?: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  group: 'Grupos', r32: 'Segunda Fase', r16: 'Oitavas de Final', qf: 'Quartas de Final', sf: 'Semifinal', third: '3º Lugar', final: 'Final',
};

const BET_DEADLINE_DAYS = 3;

/**
 * Retorna true se o prazo de palpite ainda está aberto.
 * Se a fase tiver prazo fixo (phaseDeadline), usa ele; caso contrário usa 3 dias antes do jogo.
 */
function isBetOpen(match: Match, phaseDeadline: string | null): boolean {
  if (phaseDeadline !== null) {
    if (!phaseDeadline) return false; // string vazia = encerrado
    const deadline = new Date(`${phaseDeadline}:00-03:00`); // interpreta como BRT
    return new Date() <= deadline;
  }
  if (!match.date) return true;
  const time = match.time ?? '00:00';
  const matchAt = new Date(`${match.date}T${time}:00-03:00`);
  const deadline = new Date(matchAt.getTime() - BET_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  return new Date() <= deadline;
}

/** Formata quantos dias/horas faltam para o prazo de palpite. */
function deadlineLabel(match: Match, phaseDeadline: string | null): string {
  let deadlineDate: Date;

  if (phaseDeadline !== null) {
    if (!phaseDeadline) return 'Palpites encerrados';
    deadlineDate = new Date(`${phaseDeadline}:00-03:00`);
  } else {
    if (!match.date) return '';
    const time = match.time ?? '00:00';
    const matchAt = new Date(`${match.date}T${time}:00-03:00`);
    deadlineDate = new Date(matchAt.getTime() - BET_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  }

  const diff = deadlineDate.getTime() - Date.now();
  if (diff <= 0) return 'Palpites encerrados';
  const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `Fecha em ${days}d ${hours}h`;
  return `Fecha em ${hours}h`;
}

/** Aceita só dígitos inteiros 0–20. Remove zeros à esquerda, rejeita negativos/decimais/texto. */
function sanitizeScore(val: string): string {
  const digits = val.replace(/\D/g, '');   // remove tudo que não é dígito
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  if (isNaN(n)) return '';
  return Math.min(n, 20).toString();       // teto de 20 gols
}

export function MatchCard({ match, showBet = true }: Props) {
  const profile          = useAuthStore(s => s.profile);
  const checkConnection  = useAuthStore(s => s.checkConnection);
  const { getBet, saveBet } = useBetsStore();
  const { setResult, resetMatch } = useTournamentStore();
  const phaseConfig = usePhaseSettingsStore(s => s.phases[match.stage as StageKey]);

  const [open, setOpen] = useState(false);
  const [betHome, setBetHome] = useState('');
  const [betAway, setBetAway] = useState('');
  const [resHome, setResHome] = useState('');
  const [resAway, setResAway] = useState('');
  const [penHome, setPenHome] = useState('');
  const [penAway, setPenAway] = useState('');
  const [tab, setTab] = useState<'bet' | 'result'>('bet');
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const homeTeam = match.homeTeamId ? TEAMS_BY_ID[match.homeTeamId] : null;
  const awayTeam = match.awayTeamId ? TEAMS_BY_ID[match.awayTeamId] : null;
  const userBet  = profile ? getBet(profile.id, match.id) : undefined;
  const isPlayed = match.played && match.homeScore !== null;
  const betPoints = isPlayed && userBet ? calcPoints(userBet, match) : null;

  const isAdmin     = profile?.isAdmin ?? false;
  const phaseDeadline = phaseConfig?.betsDeadline ?? null;
  const betOpen     = isBetOpen(match, phaseDeadline);
  const phaseVisible = isAdmin || (phaseConfig?.visible ?? true);
  // Para fases eliminatórias, times precisam estar definidos para liberar palpite
  const teamsReady  = match.stage === 'group' || (!!match.homeTeamId && !!match.awayTeamId);
  const canBet      = isAdmin || (!isPlayed && betOpen && teamsReady && phaseVisible);

  const stageInfo = match.stage === 'group'
    ? `Grupo ${match.group} · Rodada ${match.matchDay}`
    : STAGE_LABEL[match.stage] ?? match.stage;

  const handleSaveBet = () => {
    if (!profile || !canBet) return;
    // checkConnection() é 100% síncrono — compara Date.now() com sessionExpiresAt.
    // Zero latência, zero mutex, nunca bloqueia a UI.
    if (!checkConnection()) return;
    const home = betHome === '' ? 0 : Number(betHome);
    const away = betAway === '' ? 0 : Number(betAway);
    setOpen(false);
    saveBet(profile.id, match.id, home, away);
  };

  const handleSaveResult = () => {
    if (!isAdmin) return;
    if (!checkConnection()) return;
    const h = resHome === '' ? 0 : Number(resHome);
    const a = resAway === '' ? 0 : Number(resAway);
    const needsPens = match.stage !== 'group' && h === a;
    setSaveErr(null);
    setResult(
      match.id, h, a,
      needsPens && penHome ? Number(penHome) : null,
      needsPens && penAway ? Number(penAway) : null,
      (msg) => setSaveErr(msg),
    );
    setOpen(false);
  };

  const openModal = () => {
    setBetHome(userBet?.homeScore?.toString() ?? '');
    setBetAway(userBet?.awayScore?.toString() ?? '');
    setResHome(match.homeScore?.toString() ?? '');
    setResAway(match.awayScore?.toString() ?? '');
    setTab('bet');
    setOpen(true);
  };

  return (
    <>
      {/* ── Erro de save (admin) ── */}
      {saveErr && isAdmin && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
          style={{ background: '#EF444415', border: '1px solid #EF444440', color: '#FCA5A5' }}
        >
          <span>⚠ {saveErr}</span>
          <button onClick={() => setSaveErr(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Card ── */}
      <button
        onClick={openModal}
        className="card w-full text-left transition-colors"
        style={{ borderColor: open ? '#22C55E' : undefined }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#22C55E55'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#1F1F1F'}
      >
        {/* Header */}
        <div className="text-center mb-3 space-y-0.5">
          <div className="text-xs font-semibold text-copa-gold">{stageInfo}</div>
          {match.date && (
            <div className="text-xs text-gray-400">
              📅 {formatMatchDate(match.date, match.time)}
            </div>
          )}
          {match.venue && (
            <div className="text-xs text-gray-500 truncate">📍 {match.venue}</div>
          )}
        </div>

        {/* Times + placar inline */}
        <div className="flex items-center justify-between gap-2 mb-2">
          {/* Home — min-w-0 permite encolher; wrapper clipa a bandeira */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <div className="w-12 h-8 shrink-0 overflow-hidden rounded flex items-center justify-center">
              {homeTeam
                ? <Flag code={homeTeam.code} name={homeTeam.name} size="lg" className="w-full h-full" />
                : <div className="w-full h-full bg-slate-700 flex items-center justify-center text-gray-500 text-xs rounded">TBD</div>
              }
            </div>
            <span className="text-xs text-gray-200 font-medium text-center leading-tight line-clamp-2 w-full">
              {homeTeam?.name ?? match.homeFromSlot ?? 'TBD'}
            </span>
          </div>

          {/* Placar / separador central — largura fixa para não oscilar */}
          <div className="flex flex-col items-center shrink-0 w-14 text-center">
            {isPlayed ? (
              <>
                <div className="text-2xl font-black text-white leading-none">
                  {match.homeScore}<span className="text-gray-500 mx-0.5">–</span>{match.awayScore}
                </div>
                {match.homePenalties != null && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {match.homePenalties}×{match.awayPenalties} pen.
                  </div>
                )}
              </>
            ) : (
              <div className="text-lg font-bold text-gray-600">×</div>
            )}
          </div>

          {/* Away — min-w-0 permite encolher; wrapper clipa a bandeira */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <div className="w-12 h-8 shrink-0 overflow-hidden rounded flex items-center justify-center">
              {awayTeam
                ? <Flag code={awayTeam.code} name={awayTeam.name} size="lg" className="w-full h-full" />
                : <div className="w-full h-full bg-slate-700 flex items-center justify-center text-gray-500 text-xs rounded">TBD</div>
              }
            </div>
            <span className="text-xs text-gray-200 font-medium text-center leading-tight line-clamp-2 w-full">
              {awayTeam?.name ?? match.awayFromSlot ?? 'TBD'}
            </span>
          </div>
        </div>

        {/* Rodapé: palpite / status */}
        <div className="text-center mt-2 min-h-[24px]">
          {showBet && !teamsReady && !isPlayed ? (
            <div className="text-xs" style={{ color: '#4B5563' }}>Times a definir</div>
          ) : showBet && userBet ? (
            <>
              <div className={`text-sm font-bold px-2 py-1 rounded-lg inline-block ${
                betPoints === 3 ? 'bg-green-900/40 text-green-400' :
                betPoints === 1 ? 'bg-yellow-900/40 text-yellow-400' :
                betPoints === 0 ? 'bg-red-900/40 text-red-400' :
                'bg-copa-green/10 text-copa-green'
              }`}>
                Palpite: {userBet.homeScore} × {userBet.awayScore}
                {betPoints !== null && <span className="ml-1 opacity-80">· +{betPoints} pt</span>}
              </div>
              {/* Indicador de sync pendente: palpite está salvo localmente
                  mas ainda não confirmado pelo servidor (em retry via outbox).
                  Some sozinho quando o onSuccess do persistOp confirmar a escrita. */}
              {userBet.pendingPersist && (
                <div className="text-[10px] mt-0.5 animate-pulse" style={{ color: '#9CA3AF' }}>
                  ⟳ sincronizando…
                </div>
              )}
            </>
          ) : showBet && profile && !isPlayed ? (
            betOpen ? (
              <div className="text-xs text-gray-600">Clique para palpitar</div>
            ) : (
              <div className="text-xs font-medium" style={{ color: '#EF4444' }}>
                🔒 Palpites encerrados
              </div>
            )
          ) : null}

          {/* Contador regressivo para o prazo (quando ainda aberto e sem palpite) */}
          {showBet && !userBet && !isPlayed && betOpen && profile && !isAdmin && teamsReady && (
            <div className="text-xs mt-0.5" style={{ color: '#4B5563' }}>
              ⏱ {deadlineLabel(match, phaseDeadline)}
            </div>
          )}
        </div>
      </button>

      {/* ── Modal ── */}
      {open && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.80)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: '#111111', border: '1px solid #1F1F1F' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Cabeçalho */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-white text-sm">{stageInfo}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            {match.date && <p className="text-xs text-gray-600 mb-0.5">📅 {formatMatchDate(match.date, match.time)}</p>}
            {match.venue && <p className="text-xs text-gray-600 mb-3">📍 {match.venue}</p>}

            {/* Times no modal */}
            <div className="flex items-center justify-around mb-4">
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-8 overflow-hidden rounded">
                  {homeTeam && <Flag code={homeTeam.code} name={homeTeam.name} size="lg" className="w-full h-full" />}
                </div>
                <span className="text-xs text-gray-300">{homeTeam?.name ?? match.homeFromSlot ?? 'TBD'}</span>
              </div>
              {isPlayed
                ? <div className="font-black text-white text-xl">{match.homeScore} – {match.awayScore}</div>
                : <div className="text-gray-600 font-bold text-lg">×</div>
              }
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-8 overflow-hidden rounded">
                  {awayTeam && <Flag code={awayTeam.code} name={awayTeam.name} size="lg" className="w-full h-full" />}
                </div>
                <span className="text-xs text-gray-300">{awayTeam?.name ?? match.awayFromSlot ?? 'TBD'}</span>
              </div>
            </div>

            {/* Tabs: só admin vê as duas abas */}
            {isAdmin && (
              <div
                className="flex mb-4 rounded-xl overflow-hidden"
                style={{ border: '1px solid #2A2A2A' }}
              >
                <button
                  onClick={() => setTab('bet')}
                  className="flex-1 py-2 text-sm font-semibold transition-all"
                  style={{
                    background: tab === 'bet' ? '#22C55E' : 'transparent',
                    color: tab === 'bet' ? '#000' : '#6B7280',
                  }}
                >
                  Meu Palpite
                </button>
                <button
                  onClick={() => setTab('result')}
                  className="flex-1 py-2 text-sm font-semibold transition-all"
                  style={{
                    background: tab === 'result' ? '#EF4444' : 'transparent',
                    color: tab === 'result' ? '#fff' : '#6B7280',
                    borderLeft: '1px solid #2A2A2A',
                  }}
                >
                  Resultado Oficial
                </button>
              </div>
            )}

            {/* ── Aba: Palpite ── */}
            {(tab === 'bet' || !isAdmin) && profile && (
              <>
                {canBet ? (
                  <div>
                    <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Seu palpite</p>
                    <div className="flex items-center gap-3 justify-center mb-3">
                      <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                        value={betHome}
                        onFocus={e => e.target.select()}
                        onChange={e => setBetHome(sanitizeScore(e.target.value))} />
                      <span className="text-gray-500 font-bold text-lg">×</span>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                        value={betAway}
                        onFocus={e => e.target.select()}
                        onChange={e => setBetAway(sanitizeScore(e.target.value))} />
                    </div>
                    <button
                      onClick={handleSaveBet}
                      className="btn-primary w-full font-bold py-2.5"
                    >
                      Salvar Palpite
                    </button>
                    {!isAdmin && betOpen && (
                      <p className="text-center text-xs mt-2" style={{ color: '#4B5563' }}>
                        ⏱ {deadlineLabel(match, phaseDeadline)}
                      </p>
                    )}
                  </div>
                ) : (
                  /* Prazo encerrado para usuário comum */
                  <div
                    className="rounded-xl px-4 py-4 text-center"
                    style={{ background: '#1A1A1A', border: '1px solid #2A2A2A' }}
                  >
                    {userBet ? (
                      <>
                        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Seu palpite</p>
                        <div
                          className="text-lg font-black"
                          style={{ color: '#22C55E' }}
                        >
                          {userBet.homeScore} × {userBet.awayScore}
                        </div>
                        {isPlayed && betPoints !== null && (
                          <div className={`text-sm font-bold mt-1 ${
                            betPoints === 3 ? 'text-green-400' :
                            betPoints === 1 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            +{betPoints} {betPoints === 1 ? 'ponto' : 'pontos'}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-2xl mb-2">🔒</div>
                        <p className="text-sm font-semibold text-white">Palpites encerrados</p>
                        <p className="text-xs mt-1" style={{ color: '#4B5563' }}>
                          O prazo para palpitar era 3 dias antes do jogo.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Aba: Resultado oficial (somente admin) ── */}
            {tab === 'result' && isAdmin && (
              <div>
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Resultado oficial</p>
                <div className="flex items-center gap-3 justify-center mb-2">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                    value={resHome}
                    onFocus={e => e.target.select()}
                    onChange={e => setResHome(sanitizeScore(e.target.value))} />
                  <span className="text-gray-500 font-bold text-lg">×</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                    value={resAway}
                    onFocus={e => e.target.select()}
                    onChange={e => setResAway(sanitizeScore(e.target.value))} />
                </div>
                {match.stage !== 'group' && resHome !== '' && resAway !== ''
                  && Number(resHome) === Number(resAway) && (
                  <div className="mt-2 mb-2">
                    <p className="text-xs text-gray-500 mb-1">Pênaltis:</p>
                    <div className="flex items-center gap-3 justify-center">
                      <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                        value={penHome}
                        onFocus={e => e.target.select()}
                        onChange={e => setPenHome(sanitizeScore(e.target.value))} />
                      <span className="text-gray-500">×</span>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" className="score-input" placeholder="0"
                        value={penAway}
                        onFocus={e => e.target.select()}
                        onChange={e => setPenAway(sanitizeScore(e.target.value))} />
                    </div>
                  </div>
                )}
                <button
                  onClick={handleSaveResult}
                  className="mt-3 w-full font-bold py-2.5 rounded-lg text-white transition-all"
                  style={{ background: '#EF4444' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#DC2626'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#EF4444'}
                >
                  Salvar Resultado
                </button>
                {isPlayed && (
                  <button
                    onClick={() => { resetMatch(match.id); setOpen(false); }}
                    className="mt-2 w-full text-xs transition-colors py-1.5"
                    style={{ color: '#4B5563' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#9CA3AF'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#4B5563'}
                  >
                    Resetar resultado
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
