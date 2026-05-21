import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseKey) : (null as any);

/**
 * Wrapper que adiciona timeout a qualquer query do Supabase.
 * Evita travamento infinito quando o PostgREST está lento ou com conexões presas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sq(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryBuilder: PromiseLike<{ data: any; error: any }>,
  timeoutMs = 6000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: { message: string } | null }> {
  const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(resolve =>
    setTimeout(() => resolve({ data: null, error: { message: 'Tempo limite excedido. Verifique sua conexão.' } }), timeoutMs)
  );
  return Promise.race([queryBuilder as Promise<{ data: any; error: { message: string } | null }>, timeoutPromise]); // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbox persistente
// ─────────────────────────────────────────────────────────────────────────────
//
// Toda operação de escrita (upsert/delete) é primeiro registrada no localStorage
// e só removida da fila quando o Supabase confirmar success. Se o usuário fechar
// o app, perder rede, ou o celular dormir antes do retry final, a operação fica
// na outbox e é re-tentada no próximo `drainOutbox()` (chamado na inicialização
// e a cada visibilitychange).
//
// Isso elimina a perda silenciosa de palpites/placares que acontecia quando o
// `bgPersist` em memória esgotava as tentativas com o app já fechado.

export type OutboxOp =
  | {
      id: string;
      kind: 'upsert';
      table: string;
      payload: Record<string, unknown>;
      onConflict: string;
      label: string;
      attempts: number;
      createdAt: number;
    }
  | {
      id: string;
      kind: 'delete';
      table: string;
      match: { column: string; value: string | number };
      label: string;
      attempts: number;
      createdAt: number;
    };

export type OutboxOpInput =
  | Omit<Extract<OutboxOp, { kind: 'upsert' }>, 'id' | 'attempts' | 'createdAt'>
  | Omit<Extract<OutboxOp, { kind: 'delete' }>, 'id' | 'attempts' | 'createdAt'>;

const OUTBOX_KEY  = 'bolao-outbox-v1';
const MAX_ATTEMPTS = 8;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readOutbox(): OutboxOp[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(ops: OutboxOp[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch {
    // Storage cheio ou indisponível — não pode quebrar a UI
  }
}

/** Considera duas ops como "mesmo alvo" para deduplicação. */
function sameTarget(a: OutboxOp, b: OutboxOp): boolean {
  if (a.table !== b.table || a.kind !== b.kind) return false;
  if (a.kind === 'delete' && b.kind === 'delete') {
    return a.match.column === b.match.column && a.match.value === b.match.value;
  }
  if (a.kind === 'upsert' && b.kind === 'upsert' && a.onConflict === b.onConflict) {
    const keys = a.onConflict.split(',').map(k => k.trim());
    return keys.every(k => a.payload[k] === b.payload[k]);
  }
  return false;
}

/**
 * Erros permanentes: re-tentar nunca vai resolver.
 * Nesses casos a op deve ser descartada da outbox imediatamente em vez de
 * ficar até MAX_ATTEMPTS poluindo rede, logs e localStorage.
 *
 * Exemplos: coluna inexistente, tabela não criada, violação de RLS, schema cache miss.
 *
 * ⚠️ NÃO incluir aqui códigos transitórios. Em particular:
 *   - PGRST301 = "JWT expired" → transitório (basta usuário re-logar; reconciliação
 *     do fetchAllBets cobre bets, e ops na outbox vão drenar quando a sessão voltar)
 *   - PGRST116 = "0 rows when expecting one" → contexto de leitura, não de write
 */
function isPermanentError(msg: string): boolean {
  const m = (msg ?? '').toLowerCase();
  return /column .* does not exist/.test(m)
      || /relation .* does not exist/.test(m)
      || /row-level security/.test(m)
      || /violates row-level security/.test(m)
      || /pgrst204/.test(m)   // schema cache miss
      || /pgrst104/.test(m);  // singularity violation (múltiplas rows onde esperava uma)
}

function enqueueOutbox(input: OutboxOpInput): string {
  const op: OutboxOp = { ...input, id: genId(), attempts: 0, createdAt: Date.now() };
  const ops = readOutbox();
  // Dedup: se já existe uma op para o mesmo alvo, substitui (a mais recente vence)
  const idx = ops.findIndex(o => sameTarget(o, op));
  if (idx >= 0) ops[idx] = op;
  else ops.push(op);
  writeOutbox(ops);
  return op.id;
}

function removeFromOutbox(id: string): void {
  const ops = readOutbox().filter(o => o.id !== id);
  writeOutbox(ops);
}

function bumpAttempts(id: string): void {
  const ops = readOutbox();
  const idx = ops.findIndex(o => o.id === id);
  if (idx >= 0) {
    ops[idx] = { ...ops[idx], attempts: ops[idx].attempts + 1 };
    writeOutbox(ops);
  }
}

async function executeOp(op: OutboxOp): Promise<{ error: { message: string } | null }> {
  if (!isSupabaseConfigured) return { error: { message: 'supabase não configurado' } };
  if (op.kind === 'upsert') {
    return supabase.from(op.table).upsert(op.payload, { onConflict: op.onConflict });
  }
  return supabase.from(op.table).delete().eq(op.match.column, op.match.value);
}

/**
 * Persiste uma operação no Supabase. Sempre passa pela outbox:
 *   1. Enfileira em localStorage (escrita é durável a partir desse ponto)
 *   2. Tenta executar com retry/backoff
 *   3. Em sucesso, remove da outbox
 *   4. Em falha, a op fica na outbox e é re-tentada por `drainOutbox()`
 *      no próximo boot / visibilitychange / chamada explícita
 *
 * Ideal para writes onde o estado local já foi atualizado de forma otimista.
 */
export async function persistOp(
  input: OutboxOpInput,
  {
    retries = 3,
    baseDelay = 2000,
    timeoutMs = 8000,
    onError,
    onSuccess,
  }: {
    retries?: number;
    baseDelay?: number;
    timeoutMs?: number;
    onError?: (msg: string) => void;
    onSuccess?: () => void;
  } = {}
): Promise<void> {
  // Dev/CI sem .env — no-op silencioso; não entope a outbox com ops que nunca executarão
  if (!isSupabaseConfigured) return;
  const id = enqueueOutbox(input);
  const label = input.label;

  let lastErrorMsg = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race([
        executeOp({ ...input, id, attempts: attempt, createdAt: Date.now() } as OutboxOp),
        new Promise<{ error: { message: string } }>(r =>
          setTimeout(() => r({ error: { message: 'timeout' } }), timeoutMs)
        ),
      ]);
      if (!result.error) {
        removeFromOutbox(id);
        if (attempt > 1) console.log(`[${label}] sucesso na tentativa ${attempt}`);
        onSuccess?.();
        return;
      }
      lastErrorMsg = result.error.message;
      // Erro permanente: re-tentar não vai resolver — descarta imediatamente
      if (isPermanentError(lastErrorMsg)) {
        removeFromOutbox(id);
        console.error(`[${label}] erro permanente, descartando da outbox:`, lastErrorMsg);
        onError?.(lastErrorMsg);
        return;
      }
      console.warn(`[${label}] tentativa ${attempt}/${retries}:`, lastErrorMsg);
    } catch (e) {
      lastErrorMsg = String(e);
      console.warn(`[${label}] tentativa ${attempt}/${retries} exceção:`, e);
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, baseDelay * attempt));
    }
  }
  bumpAttempts(id);
  const reason = lastErrorMsg || 'sem detalhe';
  console.error(`[${label}] retries esgotados (${reason}) — op permanece na outbox para próxima sync`);
  onError?.(`Falha ao salvar no servidor${lastErrorMsg ? `: ${lastErrorMsg}` : ''}. Será re-tentado automaticamente.`);
}

/**
 * Drena a outbox: tenta re-enviar todas as ops pendentes uma vez cada.
 * Chame na inicialização do app, em visibilitychange e após reconexão.
 * Não bloqueia — é seguro chamar concorrentemente (operações duplicadas são
 * deduplicadas pelo `onConflict` no servidor).
 */
let _draining = false;
export async function drainOutbox(): Promise<void> {
  if (!isSupabaseConfigured || _draining) return;
  const ops = readOutbox();
  if (ops.length === 0) return;

  _draining = true;
  try {
    console.log(`[outbox] drenando ${ops.length} op(s) pendente(s)`);
    for (const op of ops) {
      if (op.attempts >= MAX_ATTEMPTS) {
        console.warn(`[outbox:${op.label}] descartando após ${op.attempts} tentativas`);
        removeFromOutbox(op.id);
        continue;
      }
      try {
        const result = await Promise.race([
          executeOp(op),
          new Promise<{ error: { message: string } }>(r =>
            setTimeout(() => r({ error: { message: 'timeout' } }), 10000)
          ),
        ]);
        if (!result.error) {
          removeFromOutbox(op.id);
          console.log(`[outbox:${op.label}] reenviado com sucesso`);
        } else if (isPermanentError(result.error.message)) {
          // Erro permanente: re-tentar nunca vai resolver — descarta agora
          removeFromOutbox(op.id);
          console.error(`[outbox:${op.label}] erro permanente, descartando:`, result.error.message);
        } else {
          bumpAttempts(op.id);
          console.warn(`[outbox:${op.label}] ainda falha:`, result.error.message);
        }
      } catch (e) {
        bumpAttempts(op.id);
        console.warn(`[outbox:${op.label}] exceção:`, e);
      }
    }
  } finally {
    _draining = false;
  }
}

/** Retorna quantas operações ainda estão pendentes (útil para badge na UI). */
export function getOutboxSize(): number {
  return readOutbox().length;
}
