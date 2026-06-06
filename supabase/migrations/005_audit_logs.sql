-- Migration: 005_audit_logs
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa rastreabilidade completa de operações:
--   • palpites criados / editados       (tabela bets)
--   • resultados definidos / corrigidos / removidos  (tabela match_results)
--   • configurações de fase alteradas   (tabela phase_settings)
--   • sessões reivindicadas             (tabela profiles, coluna active_session_token)
--
-- Arquitetura:
--   • Todos os registros são gravados por triggers SECURITY DEFINER — nenhum
--     cliente pode inserir, alterar ou apagar logs diretamente via API.
--   • Leitura via função get_audit_logs() que verifica is_admin antes de retornar.
--   • Policy SELECT permite que admin leia via Studio também (SECURITY DEFINER
--     na função já bypassa RLS, mas manter a policy facilita queries manuais).
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: IF NOT EXISTS + CREATE OR REPLACE + DROP IF EXISTS.

-- ── Tabela ────────────────────────────────────────────────────────────────────

create table if not exists public.audit_logs (
  id           uuid        default gen_random_uuid() primary key,
  occurred_at  timestamptz default now() not null,
  user_id      uuid        references public.profiles(id) on delete set null,
  action       text        not null,
  -- ações possíveis:
  --   bet_created | bet_updated
  --   result_set  | result_updated | result_reset
  --   phase_updated
  --   session_claimed
  entity_type  text        not null,
  -- tipos: bet | match_result | phase_settings | session
  entity_id    text,
  -- bet/result → match_id  |  phase_settings → stage  |  session → user_id
  old_data     jsonb,
  new_data     jsonb
);

-- Índices para consultas admin frequentes
create index if not exists audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_user_id_idx     on public.audit_logs (user_id);
create index if not exists audit_logs_action_idx      on public.audit_logs (action);
create index if not exists audit_logs_entity_idx      on public.audit_logs (entity_type, entity_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.audit_logs enable row level security;

-- Sem policy de INSERT/UPDATE/DELETE: somente triggers SECURITY DEFINER
-- conseguem gravar — clientes não têm permissão direta.

drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select" on public.audit_logs
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- ── Trigger: bets ─────────────────────────────────────────────────────────────
-- Loga INSERT (bet_created) e UPDATE quando placar muda (bet_updated).
-- Ignora atualizações de outros campos (ex: points calculados).

create or replace function public.trg_audit_bets()
returns trigger language plpgsql security definer
set search_path = public
as $body$
begin
  begin
    if TG_OP = 'INSERT' then
      insert into audit_logs (user_id, action, entity_type, entity_id, new_data)
      values (
        NEW.user_id,
        'bet_created',
        'bet',
        NEW.match_id,
        jsonb_build_object('home_score', NEW.home_score, 'away_score', NEW.away_score)
      );

    elsif TG_OP = 'UPDATE'
      and (NEW.home_score is distinct from OLD.home_score
           or  NEW.away_score is distinct from OLD.away_score) then
      insert into audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
      values (
        NEW.user_id,
        'bet_updated',
        'bet',
        NEW.match_id,
        jsonb_build_object('home_score', OLD.home_score, 'away_score', OLD.away_score),
        jsonb_build_object('home_score', NEW.home_score, 'away_score', NEW.away_score)
      );
    end if;
  exception when others then
    null; -- nunca bloqueia a operação principal por falha de log
  end;
  return NEW;
end;
$body$;

drop trigger if exists audit_bets_trigger on public.bets;
create trigger audit_bets_trigger
  after insert or update on public.bets
  for each row execute function public.trg_audit_bets();

-- ── Trigger: match_results ────────────────────────────────────────────────────
-- Loga INSERT (result_set), UPDATE de placar/times (result_set ou result_updated)
-- e DELETE (result_reset).

create or replace function public.trg_audit_match_results()
returns trigger language plpgsql security definer
set search_path = public
as $body$
declare
  v_user_id uuid;
  v_action  text;
begin
  begin
    v_user_id := auth.uid();

    if TG_OP = 'INSERT' then
      insert into audit_logs (user_id, action, entity_type, entity_id, new_data)
      values (
        v_user_id,
        'result_set',
        'match_result',
        NEW.match_id,
        jsonb_build_object(
          'home_score',     NEW.home_score,
          'away_score',     NEW.away_score,
          'home_penalties', NEW.home_penalties,
          'away_penalties', NEW.away_penalties,
          'home_team_id',   NEW.home_team_id,
          'away_team_id',   NEW.away_team_id
        )
      );

    elsif TG_OP = 'UPDATE'
      and (NEW.home_score   is distinct from OLD.home_score
           or NEW.away_score   is distinct from OLD.away_score
           or NEW.home_team_id is distinct from OLD.home_team_id
           or NEW.away_team_id is distinct from OLD.away_team_id) then

      -- Se o placar era NULL antes e agora tem valor: primeira definição = result_set.
      -- Caso contrário é uma correção = result_updated.
      v_action := case
        when OLD.home_score is null and NEW.home_score is not null then 'result_set'
        else 'result_updated'
      end;

      insert into audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
      values (
        v_user_id,
        v_action,
        'match_result',
        NEW.match_id,
        jsonb_build_object(
          'home_score',   OLD.home_score,
          'away_score',   OLD.away_score,
          'home_team_id', OLD.home_team_id,
          'away_team_id', OLD.away_team_id
        ),
        jsonb_build_object(
          'home_score',     NEW.home_score,
          'away_score',     NEW.away_score,
          'home_penalties', NEW.home_penalties,
          'away_penalties', NEW.away_penalties,
          'home_team_id',   NEW.home_team_id,
          'away_team_id',   NEW.away_team_id
        )
      );

    elsif TG_OP = 'DELETE' then
      insert into audit_logs (user_id, action, entity_type, entity_id, old_data)
      values (
        v_user_id,
        'result_reset',
        'match_result',
        OLD.match_id,
        jsonb_build_object('home_score', OLD.home_score, 'away_score', OLD.away_score)
      );
    end if;
  exception when others then
    null;
  end;
  -- AFTER trigger: retorno ignorado pelo PostgreSQL, mas precisa ser não-nulo
  -- para INSERT/UPDATE. DELETE retorna OLD por convenção.
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$body$;

drop trigger if exists audit_match_results_trigger on public.match_results;
create trigger audit_match_results_trigger
  after insert or update or delete on public.match_results
  for each row execute function public.trg_audit_match_results();

-- ── Trigger: phase_settings ───────────────────────────────────────────────────
-- Loga qualquer alteração em visible ou bets_deadline.

create or replace function public.trg_audit_phase_settings()
returns trigger language plpgsql security definer
set search_path = public
as $body$
begin
  begin
    if TG_OP = 'INSERT'
       or NEW.visible        is distinct from OLD.visible
       or NEW.bets_deadline  is distinct from OLD.bets_deadline then

      insert into audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
      values (
        auth.uid(),
        'phase_updated',
        'phase_settings',
        NEW.stage,
        case when TG_OP = 'UPDATE'
             then jsonb_build_object('visible', OLD.visible, 'bets_deadline', OLD.bets_deadline)
             else null
        end,
        jsonb_build_object('visible', NEW.visible, 'bets_deadline', NEW.bets_deadline)
      );
    end if;
  exception when others then
    null;
  end;
  return NEW;
end;
$body$;

drop trigger if exists audit_phase_settings_trigger on public.phase_settings;
create trigger audit_phase_settings_trigger
  after insert or update on public.phase_settings
  for each row execute function public.trg_audit_phase_settings();

-- ── Trigger: sessions (profiles.active_session_token) ─────────────────────────
-- Loga quando um usuário reivindica uma nova sessão (login em novo dispositivo).
-- old_data.previous_session = true indica que uma sessão anterior foi revogada.
-- O token em si NÃO é armazenado — apenas o evento de troca.

create or replace function public.trg_audit_sessions()
returns trigger language plpgsql security definer
set search_path = public
as $body$
begin
  begin
    if NEW.active_session_token is distinct from OLD.active_session_token
       and NEW.active_session_token is not null then
      insert into audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
      values (
        NEW.id,
        'session_claimed',
        'session',
        NEW.id::text,
        jsonb_build_object('previous_session', OLD.active_session_token is not null),
        jsonb_build_object('claimed_at', now())
      );
    end if;
  exception when others then
    null;
  end;
  return NEW;
end;
$body$;

drop trigger if exists audit_sessions_trigger on public.profiles;
create trigger audit_sessions_trigger
  after update on public.profiles
  for each row execute function public.trg_audit_sessions();

-- ── Função: get_audit_logs() ──────────────────────────────────────────────────
-- Consulta paginada com filtros. Verifica is_admin antes de retornar dados.
-- SECURITY DEFINER: bypassa RLS e faz JOIN com profiles para trazer username.
-- Limite máximo: 1000 registros por chamada.

create or replace function public.get_audit_logs(
  p_action      text        default null,
  p_entity_type text        default null,
  p_user_id     uuid        default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_limit       int         default 200
)
returns table (
  id           uuid,
  occurred_at  timestamptz,
  username     text,
  user_id      uuid,
  action       text,
  entity_type  text,
  entity_id    text,
  old_data     jsonb,
  new_data     jsonb
)
language plpgsql security definer
set search_path = public
as $body$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'Acesso negado: apenas administradores podem consultar logs de auditoria';
  end if;

  return query
  select
    al.id,
    al.occurred_at,
    p.username,
    al.user_id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.old_data,
    al.new_data
  from audit_logs al
  left join profiles p on p.id = al.user_id
  where (p_action      is null or al.action      = p_action)
    and (p_entity_type is null or al.entity_type = p_entity_type)
    and (p_user_id     is null or al.user_id     = p_user_id)
    and (p_from        is null or al.occurred_at >= p_from)
    and (p_to          is null or al.occurred_at <= p_to)
  order by al.occurred_at desc
  limit least(coalesce(p_limit, 200), 1000);
end;
$body$;
