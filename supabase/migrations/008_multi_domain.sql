-- Migration: 008_multi_domain
-- ─────────────────────────────────────────────────────────────────────────────
-- Amplia o controle de acesso para aceitar três domínios corporativos:
--   @golfleet.com.br  (domínio original)
--   @v3.com.br        (novo)
--   @parar.com.br     (novo)
--
-- Atualiza o trigger check_email_domain_trigger que bloqueia na camada
-- mais profunda (antes do INSERT em auth.users) — garante que mesmo um
-- acesso direto via API ou SQL Editor não insira usuários de domínios
-- não autorizados.
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: CREATE OR REPLACE não falha se a função já existir.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- O trigger já existe (criado na migration 003) — não precisa recriar.
-- CREATE OR REPLACE na função acima já é suficiente para atualizar o comportamento.
