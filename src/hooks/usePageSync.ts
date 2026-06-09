import { useEffect } from 'react';
import { drainOutbox, ensureServerWarm } from '../lib/supabase';
import { useTournamentStore } from '../store/tournamentStore';
import { useBetsStore } from '../store/betsStore';
import { useAuthStore } from '../store/authStore';
import { usePhaseSettingsStore } from '../store/phaseSettingsStore';
import { isSyncStale, markSyncDone } from './useBolaoSync';

interface PageSyncOptions {
  /** Incluir syncPhaseSettings() — necessário na página de Chaveamento. */
  phases?: boolean;
}

/**
 * Sincroniza dados frescos do servidor ao montar uma página.
 *
 * O que faz, em ordem:
 *  1. ensureServerWarm()  — acorda o free tier se ficou > 60s inativo
 *  2. drainOutbox()       — reenvia imediatamente ops pendentes (sempre, sem TTL)
 *  3. TTL check (1h)      — se dados foram sincronizados há < 1h, encerra aqui
 *  4. syncFromSupabase() + fetchMyBets(userId) [+ syncPhaseSettings()] em paralelo
 *
 * O drainOutbox sempre roda (palpites pendentes não podem ficar presos).
 * O re-fetch do banco é suprimido quando os dados já são frescos — o canal
 * Realtime mantém o estado atualizado em tempo real para o caso comum.
 *
 * Usar em cada página principal:
 *   usePageSync()              // Groups, MyBets
 *   usePageSync({ phases: true }) // Knockout
 */
export function usePageSync({ phases = false }: PageSyncOptions = {}) {
  const syncFromSupabase  = useTournamentStore(s => s.syncFromSupabase);
  const fetchMyBets       = useBetsStore(s => s.fetchMyBets);
  const syncPhaseSettings = usePhaseSettingsStore(s => s.syncPhaseSettings);
  const profile           = useAuthStore(s => s.profile);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      // Acorda servidor (throttled: só pinga se > 60s inativo)
      await ensureServerWarm();
      if (cancelled) return;

      // Drena outbox SEMPRE — palpites pendentes não dependem do TTL de leitura
      await drainOutbox();
      if (cancelled) return;

      // Dados frescos (sincronizados há < 1h por useBolaoSync, visibilitychange
      // ou outra chamada de usePageSync): não re-busca do servidor. O canal
      // Realtime mantém o estado atualizado para o caso comum de navegação rápida.
      if (!profile || !isSyncStale(profile.id)) return;

      await Promise.allSettled([
        syncFromSupabase(),
        fetchMyBets(profile.id),
        ...(phases ? [syncPhaseSettings()] : []),
      ]);

      if (!cancelled && profile) markSyncDone(profile.id);
    };
    sync();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
