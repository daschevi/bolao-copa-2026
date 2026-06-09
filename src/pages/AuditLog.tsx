import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AuditLogRow {
  id: string;
  occurred_at: string;
  username: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

type EntityFilter = 'all' | 'bet' | 'match_result' | 'phase_settings' | 'session';

// ── Configuração visual de ações ──────────────────────────────────────────────

const ACTION_CFG: Record<string, { label: string; color: string; bg: string }> = {
  bet_created:    { label: 'Palpite',         color: '#8300ff', bg: '#8300ff20' },
  bet_updated:    { label: 'Palpite editado', color: '#EAB308', bg: '#EAB30820' },
  result_set:     { label: 'Resultado',       color: '#3B82F6', bg: '#3B82F620' },
  result_updated: { label: 'Res. corrigido',  color: '#F97316', bg: '#F9731620' },
  result_reset:   { label: 'Res. removido',   color: '#EF4444', bg: '#EF444420' },
  phase_updated:  { label: 'Fase',            color: '#A855F7', bg: '#A855F720' },
  session_claimed:{ label: 'Login',           color: '#6B7280', bg: '#6B728020' },
};

const STAGE_NAMES: Record<string, string> = {
  group: 'Grupos', r32: '2ª Fase', r16: 'Oitavas',
  qf: 'Quartas', sf: 'Semis', third: '3º Lugar', final: 'Final',
};

const FILTER_TABS: { key: EntityFilter; label: string }[] = [
  { key: 'all',           label: 'Todos' },
  { key: 'bet',           label: 'Palpites' },
  { key: 'match_result',  label: 'Resultados' },
  { key: 'phase_settings',label: 'Fases' },
  { key: 'session',       label: 'Sessões' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function fmtDeadline(val: unknown): string {
  if (!val) return 'automático';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(String(val)));
  } catch {
    return String(val);
  }
}

function renderEntityId(entityType: string, entityId: string | null): string {
  if (!entityId) return '—';
  if (entityType === 'phase_settings') return STAGE_NAMES[entityId] ?? entityId;
  if (entityType === 'session') return '—';
  return entityId; // match_id: A-1, QF-3, etc.
}

function renderChange(row: AuditLogRow): string {
  const { action, entity_type, old_data, new_data } = row;

  const score = (d: Record<string, unknown> | null) =>
    d ? `${d.home_score ?? '?'} × ${d.away_score ?? '?'}` : null;

  if (entity_type === 'bet' || entity_type === 'match_result') {
    if (action === 'result_reset') return 'resultado removido';
    const n = score(new_data);
    const o = score(old_data);
    if (o && n && o !== n) return `${o} → ${n}`;
    return n ?? '—';
  }

  if (entity_type === 'phase_settings') {
    if (!new_data) return '—';
    const parts: string[] = [];
    // Visibilidade
    if (!old_data || old_data.visible !== new_data.visible) {
      parts.push(`visível: ${new_data.visible ? 'sim' : 'não'}`);
    }
    // Prazo
    if (!old_data || old_data.bets_deadline !== new_data.bets_deadline) {
      parts.push(`prazo: ${fmtDeadline(new_data.bets_deadline)}`);
    }
    return parts.join(' · ') || '—';
  }

  if (entity_type === 'session') {
    const hadPrev = old_data?.previous_session;
    return hadPrev ? 'sessão anterior revogada' : 'primeiro login';
  }

  return '—';
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AuditLog() {
  const profile  = useAuthStore(s => s.profile);
  const navigate = useNavigate();

  const [logs,    setLogs]    = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<EntityFilter>('all');
  const [limit,   setLimit]   = useState(200);

  // Redireciona se não for admin
  useEffect(() => {
    if (profile && !profile.isAdmin) navigate('/grupos', { replace: true });
  }, [profile, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await (
        supabase.rpc('get_audit_logs', {
          p_entity_type: filter === 'all' ? null : filter,
          p_limit: limit,
        }) as unknown as Promise<{ data: AuditLogRow[] | null; error: { message: string } | null }>
      );
      if (err) { setError(err.message); return; }
      setLogs(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [filter, limit]);

  // Diferido via microtask: sai do tick síncrono do effect (load chama
  // setLoading/setError/setLogs internamente) e satisfaz a regra
  // react-hooks/set-state-in-effect sem cascading render.
  useEffect(() => { queueMicrotask(load); }, [load]);

  if (!profile?.isAdmin) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-white">📋 Auditoria</h1>
          <p className="text-xs mt-0.5" style={{ color: '#4B5563' }}>
            Todas as operações registradas — apenas visível para admins
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: '#8300ff15',
            border: '1px solid #8300ff40',
            color: loading ? '#4B5563' : '#8300ff',
          }}
        >
          {loading ? '⟳ Carregando…' : '↺ Atualizar'}
        </button>
      </div>

      {/* Filtros por tipo */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilter(tab.key); setLimit(200); }}
            className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: filter === tab.key ? '#8300ff20' : 'transparent',
              border: '1px solid',
              borderColor: filter === tab.key ? '#8300ff60' : '#2A2A2A',
              color: filter === tab.key ? '#8300ff' : '#6B7280',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Erro */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: '#1C0A0A', border: '1px solid #EF444440', color: '#FCA5A5' }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Contador */}
      {!loading && !error && (
        <p className="text-xs" style={{ color: '#4B5563' }}>
          {logs.length === 0
            ? 'Nenhum registro encontrado'
            : `${logs.length} registro${logs.length !== 1 ? 's' : ''}${logs.length >= limit ? ' (limite atingido)' : ''}`
          }
        </p>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl h-16 animate-pulse"
              style={{ background: '#111111', border: '1px solid #1F1F1F' }}
            />
          ))}
        </div>
      )}

      {/* Lista de logs */}
      {!loading && logs.length > 0 && (
        <div className="space-y-2">
          {logs.map(log => {
            const cfg = ACTION_CFG[log.action] ?? { label: log.action, color: '#9CA3AF', bg: '#9CA3AF20' };
            const entityId = renderEntityId(log.entity_type, log.entity_id);
            const change   = renderChange(log);

            return (
              <div
                key={log.id}
                className="rounded-xl p-3 space-y-1.5"
                style={{ background: '#111111', border: '1px solid #1F1F1F' }}
              >
                {/* Linha 1: badge + data/hora */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="px-2 py-0.5 rounded-md text-xs font-bold"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: '#4B5563' }}>
                    {fmtDate(log.occurred_at)}
                  </span>
                </div>

                {/* Linha 2: usuário + partida/fase */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white truncate">
                    {log.username ?? <span style={{ color: '#4B5563' }}>sistema</span>}
                  </span>
                  {entityId !== '—' && (
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{ background: '#1A1A1A', color: '#6B7280' }}
                    >
                      {entityId}
                    </span>
                  )}
                </div>

                {/* Linha 3: o que mudou */}
                {change !== '—' && (
                  <div className="text-xs" style={{ color: '#9CA3AF' }}>
                    {change}
                  </div>
                )}
              </div>
            );
          })}

          {/* Carregar mais */}
          {logs.length >= limit && (
            <button
              onClick={() => setLimit(l => l + 200)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'transparent',
                border: '1px solid #2A2A2A',
                color: '#6B7280',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9CA3AF'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6B7280'; }}
            >
              Carregar mais 200 registros
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && logs.length === 0 && (
        <div
          className="rounded-xl px-4 py-10 text-center"
          style={{ background: '#111111', border: '1px solid #1F1F1F' }}
        >
          <div className="text-3xl mb-2">📭</div>
          <p className="text-sm font-semibold text-white">Nenhum registro ainda</p>
          <p className="text-xs mt-1" style={{ color: '#4B5563' }}>
            Os logs aparecem aqui assim que usuários realizarem ações no app.
          </p>
        </div>
      )}
    </div>
  );
}
