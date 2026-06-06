export function Rules() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* Título */}
      <div className="text-center mb-8">
        <p className="text-xs font-bold tracking-[0.3em] text-copa-green uppercase mb-2">
          golfleet · 2026
        </p>
        <h1
          className="text-3xl font-black uppercase text-white"
          style={{ fontStyle: 'italic' }}
        >
          Bolão Copa do Mundo 🏆
        </h1>
      </div>

      {/* Pontuação */}
      <section className="card space-y-4">
        <h2 className="text-lg font-black text-white uppercase flex items-center gap-2" style={{ fontStyle: 'italic' }}>
          <span>⚽</span> Pontuação
        </h2>

        <p className="text-sm text-gray-400">Para cada jogo, o palpite vale:</p>

        <div className="space-y-3">
          <ScoreRow
            badge="3 pts"
            badgeColor="#8300ff"
            title="Placar exato"
            description="Acertou o número de gols de ambos os times (ex: palpitou 2×1 e foi 2×1)"
          />
          <ScoreRow
            badge="1 pt"
            badgeColor="#FACC15"
            title="Resultado certo"
            description="Acertou quem venceu ou que seria empate, mas errou o placar (ex: palpitou 2×1 e foi 3×0)"
          />
          <ScoreRow
            badge="0 pts"
            badgeColor="#6B7280"
            title="Errou"
            description="Resultado diferente do palpitado"
          />
        </div>

        {/* Exemplo visual */}
        <div
          className="rounded-xl p-4 mt-2 space-y-2 overflow-x-auto"
          style={{ background: '#0D0D0D', border: '1px solid #1F1F1F' }}
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Exemplo</p>
          <ExampleRow result="Brasil 2×1 Argentina" bet="2×1" points={3} />
          <ExampleRow result="Brasil 2×1 Argentina" bet="3×0" points={1} />
          <ExampleRow result="Brasil 2×1 Argentina" bet="1×2" points={0} />
        </div>
      </section>

      {/* Fase eliminatória */}
      <section className="card space-y-3">
        <h2 className="text-lg font-black text-white uppercase flex items-center gap-2" style={{ fontStyle: 'italic' }}>
          <span>⚡</span> Fase Eliminatória
        </h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          Nas fases eliminatórias (Segunda Fase, Oitavas, Quartas, Semifinal, Final e 3º Lugar),
          jogos que terminam empatados vão para prorrogação e pênaltis.
          O palpite é pelo <strong className="text-white">placar ao final do tempo regulamentar</strong> — pênaltis não contam para a pontuação.
        </p>
      </section>

      {/* Prêmios */}
      <section className="card space-y-4">
        <h2 className="text-lg font-black text-white uppercase flex items-center gap-2" style={{ fontStyle: 'italic' }}>
          <span>🏅</span> Premiação
        </h2>

        <div className="space-y-3">
          <PrizeRow place={1} emoji="🥇" label="1º Lugar" value="R$ 2.000,00" color="#F59E0B" />
          <PrizeRow place={2} emoji="🥈" label="2º Lugar" value="R$ 1.500,00" color="#9CA3AF" />
          <PrizeRow place={3} emoji="🥉" label="3º Lugar" value="R$ 1.000,00" color="#B45309" />
        </div>
      </section>

      {/* Desempate */}
      <section className="card space-y-3">
        <h2 className="text-lg font-black text-white uppercase flex items-center gap-2" style={{ fontStyle: 'italic' }}>
          <span>⚖️</span> Critérios de Desempate
        </h2>
        <p className="text-sm text-gray-400">Em caso de empate na pontuação total, a classificação é decidida por:</p>
        <ol className="space-y-2">
          {[
            'Maior número de placares exatos (3 pontos)',
            'Persistindo o empate: sorteio',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black"
                style={{ background: '#8300ff20', color: '#8300ff', border: '1px solid #8300ff40' }}
              >
                {i + 1}
              </span>
              <span className="text-sm text-gray-300 pt-0.5">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Rodapé */}
      <p className="text-center text-xs text-gray-700 pb-4">
        Dúvidas? Fale com o administrador do bolão.
      </p>
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function ScoreRow({
  badge, badgeColor, title, description,
}: {
  badge: string;
  badgeColor: string;
  title: string;
  description: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl p-3"
      style={{ background: '#0D0D0D', border: '1px solid #1F1F1F' }}
    >
      <span
        className="shrink-0 text-xs font-black px-2 py-1 rounded-lg mt-0.5"
        style={{ background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40`, minWidth: '3rem', textAlign: 'center' }}
      >
        {badge}
      </span>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function ExampleRow({
  result, bet, points,
}: {
  result: string;
  bet: string;
  points: number;
}) {
  const color = points === 3 ? '#8300ff' : points === 1 ? '#FACC15' : '#6B7280';
  return (
    <div className="flex items-center gap-1.5 text-[10px] whitespace-nowrap">
      <span className="text-gray-500 shrink-0">Res:</span>
      <span className="text-white font-semibold shrink-0">{result}</span>
      <span className="text-gray-600 shrink-0">·</span>
      <span className="text-gray-500 shrink-0">Pal:</span>
      <span className="text-gray-300 font-semibold shrink-0">{bet}</span>
      <span className="flex-1" />
      <span
        className="shrink-0 font-black px-1.5 py-0.5 rounded-lg"
        style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
      >
        {points > 0 ? `+${points}` : '0'} pts
      </span>
    </div>
  );
}

function PrizeRow({
  emoji, label, value, color,
}: {
  place?: number;
  emoji: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ background: '#0D0D0D', border: `1px solid ${color}30` }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{emoji}</span>
        <span className="font-bold text-white text-sm">{label}</span>
      </div>
      <span className="font-black text-base" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
