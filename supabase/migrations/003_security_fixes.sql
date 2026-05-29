-- Migration: 003_security_fixes
-- ─────────────────────────────────────────────────────────────────────────────
-- Corrige problemas de segurança identificados em code review (v1 e v2):
--
-- 1. profiles_update sem WITH CHECK → privilege escalation via is_admin
-- 2. Restrição de domínio só no cliente → bypass via JWT direto
-- 3. SELECT policies com using(true) → dados expostos a requisições anônimas
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: DROP IF EXISTS + CREATE OR REPLACE garantem re-execução segura.

-- ── Fix 1: profiles_update com WITH CHECK ────────────────────────────────────

drop policy if exists "profiles_update" on public.profiles;

create policy "profiles_update" on public.profiles
  for update
  using  (auth.uid() = id)
  with check (
    auth.uid() = id
    -- is_admin deve permanecer igual ao valor atual no banco.
    -- Impede que qualquer usuário se auto-promova via API REST.
    -- Para conceder admin: UPDATE direto no SQL Editor com service_role.
    --
    -- Nota sobre recursão: subquery lê profiles dentro de policy UPDATE de profiles.
    -- Não há loop: subquery é SELECT, coberto por profiles_select (using true),
    -- nunca por profiles_update. Seguro no PostgreSQL 15+ (versão do Supabase).
    AND is_admin = (select is_admin from public.profiles where id = auth.uid())
  );

-- ── Fix 2: trigger de domínio em auth.users ──────────────────────────────────

create or replace function public.check_email_domain()
returns trigger language plpgsql security definer as $$
begin
  if new.email is null or new.email not ilike '%@golfleet.com.br' then
    raise exception 'Acesso restrito a colaboradores @golfleet.com.br';
  end if;
  return new;
end;
$$;

-- Recria o trigger (idempotente via DROP IF EXISTS)
drop trigger if exists check_email_domain_trigger on auth.users;
create trigger check_email_domain_trigger
  before insert on auth.users
  for each row execute function public.check_email_domain();

-- ── Fix 3: SELECT policies restritas a usuários autenticados ─────────────────
-- Substitui using(true) por using(auth.uid() is not null) nas três tabelas
-- de dados do bolão — impede leitura anônima via anon key.

drop policy if exists "bets_select" on public.bets;
create policy "bets_select" on public.bets
  for select using (auth.uid() is not null);

drop policy if exists "results_select" on public.match_results;
create policy "results_select" on public.match_results
  for select using (auth.uid() is not null);

drop policy if exists "phase_settings_select" on public.phase_settings;
create policy "phase_settings_select" on public.phase_settings
  for select using (auth.uid() is not null);
