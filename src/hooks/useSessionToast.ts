import { useEffect } from 'react';

/**
 * Auto-dismiss do toast de sessão expirada após 6 s.
 *
 * Extraído do App.tsx para deixar a responsabilidade isolada: este hook
 * cuida apenas do timer de dismiss. A renderização do toast continua no
 * App (precisa estar fora do Router para sobreviver à troca de rota).
 */
export function useSessionToast(
  message: string | null,
  clear: () => void,
): void {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, 6000);
    return () => clearTimeout(t);
  }, [message, clear]);
}
