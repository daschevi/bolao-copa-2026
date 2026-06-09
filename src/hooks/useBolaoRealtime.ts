import { useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useTournamentStore } from '../store/tournamentStore';
import { useBetsStore } from '../store/betsStore';
import { usePhaseSettingsStore } from '../store/phaseSettingsStore';
import type { Profile } from '../types';

/**
 * Canal Supabase Realtime resiliente para match_results, bets e phase_settings.
 *
 * Requer: no painel Supabase → Database → Replication → adicionar as três
 * tabelas à publication `supabase_realtime`.
 *
 * Resiliência contra loops de queda (firewall/proxy corporativo matando WS):
 *
 *   - Backoff exponencial: 5 s, 10 s, 20 s, 40 s, 60 s (cap)
 *   - Após 8 falhas consecutivas, para de tentar por 5 min (circuit breaker)
 *   - NÃO dispara sync* em cada queda — só se o canal ficou estável por
 *     >= 30 s antes de cair. Quedas em cascata (< 30 s entre connect e close)
 *     indicam loop de firewall, não evento perdido. Sem esse guard cada ciclo
 *     de 6 s disparava 3 queries pesadas, saturava o event loop e travava a UI.
 *
 * Retorna uma função `reconnect()` estável que o caller pode chamar para
 * forçar a checagem do canal — usada pelo handler de visibilitychange e
 * pelo keepalive periódico.
 */
export function useBolaoRealtime(profile: Profile | null): () => void {
  const syncFromSupabase  = useTournamentStore(s => s.syncFromSupabase);
  const fetchMyBets       = useBetsStore(s => s.fetchMyBets);
  const syncPhaseSettings = usePhaseSettingsStore(s => s.syncPhaseSettings);

  // Ref atualizada pelo effect interno; expomos uma função pública estável
  // que delega à ref, permitindo que o caller (ex.: visibilitychange handler)
  // tenha uma referência constante mesmo enquanto o canal é reciclado.
  const reconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!profile || !isSupabaseConfigured) return;

    let mounted             = true;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let lastConnectedAt     = 0;
    let circuitOpenUntil    = 0;

    const BACKOFF_STEPS              = [5000, 10000, 20000, 40000, 60000];
    const STABLE_THRESHOLD_MS        = 30_000;
    const MAX_FAILURES_BEFORE_CIRCUIT = 8;
    const CIRCUIT_OPEN_DURATION      = 5 * 60_000;

    const connect = () => {
      if (!mounted) return;
      if (Date.now() < circuitOpenUntil) {
        console.warn('[realtime] circuit breaker aberto — não tentando reconectar agora');
        return;
      }

      // Timestamp no nome: cada tentativa cria um canal novo — elimina ghost
      // channels acumulados de ciclos rápidos de logout/login ou reconexão.
      const channelName = `bolao-${profile.id}-${Date.now()}`;

      const ch = supabase
        .channel(channelName)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'match_results' },
          () => { syncFromSupabase(); }
        )
        .on('postgres_changes',
          // Filtro por user_id: só recebe eventos dos próprios palpites.
          // Sem o filtro, o palpite de QUALQUER usuário dispara fetchMyBets
          // em todos os clientes conectados — principal causa de egress excessivo.
          { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${profile.id}` },
          () => { fetchMyBets(profile.id); }
        )
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'phase_settings' },
          () => { syncPhaseSettings(); }
        )
        .subscribe((status: string, err?: Error) => {
          if (status === 'SUBSCRIBED') {
            console.log('[realtime] canal conectado:', channelName);
            lastConnectedAt = Date.now();
            consecutiveFailures = 0;
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'     ||
            status === 'CLOSED'
          ) {
            const wasStable = lastConnectedAt > 0
              && (Date.now() - lastConnectedAt) >= STABLE_THRESHOLD_MS;
            consecutiveFailures += 1;

            console.warn(
              '[realtime] canal perdido —', status,
              `(falhas: ${consecutiveFailures}, estável: ${wasStable})`,
              err?.message ?? ''
            );

            // Só dispara sync se a conexão durou tempo suficiente.
            if (wasStable) {
              syncFromSupabase();
              fetchMyBets(profile.id);
              syncPhaseSettings();
            }

            if (consecutiveFailures >= MAX_FAILURES_BEFORE_CIRCUIT) {
              circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION;
              consecutiveFailures = 0;
              console.error('[realtime] muitas falhas — pausando reconexões por 5 min (provável firewall bloqueando WebSocket)');
              return;
            }

            if (mounted && !reconnectTimer) {
              const delay = BACKOFF_STEPS[Math.min(consecutiveFailures - 1, BACKOFF_STEPS.length - 1)];
              console.log(`[realtime] reconectando em ${delay / 1000}s`);
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
                connect();
              }, delay);
            }
          }
        });

      activeChannel = ch;
    };

    // Verifica estado real do canal e reconecta se necessário.
    // Invocado pelo keepalive mestre do App e pelo visibilitychange.
    const checkAndReconnect = () => {
      if (!mounted) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (activeChannel as any)?.state as string | undefined;
      // 'joined' = conectado e recebendo eventos. 'joining' = em processo.
      if (state !== 'joined' && state !== 'joining') {
        console.warn('[realtime] keepalive: estado', state ?? 'null', '— reconectando');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
        // Sync manual para recuperar eventos perdidos durante o offline.
        syncFromSupabase();
        fetchMyBets(profile.id);
        syncPhaseSettings();
        connect();
      }
    };

    reconnectRef.current = checkAndReconnect;
    connect();

    return () => {
      mounted = false;
      reconnectRef.current = null;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
    };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Função pública estável — caller pode passar como dep em outros effects
  // sem causar re-execução em todo render.
  return useCallback(() => { reconnectRef.current?.(); }, []);
}
