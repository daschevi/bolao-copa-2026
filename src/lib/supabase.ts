import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken:  true,   // renova o JWT automaticamente antes de expirar
        persistSession:    true,   // mantém sessão no localStorage entre recargas
        detectSessionInUrl: true,  // captura o hash do redirect OAuth (PKCE)
      },
    })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  : (null as any);

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
  // Default 15s — Supabase free tier hiberna após ~5 min de ociosidade e o
  // cold start da primeira requisição pode levar 5-10s. Antes era 6s e a
  // primeira chamada após inatividade sempre estourava timeout.
  timeoutMs = 15000
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
  // Trata JWT expirado E RLS-block: ambos podem ser efeito de sessão silenciosamente
  // expirada. Quando auth.uid() vira null, o Postgres bloqueia com mensagem de RLS
  // (não de JWT). Renova e re-tenta uma vez nos dois casos.
  if (first.error && (isJwtExpiredError(first.error.message) || isRlsError(first.error.message))) {
    const cause = isJwtExpiredError(first.error.message) ? 'JWT expirado' : 'RLS-block';
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      console.log(`[sq] ${cause} — token renovado, re-tentando query`);
      const retry = await exec();
      if (!retry.error) markServerActive();
      return retry;
    }
  }
  if (!first.error) markServerActive();
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
// 20 tentativas totais. Cada drainOutbox/persistOp pode rodar várias vezes via
// focus/visibilitychange/online/keepalive, então damos bastante fôlego antes
// de descartar. Em redes corporativas hostis (firewall + free tier dormindo)
// o palpite pode demorar vários minutos para subir — mas não pode ser perdido.
const MAX_ATTEMPTS = 20;

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
 * Erros de schema: coluna/tabela inexistente. Realmente irrecuperáveis —
 * descarta da outbox imediatamente.
 */
function isSchemaError(msg: string): boolean {
  const m = (msg ?? '').toLowerCase();
  return /column .* does not exist/.test(m)
      || /relation .* does not exist/.test(m)
      || /pgrst204/.test(m)   // schema cache miss
      || /pgrst104/.test(m);  // singularity violation (múltiplas rows onde esperava uma)
}

/**
 * RLS-block. **Pode ser** efeito colateral de sessão expirada silenciosamente:
 * quando o JWT está stale, o Postgres trata o request como anônimo,
 * `auth.uid()` vira null e qualquer policy `auth.uid() = user_id` falha — não
 * como "JWT expired" explícito, mas como "violates RLS". Por isso, antes de
 * descartar a op, o persistOp/drainOutbox tentam renovar o token uma vez e
 * re-executar. Se ainda RLS, aí sim é permanente (admin tentando escrever em
 * tabela só-admin sem ser admin, por exemplo).
 */
function isRlsError(msg: string): boolean {
  const m = (msg ?? '').toLowerCase();
  return /row-level security/.test(m)
      || /violates row-level security/.test(m);
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
  // Garante servidor acordado. Throttled em 60s — se outra op acabou de subir,
  // o servidor está quente e isso retorna instantâneo. Se faz tempo, faz
  // wake-up de até 8s antes do upsert/delete pra não cair no cold start.
  await ensureServerWarm();
  const result = op.kind === 'upsert'
    ? await supabase.from(op.table).upsert(op.payload, { onConflict: op.onConflict })
    : await supabase.from(op.table).delete().eq(op.match.column, op.match.value);
  if (!result.error) markServerActive();
  return result;
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
 *
 * ⚠️ NÃO chama getSession() antes do refresh — ambas as funções compartilham o
 * mutex interno do Supabase JS. Chamar getSession() aqui enquanto o
 * visibilitychange já está executando refreshSession() causaria bloqueio mútuo
 * e congelaria a UI. refreshSession() já retorna a sessão renovada diretamente.
 */
async function tryRefreshToken(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
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

// Timestamp da última atividade conhecida no servidor Supabase.
// Usado por ensureServerWarm() para evitar wake-ups redundantes em rápida
// sucessão (ex: drainOutbox com 5 ops faria 5 wake-ups sem isso).
let lastServerActivityAt = 0;
const SERVER_WARM_WINDOW_MS = 60_000; // 60s — janela em que assumimos servidor ainda quente

/** Marca o servidor como ativo agora — chamar após qualquer resposta bem-sucedida. */
export function markServerActive(): void {
  lastServerActivityAt = Date.now();
}

/**
 * Acorda o Supabase fazendo uma query trivial e curta.
 *
 * Motivação: free tier hiberna após ~5 min sem requisições HTTP. A primeira
 * requisição após a hibernação leva 5-15s+ para acordar o servidor — em
 * redes corporativas hostis (firewall Golfleet) pode passar de 30s. Resultado:
 * o saveBet do usuário sempre cai no cold start e estoura timeout.
 *
 * Solução: chamamos esta função a cada 4 min (no keepalive), no boot, no
 * visibilitychange e antes de cada write na outbox. O servidor nunca chega
 * a hibernar e a chamada real do usuário sempre responde em < 1s.
 *
 * Implementação: select id from profiles limit 1 — query trivial, batida pelo
 * RLS mesmo se o user não tiver permissão (o erro é OK, o objetivo é só fazer
 * o servidor responder algo). Timeout curto: se demorou > 8s já tinha
 * hibernado mesmo, vamos confiar que a 2ª chamada (após esta) aborda direto.
 *
 * É fire-and-forget — nunca lança, nunca bloqueia o caller.
 */
export async function wakeUpSupabase(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    // O timeout resolve com `null`; a query resolve com `{ data, error }` (nunca null).
    // Só marcamos ativo se a query venceu — timeout significa servidor ainda hibernando,
    // e a próxima chamada real precisaria de outro wake-up se marcássemos aqui.
    const result = await Promise.race([
      supabase.from('profiles').select('id').limit(1) as Promise<unknown>,
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ]);
    if (result !== null) markServerActive();
  } catch {
    // ignora — objetivo é só fazer o servidor responder, não usar a resposta
  }
}

/**
 * Throttled wake-up: chama wakeUpSupabase() só se o servidor não teve
 * atividade conhecida nos últimos 60s. Use antes de qualquer operação
 * onde latência extra é aceitável se o servidor estiver dormindo.
 *
 * - Servidor recém-usado (< 60s): retorna instantaneamente (zero rede)
 * - Servidor possivelmente dormindo: faz wake-up de até 8s
 */
export async function ensureServerWarm(): Promise<void> {
  if (Date.now() - lastServerActivityAt < SERVER_WARM_WINDOW_MS) return;
  await wakeUpSupabase();
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
    // Default 45s para writes — cobre cold start extremo do free tier em
    // redes corporativas hostis (Golfleet) onde a 1ª chamada após hibernação
    // pode passar de 30s. Combinado com wakeUpSupabase() no keepalive de 4 min,
    // 45s é só rede de segurança — na prática a chamada sobe em < 1s.
    timeoutMs = 45000,
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
  let rlsRefreshAttempted = false;
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
      // Schema irrecuperável: descarta imediatamente
      if (isSchemaError(lastErrorMsg)) {
        removeFromOutbox(id);
        console.error(`[${label}] erro de schema, descartando da outbox:`, lastErrorMsg);
        onError?.(lastErrorMsg);
        return;
      }
      // JWT expirado explícito: renova e re-tenta
      if (isJwtExpiredError(lastErrorMsg)) {
        console.warn(`[${label}] JWT expirado — renovando token antes da próxima tentativa`);
        const refreshed = await tryRefreshToken();
        if (!refreshed) {
          bumpAttempts(id);
          console.warn(`[${label}] refresh falhou — op permanece na outbox para próxima sessão`);
          onError?.('Sessão expirada. Faça login novamente para sincronizar.');
          return;
        }
        // re-tenta com token renovado (não conta como backoff)
        continue;
      }
      // RLS-block: pode ser efeito colateral de sessão ainda não estabelecida no
      // boot (auth.uid() retorna null enquanto initAuth / refreshSession está em
      // voo). Renova UMA vez e re-tenta; se ainda der RLS, mantém na outbox com
      // bumpAttempts em vez de descartar — o drainOutbox vai re-tentar quando a
      // sessão estiver estável (visibilitychange, online, ou timer de 15s).
      if (isRlsError(lastErrorMsg)) {
        if (!rlsRefreshAttempted) {
          rlsRefreshAttempted = true;
          console.warn(`[${label}] RLS-block — tentando renovar token antes de re-tentativa`);
          const refreshed = await tryRefreshToken();
          if (refreshed) continue; // re-tenta com token novo
        }
        // RLS persistiu mesmo após refresh. Não descartamos: o problema pode ser
        // uma race de inicialização (sessão ainda em voo). A op fica na outbox e
        // será re-drenada quando a sessão estiver totalmente estabelecida.
        bumpAttempts(id);
        console.warn(`[${label}] RLS persistiu após refresh — op permanece na outbox para próxima sync`);
        onError?.('Sessão ainda não pronta — palpite será sincronizado automaticamente em breve.');
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

  // Não verificamos a sessão via getSession() aqui — essa chamada usa o mutex
  // interno do Supabase e bloquearia se visibilitychange estiver executando
  // refreshSession() simultaneamente. Em vez disso, cada op trata erros de JWT
  // expirado individualmente (isJwtExpiredError → tryRefreshToken) e ops que
  // falham por falta de sessão ficam na outbox para o próximo drain.

  // Acorda o servidor antes de drenar: se as ops ficaram pendentes durante
  // hibernação do free tier, a 1ª op cairia no cold start (5-15s+) e estouraria
  // timeout. Com wakeUp antes, o servidor já está respondendo quando as ops
  // de verdade rodam — drain inteiro completa em < 2s na prática.
  await wakeUpSupabase();

  _draining = true;
  console.log(`[outbox] drenando ${ops.length} op(s) pendente(s)`);
  try {
    // Renovamos o token UMA VEZ por drain quando vemos JWT-expired OU RLS-block
    // (que pode ser efeito colateral de sessão silenciosamente expirada).
    let tokenRefreshedThisRun = false;

    const tryRetryAfterRefresh = async (op: OutboxOp) => {
      try {
        const retryResult = await Promise.race([
          executeOp(op),
          new Promise<{ error: { message: string } }>(r =>
            setTimeout(() => r({ error: { message: 'timeout' } }), 25000)
          ),
        ]);
        if (!retryResult.error) {
          removeFromOutbox(op.id);
          console.log(`[outbox:${op.label}] reenviado com sucesso após refresh`);
        } else if (isSchemaError(retryResult.error.message)) {
          // Schema irrecuperável — descarta
          removeFromOutbox(op.id);
          console.error(`[outbox:${op.label}] erro de schema após refresh, descartando:`, retryResult.error.message);
        } else if (isRlsError(retryResult.error.message)) {
          // RLS após refresh — pode ser race de boot; mantém na outbox para próximo drain
          bumpAttempts(op.id);
          console.warn(`[outbox:${op.label}] RLS após refresh — mantendo na outbox para próximo drain`);
        } else {
          bumpAttempts(op.id);
          console.warn(`[outbox:${op.label}] ainda falha após refresh:`, retryResult.error.message);
        }
      } catch (e) {
        bumpAttempts(op.id);
        console.warn(`[outbox:${op.label}] exceção após refresh:`, e);
      }
    };

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
            setTimeout(() => r({ error: { message: 'timeout' } }), 25000)
          ),
        ]);
        if (!result.error) {
          removeFromOutbox(op.id);
          console.log(`[outbox:${op.label}] reenviado com sucesso`);
        } else if (isSchemaError(result.error.message)) {
          // Schema irrecuperável: descarta
          removeFromOutbox(op.id);
          console.error(`[outbox:${op.label}] erro de schema, descartando:`, result.error.message);
        } else if (isJwtExpiredError(result.error.message)) {
          // JWT expirado explícito
          if (tokenRefreshedThisRun) {
            // Já renovamos neste run e ainda dá JWT expired — sessão morta
            console.warn('[outbox] JWT expirado mesmo após refresh — interrompendo drenagem');
            break;
          }
          tokenRefreshedThisRun = true;
          console.warn('[outbox] JWT expirado — renovando token e re-tentando op');
          const refreshed = await tryRefreshToken();
          if (!refreshed) {
            console.warn('[outbox] refresh falhou — drenagem interrompida até próxima sessão');
            break;
          }
          await tryRetryAfterRefresh(op);
        } else if (isRlsError(result.error.message)) {
          // RLS-block: pode ser race de inicialização (sessão ainda em voo no boot).
          // Renova UMA vez por drain e re-tenta; se ainda RLS, mantém na outbox
          // em vez de descartar — o próximo drain (visibilitychange / timer 15s)
          // tentará novamente quando a sessão estiver totalmente estabelecida.
          if (tokenRefreshedThisRun) {
            bumpAttempts(op.id);
            console.warn(`[outbox:${op.label}] RLS persistiu após refresh — mantendo na outbox para próximo drain`);
          } else {
            tokenRefreshedThisRun = true;
            console.warn('[outbox] RLS-block — tentando renovar token antes de re-tentativa');
            const refreshed = await tryRefreshToken();
            if (!refreshed) {
              // Refresh falhou — mantém na outbox para o próximo drain
              bumpAttempts(op.id);
              console.warn(`[outbox:${op.label}] RLS sem refresh válido — mantendo na outbox`);
              continue;
            }
            await tryRetryAfterRefresh(op);
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
dOutbox().some(op => {
    if (op.kind === 'upsert') {
      return op.table === 'match_results' && op.payload.match_id === matchId;
    }
    return op.table === 'match_results' && op.match.column === 'match_id' && op.match.value === matchId;
  });
}
    }
    return false;
  });
}
