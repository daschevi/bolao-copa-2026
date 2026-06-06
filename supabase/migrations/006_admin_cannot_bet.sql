-- Migration: 006_admin_cannot_bet
-- ─────────────────────────────────────────────────────────────────────────────
-- Admins são árbitros do bolão — definem resultados oficiais, mas não participam
-- com palpites. Esta migration atualiza as policies de INSERT e UPDATE em `bets`
-- para bloquear qualquer tentativa de palpite por usuários com is_admin = true,
-- inclusive chamadas diretas à API (bypass de cliente).
--
-- Antes: admin bypassa a verificação de prazo (OR is_admin → libera sempre).
-- Depois: admin é explicitamente bloqueado (NOT EXISTS is_admin).
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.

-- ── bets_insert ───────────────────────────────────────────────────────────────

drop policy if exists "bets_insert" on public.bets;

create policy "bets_insert" on public.bets for insert
  with check (
    -- 1. Usuário só pode inserir palpites próprios
    auth.uid() = user_id
    -- 2. Admin NÃO pode palpitar — apenas define resultados oficiais
    and not exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
    -- 3. Prazo da fase não pode ter expirado
    and not exists (
      select 1 from public.phase_settings ps
      where ps.stage = public.match_id_to_stage(match_id)
        and ps.bets_deadline is not null
        and now() > ps.bets_deadline::timestamptz
    )
  );

-- ── bets_update ───────────────────────────────────────────────────────────────

drop policy if exists "bets_update" on public.bets;

create policy "bets_update" on public.bets for update
  using (
    -- 1. Usuário só pode editar palpites próprios
    auth.uid() = user_id
    -- 2. Admin NÃO pode editar palpites
    and not exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
    -- 3. Prazo da fase não pode ter expirado
    and not exists (
      select 1 from public.phase_settings ps
      where ps.stage = public.match_id_to_stage(match_id)
        and ps.bets_deadline is not null
        and now() > ps.bets_deadline::timestamptz
    )
  );
