-- Run this in your Supabase SQL Editor

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Bets (one per user per match)
create table public.bets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  match_id text not null,
  home_score integer not null,
  away_score integer not null,
  home_penalties integer,
  away_penalties integer,
  points integer,
  created_at timestamptz default now(),
  unique(user_id, match_id)
);

-- Official match results (admin only)
-- home_score / away_score são nullable: setKnockoutTeams faz upsert apenas com
-- home_team_id / away_team_id (sem placar) quando os times são propagados
-- automaticamente antes do resultado ser registrado.
create table public.match_results (
  match_id text primary key,
  home_score integer,        -- nullable: pode existir linha só com times
  away_score integer,        -- nullable: pode existir linha só com times
  home_penalties integer,
  away_penalties integer,
  home_team_id text,
  away_team_id text,
  updated_at timestamptz default now()
);

-- Phase settings (admin only — visibility and bet deadlines per stage)
-- deadline_mode: 'auto3d' (3 dias antes), 'auto1h' (1 hora antes) ou 'fixed'
-- (usa bets_deadline). NULL = legado (deriva de bets_deadline). Ver migration 012.
create table public.phase_settings (
  stage text primary key,
  visible boolean not null default true,
  bets_deadline timestamptz,
  deadline_mode text,
  updated_at timestamptz default now()
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.bets enable row level security;
alter table public.match_results enable row level security;
alter table public.phase_settings enable row level security;

-- Profiles: anyone can read, only self can write
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
-- WITH CHECK garante que is_admin não pode ser alterado via API REST por nenhum usuário.
-- Apenas username e active_session_token são editáveis pelo próprio dono.
-- Para promover a admin use: UPDATE profiles SET is_admin = true WHERE id = '...'
-- diretamente no SQL Editor (requer service_role / acesso de superuser).
create policy "profiles_update" on public.profiles
  for update
  using  (auth.uid() = id)
  with check (
    auth.uid() = id
    -- is_admin deve permanecer igual ao valor atual — impede auto-promoção via API.
    -- Nota sobre recursão: a subquery lê profiles dentro de uma policy UPDATE de profiles.
    -- Não há loop: subquery é SELECT, coberto por profiles_select (using true),
    -- nunca por profiles_update. Seguro no PostgreSQL 15+ (versão do Supabase).
    AND is_admin = (select is_admin from public.profiles where id = auth.uid())
  );

-- Bets: apenas usuários autenticados podem ler (não expõe dados a visitantes anônimos).
-- Sem policy de DELETE intencional — palpite feito não pode ser cancelado.
-- Se cancelamento for necessário no futuro, adicionar policy aqui.
create policy "bets_select" on public.bets for select using (auth.uid() is not null);
-- INSERT e UPDATE verificam APENAS autoria aqui. O PRAZO de palpite é validado
-- pelo trigger trg_check_bet_deadline (migration 010), que conhece o kickoff
-- real de cada jogo (tabela match_meta) e replica a regra do cliente:
-- least(deadline explícito da fase ?? kickoff − 3 dias, kickoff) — o kickoff é
-- teto absoluto, nem o deadline explícito reabre palpite com a bola rolando.
-- ⚠️ Aplicar a migration 010 é OBRIGATÓRIO — sem ela não há validação de prazo.
create policy "bets_insert" on public.bets for insert
  with check (auth.uid() = user_id);
create policy "bets_update" on public.bets for update
  using (auth.uid() = user_id);

-- Match results: apenas usuários autenticados podem ler.
create policy "results_select" on public.match_results for select using (auth.uid() is not null);
create policy "results_insert" on public.match_results for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "results_update" on public.match_results for update
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "results_delete" on public.match_results for delete
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Phase settings: apenas usuários autenticados podem ler.
create policy "phase_settings_select" on public.phase_settings for select using (auth.uid() is not null);
create policy "phase_settings_write"  on public.phase_settings for all
  using      (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Make the first registered user an admin (run manually after first signup):
-- update public.profiles set is_admin = true where id = '<user-uuid>';

-- ── Restrição de domínio no servidor ─────────────────────────────────────────
-- O parâmetro `hd` no OAuth é apenas hint para o Google — não bloqueia logins
-- de outros domínios. Este trigger garante a restrição no banco, antes de
-- qualquer linha ser inserida em auth.users.
create or replace function public.check_email_domain()
returns trigger language plpgsql security definer as $$
begin
  if new.email is null
     or (
       new.email not ilike '%@golfleet.com.br'
       and new.email not ilike '%@v3.com.br'
       and new.email not ilike '%@parar.com.br'
     )
  then
    raise exception 'Acesso restrito a colaboradores @golfleet.com.br, @v3.com.br ou @parar.com.br';
  end if;
  return new;
end;
$$;

drop trigger if exists check_email_domain_trigger on auth.users;
create trigger check_email_domain_trigger
  before insert on auth.users
  for each row execute function public.check_email_domain();

-- Migration: add team columns to existing match_results table (run if table already exists):
-- alter table public.match_results add column if not exists home_team_id text;
-- alter table public.match_results add column if not exists away_team_id text;
