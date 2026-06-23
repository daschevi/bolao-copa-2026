-- Migration: 012_deadline_mode
-- ─────────────────────────────────────────────────────────────────────────────
-- Adiciona um terceiro modo de prazo de palpite por fase: "1 hora antes de cada
-- jogo" (relativo ao kickoff, como o automático de 3 dias, mas com offset de 1h).
--
-- Modelo: nova coluna phase_settings.deadline_mode com três valores:
--   'auto3d' → kickoff − 3 dias   (padrão / comportamento legado)
--   'auto1h' → kickoff − 1 hora   (novo)
--   'fixed'  → usa bets_deadline (data/hora fixa), limitado ao kickoff
--
-- Retrocompat: linhas antigas têm deadline_mode NULL. O trigger deriva:
--   NULL + bets_deadline preenchido → 'fixed'; NULL + vazio → 'auto3d'.
--
-- O trigger continua aplicando o kickoff como TETO ABSOLUTO (least), mantendo a
-- garantia da migration 010 (nunca aceitar palpite com a bola rolando).
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.phase_settings
  add column if not exists deadline_mode text;

create or replace function public.check_bet_deadline()
returns trigger language plpgsql security definer set search_path = public as $body$
declare
  v_kickoff   timestamptz;
  v_stage     text;
  v_deadline  timestamptz;
  v_mode      text;
  v_effective timestamptz;
begin
  select kickoff_at, stage into v_kickoff, v_stage
    from public.match_meta where match_id = new.match_id;

  -- Jogo desconhecido → conservador: bloqueia (fail-closed).
  if v_kickoff is null then
    raise exception 'BET_DEADLINE: partida sem metadados (%).', new.match_id;
  end if;

  select bets_deadline, deadline_mode into v_deadline, v_mode
    from public.phase_settings where stage = v_stage;

  if v_mode = 'auto1h' then
    -- 1 hora antes do kickoff
    v_effective := v_kickoff - interval '1 hour';
  elsif v_mode = 'fixed' or (v_mode is null and v_deadline is not null) then
    -- Data/hora fixa da fase, limitada ao kickoff (teto absoluto). Sem deadline
    -- definido cai para 3 dias antes (coalesce) — consistente com o cliente.
    v_effective := least(coalesce(v_deadline, v_kickoff - interval '3 days'), v_kickoff);
  else
    -- 'auto3d' / legado: 3 dias antes do kickoff
    v_effective := v_kickoff - interval '3 days';
  end if;

  if now() > v_effective then
    raise exception 'BET_DEADLINE: prazo de palpites encerrado.';
  end if;

  return new;
end
$body$;

-- Trigger trg_check_bet_deadline já existe (migration 010) e passa a usar a
-- versão acima automaticamente. Não precisa recriar.
