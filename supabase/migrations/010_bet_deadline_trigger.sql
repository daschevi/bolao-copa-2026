-- Migration: 010_bet_deadline_trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Valida o PRAZO DE PALPITE no servidor, replicando exatamente a regra do
-- cliente (isBetOpen em MatchCard.tsx):
--
--   • Deadline explícito da fase (phase_settings.bets_deadline) tem PRECEDÊNCIA.
--   • Sem deadline explícito → regra automática: kickoff do jogo − 3 dias.
--   • Mesma regra para admin e usuário comum (consistente com a migration 007).
--
-- Por que esta migration existe (e substitui 004/007):
--   As policies bets_insert/bets_update de 004/007 só checavam o deadline
--   EXPLÍCITO da fase, e ainda por cima via match_id_to_stage() — cujo regex
--   '[A-L]-[1-6]' nunca casou com os IDs reais dos jogos de grupo (GA-1 … GL-6,
--   com prefixo 'G'). Resultado: o prazo automático (3 dias antes) NUNCA foi
--   validado no servidor, e nem o explícito para jogos de grupo. Qualquer
--   usuário com JWT válido podia palpitar após o jogo começar.
--
--   Esta migration move TODA a lógica de prazo para um trigger que conhece o
--   kickoff real de cada jogo (tabela match_meta), e simplifica as policies de
--   bets para apenas autoria (auth.uid() = user_id) — sem regra duplicada.
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: create table if not exists / create or replace / drop if exists.
-- ⚠️ Após aplicar, TESTAR um palpite válido (jogo futuro) — se o seed do
--    match_meta ficar incompleto, o trigger (fail-closed) bloqueia palpites
--    legítimos. As 104 linhas abaixo cobrem todos os jogos de matches.ts.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Tabela de metadados dos jogos (kickoff conhecido pelo servidor) ────────
create table if not exists public.match_meta (
  match_id   text primary key,
  stage      text not null,
  kickoff_at timestamptz not null
);

alter table public.match_meta enable row level security;

-- Leitura pública (clientes podem ler horários); escrita só via SQL/service_role.
drop policy if exists "match_meta_select" on public.match_meta;
create policy "match_meta_select" on public.match_meta for select using (true);

-- ── 2. Seed dos 104 jogos (gerado a partir de src/data/matches.ts) ────────────
-- kickoff_at convertido de horário de Brasília (BRT) para timestamptz.
insert into public.match_meta (match_id, stage, kickoff_at) values
  ('GA-1', 'group', ('2026-06-11 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GA-2', 'group', ('2026-06-11 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GA-3', 'group', ('2026-06-18 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GA-4', 'group', ('2026-06-18 13:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GA-5', 'group', ('2026-06-24 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GA-6', 'group', ('2026-06-24 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-1', 'group', ('2026-06-12 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-2', 'group', ('2026-06-13 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-3', 'group', ('2026-06-18 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-4', 'group', ('2026-06-18 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-5', 'group', ('2026-06-24 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GB-6', 'group', ('2026-06-24 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-1', 'group', ('2026-06-13 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-2', 'group', ('2026-06-13 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-3', 'group', ('2026-06-19 21:30')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-4', 'group', ('2026-06-19 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-5', 'group', ('2026-06-24 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GC-6', 'group', ('2026-06-24 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-1', 'group', ('2026-06-12 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-2', 'group', ('2026-06-14 01:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-3', 'group', ('2026-06-19 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-4', 'group', ('2026-06-20 01:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-5', 'group', ('2026-06-25 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GD-6', 'group', ('2026-06-25 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-1', 'group', ('2026-06-14 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-2', 'group', ('2026-06-14 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-3', 'group', ('2026-06-20 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-4', 'group', ('2026-06-20 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-5', 'group', ('2026-06-25 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GE-6', 'group', ('2026-06-25 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-1', 'group', ('2026-06-14 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-2', 'group', ('2026-06-14 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-3', 'group', ('2026-06-20 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-4', 'group', ('2026-06-21 01:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-5', 'group', ('2026-06-25 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GF-6', 'group', ('2026-06-25 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-1', 'group', ('2026-06-15 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-2', 'group', ('2026-06-15 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-3', 'group', ('2026-06-21 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-4', 'group', ('2026-06-21 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-5', 'group', ('2026-06-27 00:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GG-6', 'group', ('2026-06-27 00:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-1', 'group', ('2026-06-15 13:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-2', 'group', ('2026-06-15 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-3', 'group', ('2026-06-21 13:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-4', 'group', ('2026-06-21 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-5', 'group', ('2026-06-26 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GH-6', 'group', ('2026-06-26 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-1', 'group', ('2026-06-16 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-2', 'group', ('2026-06-16 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-3', 'group', ('2026-06-22 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-4', 'group', ('2026-06-22 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-5', 'group', ('2026-06-26 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GI-6', 'group', ('2026-06-26 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-1', 'group', ('2026-06-16 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-2', 'group', ('2026-06-17 01:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-3', 'group', ('2026-06-22 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-4', 'group', ('2026-06-23 00:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-5', 'group', ('2026-06-27 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GJ-6', 'group', ('2026-06-27 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-1', 'group', ('2026-06-17 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-2', 'group', ('2026-06-17 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-3', 'group', ('2026-06-23 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-4', 'group', ('2026-06-23 23:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-5', 'group', ('2026-06-27 20:30')::timestamp at time zone 'America/Sao_Paulo'),
  ('GK-6', 'group', ('2026-06-27 20:30')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-1', 'group', ('2026-06-17 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-2', 'group', ('2026-06-17 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-3', 'group', ('2026-06-23 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-4', 'group', ('2026-06-23 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-5', 'group', ('2026-06-27 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('GL-6', 'group', ('2026-06-27 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-1', 'r32', ('2026-06-29 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-2', 'r32', ('2026-06-29 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-3', 'r32', ('2026-06-30 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-4', 'r32', ('2026-06-30 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-5', 'r32', ('2026-07-01 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-6', 'r32', ('2026-07-01 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-7', 'r32', ('2026-07-02 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-8', 'r32', ('2026-07-02 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-9', 'r32', ('2026-07-03 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-10', 'r32', ('2026-07-03 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-11', 'r32', ('2026-07-04 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-12', 'r32', ('2026-07-04 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-13', 'r32', ('2026-07-05 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-14', 'r32', ('2026-07-05 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-15', 'r32', ('2026-07-06 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-16', 'r32', ('2026-07-06 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-1', 'r16', ('2026-07-09 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-2', 'r16', ('2026-07-09 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-3', 'r16', ('2026-07-10 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-4', 'r16', ('2026-07-10 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-5', 'r16', ('2026-07-11 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-6', 'r16', ('2026-07-11 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-7', 'r16', ('2026-07-12 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-8', 'r16', ('2026-07-12 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-1', 'qf', ('2026-07-15 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-2', 'qf', ('2026-07-15 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-3', 'qf', ('2026-07-16 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-4', 'qf', ('2026-07-16 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('SF-1', 'sf', ('2026-07-19 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('SF-2', 'sf', ('2026-07-20 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('THIRD', 'third', ('2026-07-23 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('FINAL', 'final', ('2026-07-23 22:00')::timestamp at time zone 'America/Sao_Paulo')
on conflict (match_id) do update
  set stage = excluded.stage, kickoff_at = excluded.kickoff_at;

-- ── 3. Trigger: replica isBetOpen (kickoff − 3 dias, fase tem precedência) ────
create or replace function public.check_bet_deadline()
returns trigger language plpgsql security definer set search_path = public as $body$
declare
  v_kickoff   timestamptz;
  v_stage     text;
  v_deadline  timestamptz;
  v_effective timestamptz;
begin
  select kickoff_at, stage into v_kickoff, v_stage
    from public.match_meta where match_id = new.match_id;

  -- Jogo desconhecido no meta → conservador: bloqueia (fail-closed).
  -- Evita brecha por omissão; o seed acima cobre todos os jogos reais.
  if v_kickoff is null then
    raise exception 'BET_DEADLINE: partida sem metadados (%).', new.match_id;
  end if;

  -- Deadline explícito da fase (definido pelo admin) tem PRECEDÊNCIA.
  -- Sem ele → regra automática: 3 dias antes do kickoff (igual ao cliente).
  select bets_deadline into v_deadline
    from public.phase_settings where stage = v_stage;

  if v_deadline is not null then
    v_effective := v_deadline;
  else
    v_effective := v_kickoff - interval '3 days';
  end if;

  if now() > v_effective then
    raise exception 'BET_DEADLINE: prazo de palpites encerrado.';
  end if;

  return new;
end
$body$;

drop trigger if exists trg_check_bet_deadline on public.bets;
create trigger trg_check_bet_deadline
  before insert or update on public.bets
  for each row execute function public.check_bet_deadline();

-- ── 4. Consolida as policies de bets: só autoria (prazo agora é do trigger) ────
-- Remove a checagem de deadline embutida em 004/007 — agora redundante e, no
-- caso de grupo, bugada (match_id_to_stage nunca casou GA-1 … GL-6). O trigger
-- acima é a única fonte de verdade do prazo.
drop policy if exists "bets_insert" on public.bets;
create policy "bets_insert" on public.bets for insert
  with check (auth.uid() = user_id);

drop policy if exists "bets_update" on public.bets;
create policy "bets_update" on public.bets for update
  using (auth.uid() = user_id);

-- ── 5. Remove a função obsoleta match_id_to_stage (não usada por mais nada) ────
drop function if exists public.match_id_to_stage(text);

commit;

-- ── Verificação pós-aplicação ─────────────────────────────────────────────────
-- 1. Contagem do seed (deve retornar 104):
--      select count(*) from public.match_meta;
-- 2. Palpite válido (jogo futuro) deve passar — testar pelo app.
-- 3. Tentar upsert em jogo já iniciado deve falhar com BET_DEADLINE:
--      insert into public.bets (user_id, match_id, home_score, away_score)
--      values (auth.uid(), 'GA-1', 1, 0);  -- após 08/jun: BET_DEADLINE
