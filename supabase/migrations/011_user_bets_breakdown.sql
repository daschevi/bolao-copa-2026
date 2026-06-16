-- Migration: 011_user_bets_breakdown
-- ─────────────────────────────────────────────────────────────────────────────
-- RPC que devolve o detalhamento jogo a jogo dos palpites de QUALQUER usuário,
-- usada pela página de Classificação (modal de pontuação ao clicar numa linha).
--
-- Lê da MESMA fonte do get_leaderboard() (bets + match_results) e usa a MESMA
-- pontuação canônica (exato=3, resultado certo=1, senão 0), garantindo que a
-- soma do detalhamento reconcilie exatamente com o total exibido no ranking.
--
-- security definer: o betsStore do cliente só guarda os palpites do usuário
-- logado (os dos demais são descartados — o leaderboard vem por RPC). Para
-- detalhar outro usuário, a leitura precisa rodar no servidor.
--
-- Aplicar no Supabase Studio → SQL Editor → New Query → Run.
-- Idempotente: CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_user_bets_breakdown(p_user_id uuid)
returns table (
  match_id     text,
  bet_home     int,
  bet_away     int,
  result_home  int,
  result_away  int,
  points       int,
  played       boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.match_id,
    b.home_score  as bet_home,
    b.away_score  as bet_away,
    mr.home_score as result_home,
    mr.away_score as result_away,
    case
      when mr.home_score is null or mr.away_score is null then 0
      when b.home_score = mr.home_score and b.away_score = mr.away_score then 3
      when sign(b.home_score - b.away_score) = sign(mr.home_score - mr.away_score) then 1
      else 0
    end as points,
    (mr.home_score is not null and mr.away_score is not null) as played
  from public.bets b
  left join public.match_results mr on mr.match_id = b.match_id
  where b.user_id = p_user_id
$$;

grant execute on function public.get_user_bets_breakdown(uuid) to authenticated;
