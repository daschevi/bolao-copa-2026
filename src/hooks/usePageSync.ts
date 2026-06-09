import { useEffect } from 'react';
import { drainOutbox, ensureServerWarm } from '../lib/supabase';
import { useTournamentStore } from '../store/tournamentStore';
import { useBetsStore } from '../store/betsStore';
import { useAuthStore } from '../store/authStore';
import { usePhaseSettingsStore } from '../store/phaseSettingsStore';

interface PageSyncOptions {
  /** Incluir syncPhaseSettings() — necessário na página de Chaveamento. */
  phases?: boolean;
}

/**
 * Sincroniza dados frescos do servidor ao montar uma página.
 *
 * O que faz, em ordem:
 *  1. ensureServerWarm()  — acorda o free tier se ficou > 60s inativo
 *                           (throttled: não pinga desnecessariamente a cada navegação)
 *  2. drainOutbox()       — reenvia imediatamente ops pendentes (palpites não confirmados)
 *  3. syncFromSupabase() + fetchMyBets(userId) [+ syncPhaseSettings()] em paralelo
 *
 * Usar em cada página principal como substituto ao "navegar = logout/login":
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
      await ensureServerWarm();
      if (cancelled) return;
      await drainOutbox();
      if (cancelled) return;
      await Promise.allSettled([
        syncFromSupabase(),
        ...(profile ? [fetchMyBets(profile.id)] : []),
        ...(phases ? [syncPhaseSettings()] : []),
      ]);
    };
    sync();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
