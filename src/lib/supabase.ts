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

/**
 * Persiste uma operação no Supabase em background, sem bloquear a UI.
 * Tenta até `retries` vezes com backoff exponencial.
 * Ideal para writes onde o estado local já foi atualizado de forma otimista.
 */
export async function bgPersist(
  fn: () => PromiseLike<{ error: { message: string } | null }>,
  {
    retries = 3,
    baseDelay = 2000,
    label = 'bgPersist',
    onError,
  }: {
    retries?: number;
    baseDelay?: number;
    label?: string;
    onError?: (msg: string) => void;
  } = {}
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race([
        fn() as Promise<{ error: { message: string } | null }>,
        new Promise<{ error: { message: string } }>(r =>
          setTimeout(() => r({ error: { message: 'timeout' } }), 8000)
        ),
      ]);
      if (!result.error) {
        if (attempt > 1) console.log(`[${label}] sucesso na tentativa ${attempt}`);
        return;
      }
      console.warn(`[${label}] tentativa ${attempt}/${retries} falhou:`, result.error.message);
    } catch (e) {
      console.warn(`[${label}] tentativa ${attempt}/${retries} lançou exceção:`, e);
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, baseDelay * attempt));
    }
  }
  console.error(`[${label}] todas as ${retries} tentativas falharam — dado salvo apenas localmente`);
  onError?.('Falha ao salvar no servidor. Verifique a conexão e tente novamente.');
}
