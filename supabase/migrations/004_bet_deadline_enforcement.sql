-- Migration: 004_bet_deadline_enforcement
-- ─────────────────────────────────────────────────────────────────────────────
-- Problema: as policies bets_insert e bets_update só verificavam autoria
-- (auth.uid() = user_id). Usuários com JWT válido podiam inserir/editar
-- palpites diretamente via API mesmo após o prazo da fase ter expirado.
--
-- Solução: função IMMUTABLE que extrai o stage a partir do match_id
-- (o stage já está codificado no próprio ID: A-1 = group, R32-1 = r32, etc.)
-- e policies atualizadas que cruzam com phase_settings.bets_deadline.
--
-- Comportamento:
--   • bets_deadline IS NULL → libera (prazo automático = 3 dias antes do jogo,
--     validado apenas no cliente)
--   • NOW() <= bets_deadline → libera
--   • NOW() >  bets_deadline → BLOQUEIA (novo comportamento)
--   • Admin → sempre libera (bypass para testes e ajustes)
--   • match_id desconhecido → fail-open (não bloqueia indevidamente)
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: DROP IF EXISTS + CREATE OR REPLACE garantem re-execução segura.

-- ── Função: extrai stage do match_id ─────────────────────────────────────────
-- IMMUTABLE = resultado determinístico → o planner pode cachear/usar em index.
-- Todos os IDs seguem convenção de src/data/matches.ts:
--   Grupos:       A-1 … L-6    → 'group'
--   Segunda fase: R32-1 … R32-16 → 'r32'
--   Oitavas:      R16-1 … R16-8  → 'r16'
--   Quartas:      QF-1 … QF-4    → 'qf'
--   Semis:        SF-1 … SF-2    → 'sf'
--   3º lugar:     THIRD          → 'third'
--   Final:        FINAL          → 'final'

create or replace function public.match_id_to_stage(mid text)
returns text language plpgsql immutable as $body$
begin
  -- Grupos: A-1 … L-6 (letra de grupo + hífen + número de 1 a 6)
  -- Usa similar_to em vez de ~ para evitar '$' no corpo da função, que
  -- confunde o parser JS do Supabase Studio ao processar delimitadores $$.
  if mid similar to '[A-L]-[1-6]' then return 'group'; end if;
  if mid like 'R32-%'             then return 'r32';   end if;
  if mid like 'R16-%'             then return 'r16';   end if;
  if mid like 'QF-%'              then return 'qf';    end if;
  if mid like 'SF-%'              then return 'sf';    end if;
  if mid = 'THIRD'                then return 'third'; end if;
  if mid = 'FINAL'                then return 'final'; end if;
  return null; -- match_id desconhecido → fail-open (não bloqueia)
end;
$body$;

-- ── bets_insert: bloqueia INSERT após prazo, admin sempre passa ───────────────

drop policy if exists "bets_insert" on public.bets;

create policy "bets_insert" on public.bets for insert
  with check (
    -- 1. Usuário só pode inserir palpites próprios
    auth.uid() = user_id
    and (
      -- 2a. Admin bypassa prazo (para testes e ajustes de última hora)
      exists (
        select 1 from public.profiles
        where id = auth.uid() and is_admin = true
      )
      or
      -- 2b. Prazo não expirou: fase sem deadline configurado
      --     OU deadline no futuro OU match_id desconhecido (fail-open)
      not exists (
        select 1 from public.phase_settings ps
        where ps.stage = public.match_id_to_stage(match_id)
          and ps.bets_deadline is not null
          and now() > ps.bets_deadline
      )
    )
  );

-- ── bets_update: bloqueia UPDATE após prazo, admin sempre passa ───────────────

drop policy if exists "bets_update" on public.bets;

create policy "bets_update" on public.bets for update
  using (
    -- 1. Usuário só pode editar palpites próprios
    auth.uid() = user_id
    and (
      -- 2a. Admin bypassa prazo
      exists (
        select 1 from public.profiles
        where id = auth.uid() and is_admin = true
      )
      or
      -- 2b. Prazo não expirou (mesma lógica do INSERT, usando match_id da linha)
      not exists (
        select 1 from public.phase_settings ps
        where ps.stage = public.match_id_to_stage(match_id)
          and ps.bets_deadline is not null
          and now() > ps.bets_deadline
      )
    )
  );
