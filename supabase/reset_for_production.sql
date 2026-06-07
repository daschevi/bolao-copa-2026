-- ─────────────────────────────────────────────────────────────────────────────
-- RESET COMPLETO PARA PRODUÇÃO
-- Supabase Studio → SQL Editor → New Query → Run
--
-- O que este script faz:
--   1. Apaga todos os palpites (bets)
--   2. Apaga todos os resultados de partidas (match_results)
--   3. Apaga todos os logs de auditoria (audit_logs)
--   4. Apaga todas as configurações de fase (phase_settings)
--   5. Apaga todos os perfis de usuário (profiles)
--   6. Apaga todos os usuários do auth (auth.users)
--
-- ⚠️  IRREVERSÍVEL — execute apenas uma vez antes do go-live.
-- ⚠️  Faça backup manual pelo Supabase Dashboard antes de rodar.
-- ─────────────────────────────────────────────────────────────────────────────

-- Todo o reset roda dentro de uma única transação. Se qualquer comando falhar
-- (lock conflitante, FK orphan, permissão), o rollback automático restaura o
-- estado anterior — evita ficar com algumas tabelas zeradas e outras intactas.
begin;

-- Desabilita triggers de auditoria temporariamente para que o reset em si
-- não gere entradas espúrias nos logs (que serão apagados logo depois).
alter table public.bets           disable trigger audit_bets_trigger;
alter table public.match_results  disable trigger audit_match_results_trigger;
alter table public.phase_settings disable trigger audit_phase_settings_trigger;
alter table public.profiles       disable trigger audit_sessions_trigger;

-- ── 1. Palpites ───────────────────────────────────────────────────────────────
truncate table public.bets restart identity cascade;

-- ── 2. Resultados das partidas ────────────────────────────────────────────────
truncate table public.match_results restart identity cascade;

-- ── 3. Logs de auditoria ─────────────────────────────────────────────────────
truncate table public.audit_logs restart identity cascade;

-- ── 4. Configurações de fase ──────────────────────────────────────────────────
-- Remove para que os admins configurem do zero no ambiente de produção.
truncate table public.phase_settings restart identity cascade;

-- ── 5. Perfis de usuário ──────────────────────────────────────────────────────
-- ON DELETE CASCADE em bets e audit_logs garante limpeza em cascata.
truncate table public.profiles restart identity cascade;

-- ── 6. Usuários de autenticação ───────────────────────────────────────────────
-- Apaga todos os logins (Google OAuth) registrados durante testes.
-- O trigger check_email_domain_trigger permanece ativo — novos logins
-- continuam restritos a @golfleet.com.br.
delete from auth.users;

-- Reabilita os triggers de auditoria para o ambiente de produção.
alter table public.bets           enable trigger audit_bets_trigger;
alter table public.match_results  enable trigger audit_match_results_trigger;
alter table public.phase_settings enable trigger audit_phase_settings_trigger;
alter table public.profiles       enable trigger audit_sessions_trigger;

commit;

-- ── Verificação final ─────────────────────────────────────────────────────────
-- Execute as queries abaixo para confirmar que tudo está zerado:
--
-- select count(*) as bets           from public.bets;
-- select count(*) as match_results  from public.match_results;
-- select count(*) as phase_settings from public.phase_settings;
-- select count(*) as audit_logs     from public.audit_logs;
-- select count(*) as profiles       from public.profiles;
-- select count(*) as auth_users     from auth.users;
--
-- Todos devem retornar 0.
--
-- ── Pós-reset ─────────────────────────────────────────────────────────────────
-- Após o reset:
--   1. O primeiro usuário que fizer login vira perfil comum.
--   2. Promova o admin manualmente no SQL Editor:
--        update public.profiles set is_admin = true where id = '<uuid-do-admin>';
--   3. Acesse o app como admin e configure as fases (visibilidade + deadlines).
