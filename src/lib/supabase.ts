import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseKey) : (null as any);

/**
 * Wrapper que adiciona timeout a qualquer query do Supabase e renova o JWT
 * automaticamente se a primeira tentativa retornar "JWT expired".
 *
 * Recebe um **factory** (não a query construída) porque uma `PromiseLike` já
 * iniciada não pode ser re-executada — precisamos construir uma nova query
 * para a re-tentativa após o refresh.
 *
 * Uso:  sq(() => supabase.from('bets').select('*'), 8000)
 */
export async function sq(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: () => PromiseLike<{ data: any; error: any }>,
  timeoutMs = 6000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: { message: string } | null }> {
  const exec = () => Promise.race([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder() as Promise<{ data: any; error: { message: string } | null }>,
    new Promise<{ data: null; error: { message: string } }>(r =>
      setTimeout(() => r({ data: null, error: { message: 'Tempo limite excedido. Verifique sua conexão.' } }), timeoutMs)
    ),
  ]);

  const first = await exec();
  if (first.error && isJwtExpiredError(first.error.message)) {
    // Sessão pode ter expirado em background (mobile > 1h). Renova e re-tenta uma vez.
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      console.log('[sq] JWT renovado — re-tentando query');
      return exec();
    }
  }
  return first;
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

/** Retorna true se a mensagem de erro indica JWT expirado. */
function isJwtExpiredError(msg: string): boolean {
  const m = (msg ?? '').toLowerCase();
  return m.includes('jwt expired') || m.includes('pgrst301') || m.includes('token is expired');
}

/**
 * Tenta renovar o token de acesso via refresh token.
 * Além de renovar o JWT HTTP, atualiza explicitamente o WebSocket do Realtime
 * — o auto-refresh HTTP não garante que o WS receba o novo token a tempo,
 * o que mantinha o canal Realtime em estado expirado/desconectado.
 * Retorna true se a renovação foi bem-sucedida, false caso contrário.
 */
async function tryRefreshToken(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return false;
    // Propaga o novo token para o WebSocket do Realtime explicitamente.
    // O Supabase JS notifica o Realtime via onAuthStateChange internamente,
    // mas pode haver race condition — setAuth aqui garante a atualização.
    supabase.realtime.setAuth(data.session.access_token);
    return true;
  } catch {
    return false;
  }
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
      // JWT expirado: renova o token antes da próxima tentativa.
      // Cobre o cenário de app em background no mobile por > 1h sem auto-refresh.
      if (isJwtExpiredError(lastErrorMsg)) {
        console.warn(`[${label}] JWT expirado — renovando token antes da próxima tentativa`);
        const refreshed = await tryRefreshToken();
        if (!refreshed) {
          // Refresh token também expirado — não adianta re-tentar agora
          bumpAttempts(id);
          console.warn(`[${label}] refresh falhou — op permanece na outbox para próxima sessão`);
          onError?.('Sessão expirada. Faça login novamente para sincronizar.');
          return;
        }
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

  // Garante sessão ativa antes de executar writes.
  // Se não houver sessão, as ops ficam na outbox para o próximo drain
  // (que ocorre após login, visibilitychange ou reconexão de rede).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[outbox] sem sessão ativa — drenagem adiada');
      return;
    }
  } catch { /* se a verificação falhar, tenta drenar mesmo assim */ }

  _draining = true;
  try {
    console.log(`[outbox] drenando ${ops.length} op(s) pendente(s)`);
    // Flag: se encontrarmos JWT expirado, renovamos uma vez e relemos as ops.
    let jwtRefreshedThisRun = false;

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
        } else if (isJwtExpiredError(result.error.message) && !jwtRefreshedThisRun) {
          // JWT expirado durante o drain (app voltou do background).
          // Renova o token uma vez por ciclo de drenagem e re-tenta esta op.
          console.warn('[outbox] JWT expirado — renovando token e re-tentando op');
          jwtRefreshedThisRun = true;
          const refreshed = await tryRefreshToken();
          if (!refreshed) {
            console.warn('[outbox] refresh falhou — drenagem interrompida até próxima sessão');
            break; // abandona este ciclo; ops ficam na outbox
          }
          // Re-tenta esta op com o token novo
          try {
            const retryResult = await Promise.race([
              executeOp(op),
              new Promise<{ error: { message: string } }>(r =>
                setTimeout(() => r({ error: { message: 'timeout' } }), 10000)
              ),
            ]);
            if (!retryResult.error) {
              removeFromOutbox(op.id);
              console.log(`[outbox:${op.label}] reenviado com sucesso após refresh`);
            } else {
              bumpAttempts(op.id);
              console.warn(`[outbox:${op.label}] ainda falha após refresh:`, retryResult.error.message);
            }
          } catch (e) {
            bumpAttempts(op.id);
            console.warn(`[outbox:${op.label}] exceção após refresh:`, e);
          }
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

/**
 * Verifica se há uma op pendente na outbox para um match_id específico.
 *
 * Usado por syncFromSupabase para distinguir dois cenários ao encontrar
 * uma partida com resultado local mas ausente no BD:
 *   - true  → escrita ainda em voo (outbox pendente) → preserva local
 *   - false → resultado foi deletado externamente no BD → zera local
 */
export function hasPendingOutboxOpForMatch(matchId: string): boolean {
  return readOutbox().some(op => {
    if (op.table !== 'match_results') return false;
    if (op.kind === 'upsert') return op.payload.match_id === matchId;
    if (op.kind === 'delete') {
      return op.match.column === 'match_id' && op.match.value === matchId;
    }
    return false;
  });
}
