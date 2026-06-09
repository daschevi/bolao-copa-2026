-- Migration: 009_leaderboard_function
-- ─────────────────────────────────────────────────────────────────────────────
-- Cria a função get_leaderboard() que calcula pontos no servidor e devolve
-- apenas N linhas (uma por usuário) em vez de N×72 linhas brutas.
--
-- Lógica de pontuação (idêntica ao calcPoints() do TypeScript):
--   3 pts → placar exato (home_score e away_score ambos corretos)
--   1 pt  → resultado certo (sinal de home-away igual ao resultado real)
--   0 pts → erro ou jogo sem resultado ainda
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_leaderboard()
returns table (
  user_id       uuid,
  username      text,
  total_points  bigint,
  exact_count   bigint,
  correct_count bigint,
  total_bets    bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id                                                          as user_id,
    p.username,
    coalesce(sum(
      case
        -- Jogo sem resultado lançado ainda: 0 pts
        when mr.home_score is null or mr.away_score is null then 0
        -- Placar exato: 3 pts
        when b.home_score = mr.home_score
         and b.away_score = mr.away_score then 3
        -- Resultado certo (vencedor/empate): 1 pt
        when sign(b.home_score  - b.away_score)
           = sign(mr.home_score - mr.away_score) then 1
        else 0
      end
    ), 0)                                                         as total_points,
    count(case
      when mr.home_score is not null
       and b.home_score = mr.home_score
       and b.away_score = mr.away_score
      then 1 end)                                                 as exact_count,
    count(case
      when mr.home_score is not null
       and sign(b.home_score  - b.away_score)
         = sign(mr.home_score - mr.away_score)
      then 1 end)                                                 as correct_count,
    count(b.id)                                                   as total_bets
  from public.profiles p
  join public.bets b
    on b.user_id = p.id
  left join public.match_results mr
    on mr.match_id = b.match_id
  group by p.id, p.username
  having count(b.id) > 0
  order by total_points desc, exact_count desc, p.username asc
$$;

-- Garante que usuários autenticados podem chamar a função via PostgREST/RPC.
grant execute on function public.get_leaderboard() to authenticated;
