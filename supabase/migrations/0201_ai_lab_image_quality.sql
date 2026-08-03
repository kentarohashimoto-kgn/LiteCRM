-- =====================================================================
-- AI Lab: 画質(low/medium/high)の選択と、High の1日あたり枚数制限
--
--   High は Medium の約4倍・Low の約35倍の単価になるため、選べるようにしたうえで
--   「1人1日10枚まで」で止める。研修で画質とコストの関係を体感してもらいつつ、
--   連打されても費用が読める状態を保つのが狙い。
--
--   運営（橋本・平石）は検証で枚数を要するため、この制限の対象外とする。
-- =====================================================================

-- 制限の対象外にする利用者。既定は false（＝制限あり）。
alter table public.ai_lab_users
  add column if not exists is_unlimited boolean not null default false;

comment on column public.ai_lab_users.is_unlimited is
  '画質Highの1日あたり枚数制限を免除する。運営の検証用アカウントにだけ立てる。';

-- High の枚数だけを別に数える。
-- images に混ぜると「Highを何枚使ったか」が後から分けられず、制限の判定ができない。
alter table public.ai_lab_usage_daily
  add column if not exists high_images integer not null default 0;

-- 集計RPCに high_images を足す。既存の呼び出しを壊さないよう既定値を持たせる。
create or replace function public.ai_lab_add_usage(
  p_tenant uuid,
  p_company uuid,
  p_user uuid,
  p_date date,
  p_model text,
  p_requests integer,
  p_in bigint,
  p_out bigint,
  p_images integer,
  p_high_images integer default 0
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.ai_lab_usage_daily as u
    (tenant_id, company_id, user_id, date, model_key, requests, input_tokens, output_tokens, images, high_images)
  values (p_tenant, p_company, p_user, p_date, p_model, p_requests, p_in, p_out, p_images, p_high_images)
  on conflict (company_id, user_id, date, model_key) do update
    set requests      = u.requests + excluded.requests,
        input_tokens  = u.input_tokens + excluded.input_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        images        = u.images + excluded.images,
        high_images   = u.high_images + excluded.high_images;
$function$;

-- 当日の High 枚数を1人ぶん引くための索引。
create index if not exists idx_ai_lab_usage_user_date on public.ai_lab_usage_daily(user_id, date);
