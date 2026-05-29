-- Migration: 002_realtime_publications
-- ─────────────────────────────────────────────────────────────────────────────
-- Habilita postgres_changes do Realtime para as tabelas principais do bolão.
--
-- O App.tsx já assina eventos em `bets`, `match_results` e `phase_settings`
-- via canal Supabase Realtime. Sem esta migration, os eventos nunca chegam
-- ao cliente — o canal conecta normalmente mas fica silencioso.
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → colar → Run.
-- Idempotente (usa DO blocks com EXCEPTION para ignorar duplicatas).
--
-- Tabelas cobertas:
--   bets           → atualiza classificação/palpites em tempo real para todos
--   match_results  → propaga placar lançado pelo admin instantaneamente
--   phase_settings → libera fase no Chaveamento sem precisar de reload
--   profiles       → sessão única: expulsa devices ao detectar token divergente
--                    (também coberto pela migration 001, incluído aqui por completude)

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.match_results;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.phase_settings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
