-- Migration: 007_admin_same_bet_rules
-- ─────────────────────────────────────────────────────────────────────────────
-- Admin participa do bolão com as mesmas regras de palpite que usuários comuns:
--   • Pode palpitar enquanto o prazo estiver aberto
--   • Não pode palpitar após o prazo expirar
--   • Continua podendo definir resultados oficiais (policy results_* inalterada)
--
-- Remove o bloco NOT EXISTS is_admin adicionado na migration 006 e mantém
-- apenas a verificação de prazo (igual para todos os perfis).
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.

-- ── bets_insert ───────────────────────────────────────────────────────────────

drop policy if exists "bets_insert" on public.bets;

create policy "bets_insert" on public.bets for insert
  with check (
    -- Usuário só pode inserir palpites próprios
    auth.uid() = user_id
    -- Prazo da fase não pode ter expirado (mesma regra para admin e usuário comum)
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
    -- Usuário só pode editar palpites próprios
    auth.uid() = user_id
    -- Prazo da fase não pode ter expirado (mesma regra para admin e usuário comum)
    and not exists (
      select 1 from public.phase_settings ps
      where ps.stage = public.match_id_to_stage(match_id)
        and ps.bets_deadline is not null
        and now() > ps.bets_deadline::timestamptz
    )
  );
