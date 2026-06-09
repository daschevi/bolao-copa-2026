import { useEffect } from 'react';
import { drainOutbox, wakeUpSupabase } from '../lib/supabase';
import { useTournamentStore } from '../store/tournamentStore';
import { useBetsStore } from '../store/betsStore';
import { usePhaseSettingsStore } from '../store/phaseSettingsStore';
import type { Profile } from '../types';

// ── Estratégia de expiração de cache ─────────────────────────────────────────
//
// TTL de 1h alinhado com a expiração do JWT do Supabase: se o cache não foi
// atualizado dentro desse período, não pode ser considerado confiável.
// Chave por usuário evita que o timestamp de um usuário afete o próximo.

const SYNC_TTL_MS = 60 * 60 * 1000;

const syncKey = (userId: string) => `bolao-sync-${userId}`;

export function isSyncStale(userId: string): boolean {
  const ts = Number(localStorage.getItem(syncKey(userId)) ?? '0');
  return Date.now() - ts > SYNC_TTL_MS;
}

export function markSyncDone(userId: string): void {
  localStorage.setItem(syncKey(userId), String(Date.now()));
}

/**
 * Sincronização inicial após o boot/login.
 *
 * Roda apenas depois de `sessionChecked = true` para garantir que initAuth
 * já restaurou a sessão (drainOutbox precisa de auth.uid() válido).
 *
 * Sequência:
 *   1. wakeUpSupabase()  — cobre cold start do free tier
 *   2. drainOutbox()     — sobe ops pendentes da sessão anterior
 *   3. syncFromSupabase / fetchMyBets(userId) / syncPhaseSettings em paralelo
 *   4. setTimeout 15 s   — fallback se a 1ª passada pegou cold start
 *
 * `wakeUpSupabase` antes dos syncs paralelos é crítico: sem ele, as 3
 * chamadas competem pela 1ª resposta do cold start e estouram timeout
 * simultaneamente.
 */
export function useBolaoSync(
  sessionChecked: boolean,
  profile: Profile | null,
): void {
  const syncFromSupabase  = useTournamentStore(s => s.syncFromSupabase);
  const fetchMyBets       = useBetsStore(s => s.fetchMyBets);
  const syncPhaseSettings = usePhaseSettingsStore(s => s.syncPhaseSettings);

  useEffect(() => {
    if (!sessionChecked) return;

    const runSync = async () => {
      await wakeUpSupabase();
      await drainOutbox();
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchMyBets(profile.id), syncPhaseSettings()] : []),
      ]);
      if (profile) markSyncDone(profile.id);
    };

    runSync();

    const retryTimer = setTimeout(async () => {
      await wakeUpSupabase();
      await drainOutbox();
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchMyBets(profile.id), syncPhaseSettings()] : []),
      ]);
      if (profile) markSyncDone(profile.id);
    }, 15000);

    return () => clearTimeout(retryTimer);
  }, [sessionChecked, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
