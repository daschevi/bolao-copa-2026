import { useEffect, useState, useMemo } from 'react';
import { useBetsStore } from '../store/betsStore';
import { useTournamentStore } from '../store/tournamentStore';
import { TEAMS_BY_ID } from '../data/teams';
import { formatMatchDate } from '../data/matches';
import { Flag } from './Flag';
import type { LeaderboardEntry, BreakdownRow } from '../types';

interface Props {
  entry: LeaderboardEntry;
  onClose: () => void;
}

const STAGE_LABEL: Record<string, string> = {
  group: 'Grupos', r32: 'Segunda Fase', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', third: '3º Lugar', final: 'Final',
};

/** Cor do badge de pontos — mesma paleta de Rules.tsx. */
function pointsColor(points: number): string {
  return points === 3 ? '#8300ff' : points === 1 ? '#FACC15' : '#6B7280';
}

/**
 * Modal de detalhamento jogo a jogo da pontuação de um usuário.
 *
 * Busca o breakdown via RPC (get_user_bets_breakdown) — a mesma fonte do
 * get_leaderboard(), então a soma dos pontos aqui reconcilia exatamente com o
 * total exibido no ranking. Nomes/bandeiras/data/fase dos times são resolvidos
 * pelo tournamentStore.matches (já sincronizado no client) via match_id.
 */
export function ScoreBreakdownModal({ entry, onClose }: Props) {
  const fetchUserBreakdown = useBetsStore(s => s.fetchUserBreakdown);
  const matches            = useTournamentStore(s => s.matches);

  const [rows,    setRows]    = useState<BreakdownRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  // Fecha no Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Busca o detalhamento ao abrir
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchUserBreakdown(entry.profile.id).then(result => {
      if (cancelled) return;
      if (result === null) setError(true);
      else setRows(result);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [entry.profile.id, fetchUserBreakdown]);

  // Apenas jogos disputados (os que geraram pontos), ordenados por pontos desc
  // e depois pela data do jogo (cronológico).
  const playedRows = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter(r => r.played)
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const da = matches[a.matchId]?.date ?? '';
        const db = matches[b.matchId]?.date ?? '';
        return da.localeCompare(db);
      });
  }, [rows, matches]);

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-end sm:items-center justify-center z-50 sm:p-4"
      onClick={onClose}
    >
      <div
        className="card w-full sm:max-w-lg flex flex-col rounded-b-none sm:rounded-2xl"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-white text-lg truncate" style={{ fontStyle: 'italic' }}>
              {entry.profile.username}
            </h2>
            <div className="text-xs mt-1 flex gap-2 flex-wrap" style={{ color: '#4B5563' }}>
              <span><strong style={{ color: '#8300ff' }}>{entry.totalPoints}</strong> pts</span>
              <span>·</span>
              <span>{entry.exactScores} exatos</span>
              <span>·</span>
              <span>{entry.correctResults} acertos</span>
              <span>·</span>
              <span>{entry.totalBets} palpites</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none shrink-0"
            aria-label="Fechar"
          >✕</button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 -mr-1 pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="text-2xl animate-bounce">⚽</div>
              <p className="text-sm" style={{ color: '#4B5563' }}>Carregando detalhamento…</p>
            </div>
          ) : error ? (
            <div className="text-center py-10 text-sm" style={{ color: '#FCA5A5' }}>
              ⚠ Não foi possível carregar. Tente novamente.
            </div>
          ) : playedRows.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center"
              style={{ background: '#0D0D0D', border: '1px solid #1F1F1F' }}
            >
              <div className="text-2xl mb-2">🎯</div>
              <p className="text-sm" style={{ color: '#4B5563' }}>Nenhum jogo pontuado ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {playedRows.map(r => {
                const m = matches[r.matchId];
                const homeTeam = m?.homeTeamId ? TEAMS_BY_ID[m.homeTeamId] : null;
                const awayTeam = m?.awayTeamId ? TEAMS_BY_ID[m.awayTeamId] : null;
                const stage = m ? (STAGE_LABEL[m.stage] ?? m.stage) : '';
                const color = pointsColor(r.points);
                return (
                  <div
                    key={r.matchId}
                    className="rounded-xl p-3"
                    style={{ background: '#111111', border: '1px solid #1F1F1F' }}
                  >
                    {/* Linha 1: fase/data + badge de pontos */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#4B5563' }}>
                        {stage}{m?.date ? ` · ${formatMatchDate(m.date, m.time)}` : ''}
                      </span>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-md shrink-0"
                        style={{ background: `${color}22`, color }}
                      >
                        +{r.points} {r.points === 1 ? 'pt' : 'pts'}
                      </span>
                    </div>

                    {/* Linha 2: times + placar real */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {homeTeam && <Flag code={homeTeam.code} name={homeTeam.name} size="sm" />}
                        <span className="text-xs text-gray-300 truncate">{homeTeam?.name ?? 'TBD'}</span>
                      </div>
                      <span className="text-sm font-black text-white shrink-0 whitespace-nowrap">
                        {r.resultHome}<span className="text-gray-600 mx-1">×</span>{r.resultAway}
                      </span>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                        <span className="text-xs text-gray-300 truncate text-right">{awayTeam?.name ?? 'TBD'}</span>
                        {awayTeam && <Flag code={awayTeam.code} name={awayTeam.name} size="sm" />}
                      </div>
                    </div>

                    {/* Linha 3: palpite do usuário */}
                    <div className="text-[11px] mt-1.5 text-center" style={{ color: '#6B7280' }}>
                      seu palpite: <span style={{ color: '#9CA3AF' }}>{r.betHome} × {r.betAway}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
