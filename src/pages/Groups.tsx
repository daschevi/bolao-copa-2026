import React, { useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { Flag } from '../components/Flag';
import { useTournamentStore } from '../store/tournamentStore';
import { useAuthStore } from '../store/authStore';
import { usePhaseSettingsStore } from '../store/phaseSettingsStore';
import { GROUPS, TEAMS_BY_ID } from '../data/teams';
import type { Match } from '../types';

// ─── Navegador de rodadas ────────────────────────────────────────────────────
function RoundNavigator({
  activeRound,
  setActiveRound,
  style = {},
}: {
  activeRound: number;
  setActiveRound: React.Dispatch<React.SetStateAction<number>>;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{ background: '#000000', ...style }}
    >
      <button
        onClick={() => setActiveRound(r => Math.max(1, r - 1))}
        disabled={activeRound === 1}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold transition-all disabled:opacity-20"
        style={{ color: '#22C55E', border: '1px solid #22C55E40', background: '#22C55E10' }}
      >
        ‹
      </button>
      <div className="flex items-center gap-2">
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#FFFFFF' }}>
          {activeRound}ª Rodada
        </span>
        <div className="flex gap-1">
          {[1, 2, 3].map(r => (
            <button
              key={r}
              onClick={() => setActiveRound(r)}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{ background: r === activeRound ? '#22C55E' : '#374151' }}
            />
          ))}
        </div>
      </div>
      <button
        onClick={() => setActiveRound(r => Math.min(3, r + 1))}
        disabled={activeRound === 3}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold transition-all disabled:opacity-20"
        style={{ color: '#22C55E', border: '1px solid #22C55E40', background: '#22C55E10' }}
      >
        ›
      </button>
    </div>
  );
}

// ─── Linha horizontal de um grupo ────────────────────────────────────────────
function GroupRow({ group, matches }: { group: string; matches: Match[] }) {
  const { getGroupStandings } = useTournamentStore();
  const standings = getGroupStandings(group);
  const [activeRound, setActiveRound] = useState(1);

  const roundMatches = matches
    .filter(m => m.matchDay === activeRound)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? ''));

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#111111', border: '1px solid #1F1F1F' }}
    >
      <div className="flex flex-col">
        {/* ── Classificação ── */}
        <div
          className="p-4 border-b"
          style={{ borderColor: '#1F1F1F' }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th className="text-left pb-2 pr-1 w-5 text-white font-semibold">#</th>
                <th className="text-left pb-2 text-white font-semibold uppercase tracking-wide text-[10px]">Seleção</th>
                <th className="pb-2 w-11 px-2 text-center font-black uppercase tracking-wide text-[10px]" style={{ color: '#22C55E' }}>P</th>
                <th className="pb-2 w-9 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">J</th>
                <th className="pb-2 w-9 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">V</th>
                <th className="pb-2 w-9 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">E</th>
                <th className="pb-2 w-9 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">D</th>
                <th className="pb-2 w-10 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">GP</th>
                <th className="pb-2 w-10 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">GC</th>
                <th className="pb-2 w-10 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">SG</th>
                <th className="pb-2 w-12 px-2 text-center text-white font-semibold uppercase tracking-wide text-[10px]">%</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => {
                const team = TEAMS_BY_ID[s.teamId];
                const pct = s.played > 0 ? Math.round((s.points / (s.played * 3)) * 100) : 0;
                const sgColor = s.goalDifference > 0 ? '#22C55E' : s.goalDifference < 0 ? '#EF4444' : '#FFFFFF';
                return (
                  <tr
                    key={s.teamId}
                    style={{
                      opacity: i >= 2 ? 0.6 : 1,
                      borderBottom: i < standings.length - 1 ? '1px solid #1A1A1A' : 'none',
                    }}
                  >
                    <td className="py-2 text-center pr-1 font-semibold text-white">{i + 1}</td>
                    <td className="py-2 w-full max-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: i < 2 ? '#22C55E' : i === 2 ? '#EAB308' : 'transparent', border: i >= 3 ? '1px solid #374151' : 'none' }}
                        />
                        {team && <Flag code={team.code} name={team.name} size="sm" />}
                        <span className="text-white truncate min-w-0 font-medium" title={team?.name}>{team?.name}</span>
                      </div>
                    </td>
                    <td className="text-center py-2 px-2 font-black text-base" style={{ color: '#22C55E' }}>{s.points}</td>
                    <td className="text-center py-2 px-2 text-white">{s.played}</td>
                    <td className="text-center py-2 px-2 text-white">{s.won}</td>
                    <td className="text-center py-2 px-2 text-white">{s.drawn}</td>
                    <td className="text-center py-2 px-2 text-white">{s.lost}</td>
                    <td className="text-center py-2 px-2 text-white">{s.goalsFor}</td>
                    <td className="text-center py-2 px-2 text-white">{s.goalsAgainst}</td>
                    <td className="text-center py-2 px-2 font-semibold" style={{ color: sgColor }}>
                      {s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}
                    </td>
                    <td className="text-center py-2 px-2 text-white">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Legenda */}
          <div className="flex gap-4 mt-3 pt-2.5" style={{ borderTop: '1px solid #1A1A1A' }}>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#4B5563' }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#22C55E' }} /> Classificado
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#4B5563' }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#EAB308' }} /> Possível 3º
            </span>
          </div>
        </div>

        {/* ── Partidas da rodada ── */}
        <div className="flex flex-col">
          {/* Navigator sempre acima dos jogos — layout em coluna única */}
          <RoundNavigator
            activeRound={activeRound}
            setActiveRound={setActiveRound}
            style={{ borderBottom: '1px solid #1F1F1F' }}
          />
          <div className="flex flex-col gap-2 p-4">
            {roundMatches.map(m => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function Groups() {
  const { matches } = useTournamentStore();
  const { profile } = useAuthStore();
  const isAdmin = profile?.isAdmin ?? false;
  const groupPhase = usePhaseSettingsStore(s => s.phases.group);
  const phaseVisible = isAdmin || groupPhase.visible;

  const [activeRowGroupIdx, setActiveRowGroupIdx] = useState(0);

  // `visibleGroups` é GROUPS direto — a memoização preserva referência estável
  // para usar como dep estável caso seja preciso no futuro. Não há "reset por
  // mudança de visibilidade" porque a lista é constante; se voltar a variar,
  // adicionar useEffect aqui requer cuidado (não chamar setState síncrono).
  const visibleGroups = useMemo(() => GROUPS, []);

  // Fase oculta para não-admins
  if (!phaseVisible) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-xl font-black text-white uppercase" style={{ fontStyle: 'italic' }}>
          Fase de Grupos
        </h2>
        <p className="text-gray-500 text-sm text-center">
          Esta fase ainda não está disponível. Aguarde a liberação pelo administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Navegação entre grupos */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setActiveRowGroupIdx(i => Math.max(0, i - 1))}
          disabled={activeRowGroupIdx === 0}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-lg font-bold transition-all disabled:opacity-20"
          style={{ color: '#22C55E', border: '1px solid #22C55E40', background: '#22C55E10' }}
        >
          ‹
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#FFFFFF' }}>
            Grupo {visibleGroups[activeRowGroupIdx]}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: '#4B5563' }}>
            {activeRowGroupIdx + 1} de {visibleGroups.length}
          </span>
        </div>
        <button
          onClick={() => setActiveRowGroupIdx(i => Math.min(visibleGroups.length - 1, i + 1))}
          disabled={activeRowGroupIdx === visibleGroups.length - 1}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-lg font-bold transition-all disabled:opacity-20"
          style={{ color: '#22C55E', border: '1px solid #22C55E40', background: '#22C55E10' }}
        >
          ›
        </button>
      </div>

      {/* Grupo ativo */}
      {(() => {
        const group = visibleGroups[activeRowGroupIdx];
        const groupMatches = Object.values(matches).filter(
          m => m.stage === 'group' && m.group === group
        );
        return <GroupRow key={group} group={group} matches={groupMatches} />;
      })()}
    </div>
  );
}
