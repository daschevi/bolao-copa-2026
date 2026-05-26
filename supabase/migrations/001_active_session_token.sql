-- Migration: 001_active_session_token
-- ─────────────────────────────────────────────────────────────────────────
-- Suporte a sessão única por usuário (single-device login enforcement).
--
-- Cada login gera um UUID novo, salva em profiles.active_session_token e
-- no localStorage do dispositivo. O cliente verifica periodicamente
-- (keepalive de 4 min + visibilitychange) se seu token local ainda bate
-- com o do banco. Se não bater, significa que outro dispositivo fez login
-- depois → faz logout automático e mostra toast informativo.
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → colar este arquivo
-- → Run. Idempotente (usa IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_session_token TEXT;

-- A política profiles_update existente (`using (auth.uid() = id)`) já permite
-- que o usuário atualize esta coluna no próprio profile — nenhuma policy nova
-- precisa ser criada. profiles_select (`using (true)`) permite a leitura para
-- a comparação cliente vs BD.

COMMENT ON COLUMN public.profiles.active_session_token IS
  'UUID gerado a cada login. Dispositivos com token local diferente são deslogados automaticamente.';
