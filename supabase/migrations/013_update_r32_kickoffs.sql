-- Migration 013: corrige datas, horários e locais da Rodada de 32
-- Fonte: calendário oficial FIFA (28 jun – 3 jul de 2026, horário de Brasília)
-- Atualiza a tabela match_meta (usada pelo trigger trg_check_bet_deadline)
-- para que o teto absoluto de palpite reflita os kickoffs corretos.

insert into public.match_meta (match_id, stage, kickoff_at)
values
  ('R32-1',  'r32', ('2026-06-28 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-2',  'r32', ('2026-06-29 17:30')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-3',  'r32', ('2026-06-29 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-4',  'r32', ('2026-06-29 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-5',  'r32', ('2026-06-30 18:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-6',  'r32', ('2026-06-30 14:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-7',  'r32', ('2026-06-30 22:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-8',  'r32', ('2026-07-01 13:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-9',  'r32', ('2026-07-01 21:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-10', 'r32', ('2026-07-01 17:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-11', 'r32', ('2026-07-02 20:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-12', 'r32', ('2026-07-02 16:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-13', 'r32', ('2026-07-03 00:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-14', 'r32', ('2026-07-03 19:00')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-15', 'r32', ('2026-07-03 22:30')::timestamp at time zone 'America/Sao_Paulo'),
  ('R32-16', 'r32', ('2026-07-03 15:00')::timestamp at time zone 'America/Sao_Paulo')
on conflict (match_id) do update
  set kickoff_at = excluded.kickoff_at,
      stage      = excluded.stage;
