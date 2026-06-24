-- Migration 014: corrige kickoffs das Oitavas, Quartas, Semis, 3º Lugar e Final
-- Fonte: Wikipedia / ESPN (horários em BRT convertidos de UTC local de cada sede)
-- Atualiza match_meta para o trigger trg_check_bet_deadline.

insert into public.match_meta (match_id, stage, kickoff_at)
values
  -- Oitavas de Final (4–7 jul)
  ('R16-1', 'r16', ('2026-07-04 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-2', 'r16', ('2026-07-04 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-3', 'r16', ('2026-07-05 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-4', 'r16', ('2026-07-05 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-5', 'r16', ('2026-07-06 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-6', 'r16', ('2026-07-06 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-7', 'r16', ('2026-07-07 13:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R16-8', 'r16', ('2026-07-07 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  -- Quartas de Final (9–11 jul)
  ('QF-1',  'qf',  ('2026-07-09 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-2',  'qf',  ('2026-07-10 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-3',  'qf',  ('2026-07-11 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('QF-4',  'qf',  ('2026-07-11 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  -- Semifinais (14–15 jul)
  ('SF-1',  'sf',  ('2026-07-14 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('SF-2',  'sf',  ('2026-07-15 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  -- Disputa de 3º Lugar e Final
  ('THIRD', 'third', ('2026-07-18 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('FINAL', 'final', ('2026-07-19 16:00')::timestamp at time zone 'America/Sao_Paulo')
on conflict (match_id) do update
  set kickoff_at = excluded.kickoff_at,
      stage      = excluded.stage;
