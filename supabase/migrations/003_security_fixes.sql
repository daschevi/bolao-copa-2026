-- Migration: 003_security_fixes
-- ─────────────────────────────────────────────────────────────────────────────
-- Corrige dois problemas críticos de segurança identificados em code review:
--
-- 1. profiles_update sem WITH CHECK: qualquer usuário autenticado podia se
--    auto-promover a admin via API REST (supabase.from('profiles').update({is_admin:true})).
--    Fix: WITH CHECK que valida que is_admin não pode mudar via API.
--
-- 2. Restrição de domínio só no cliente: o parâmetro `hd` no OAuth é hint,
--    não restrição. Qualquer email Google obtinha JWT válido e acessava a API.
--    Fix: trigger BEFORE INSERT em auth.users que rejeita emails fora do domínio.
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
