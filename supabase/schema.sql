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
create table public.phase_settings (
  stage text primary key,
  visible boolean not null default true,
  bets_deadline timestamptz,
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
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Bets: anyone can read, only owner can write
create policy "bets_select" on public.bets for select using (true);
create policy "bets_insert" on public.bets for insert with check (auth.uid() = user_id);
create policy "bets_update" on public.bets for update using (auth.uid() = user_id);

-- Match results: anyone can read, only admins can write
create policy "results_select" on public.match_results for select using (true);
create policy "results_insert" on public.match_results for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "results_update" on public.match_results for update
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Phase settings: anyone can read, only admins can write
create policy "phase_settings_select" on public.phase_settings for select using (true);
create policy "phase_settings_write"  on public.phase_settings for all
  using      (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Make the first registered user an admin (run manually after first signup):
-- update public.profiles set is_admin = true where id = '<user-uuid>';

-- Migration: add team columns to existing match_results table (run if table already exists):
-- alter table public.match_results add column if not exists home_team_id text;
-- alter table public.match_results add column if not exists away_team_id text;
