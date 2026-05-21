import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// ── Detecta se estamos no callback OAuth do Supabase ─────────────────────────
// Tokens OAuth ficam no hash (#access_token=...) ou na query (?code=...).
// Nunca recarregamos durante esse fluxo — o código PKCE é de uso único.
function isOAuthCallback(): boolean {
  const hash = window.location.hash;
  const search = window.location.search;
  return (
    hash.includes('access_token') ||
    hash.includes('refresh_token') ||
    search.includes('code=') ||
    search.includes('error=')
  );
}

// ── Limpa Cache API e recarrega ───────────────────────────────────────────────
async function clearCachesAndReload() {
  if (isOAuthCallback()) return; // protege o fluxo de login
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {
    // ignore — reload acontece de qualquer forma
  }
  window.location.reload();
}

// Captura chunk 404 (arquivo hashed antigo sumiu após deploy)
window.addEventListener('vite:preloadError', () => {
  clearCachesAndReload();
});
// ─────────────────────────────────────────────────────────────────────────────

// Monta o app imediatamente
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ── Detecção de nova versão via version.json externo ─────────────────────────
(async () => {
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { v } = await res.json();
    const stored = localStorage.getItem('app-version');
    localStorage.setItem('app-version', v);
    if (stored !== null && stored !== v) {
      await clearCachesAndReload();
    }
  } catch {
    // offline ou version.json indisponível
  }
})();
// ─────────────────────────────────────────────────────────────────────────────
