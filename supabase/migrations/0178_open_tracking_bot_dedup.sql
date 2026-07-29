-- 0178 開封トラッキングの精度改善: ボットUAの除外と同一クライアント重複の丸め
--
-- 背景(2026-07-29 実データ): テスト送信1通に対し open が2件記録された。内訳は
--   ・"...Chrome/42.0.2311.135 ... Edge/12.246 Mozilla/5.0"(送信25秒後) = 受信側スキャナの先読み
--   ・"...(via ggpht.com GoogleImageProxy)"(送信30秒後)                = 実際の開封
-- track_email_open(0144)はピクセル取得のたびに無条件で open_count を加算するため、
-- スキャナの先読みや同一クライアントの再取得がそのまま「開封N回」に乗っていた。
--
-- 方針:
--   ・ボット/スキャナ判定のUA                        → kind='open_bot' で記録し加算しない
--   ・同一メール×同一(ip_hash,user_agent)で30分以内 → kind='open_dup' で記録し加算しない
--   ・記録自体は残す(判定の見直し・後追い調査ができるように)
--   ・kind='open' 以外は既存の集計(0174のリードメール集計・engagement cron)から自動的に外れる
-- 開封はピクセル方式である以上あくまで近似値。ここでの判定はヒューリスティックで、
-- 「人の開封を落とさない」側に倒す(判定に迷うものは open として数える)。

-- ---- ボット/スキャナのUA判定 ----
create or replace function public.is_open_bot_ua(p_ua text)
returns boolean language sql immutable as $$
  select case
    -- UA不明は人間側に倒す(取りこぼしを避ける)
    when p_ua is null or btrim(p_ua) = '' then false
    -- 明示的なボット/メールセキュリティ製品/HTTPクライアント
    -- ※ GoogleImageProxy(Gmailが表示時に画像を取得する=実開封)は意図的に含めない
    when p_ua ~* '(bot|crawler|spider|scan|preview|monitor|fetcher|proofpoint|mimecast|barracuda|forcepoint|symantec|trend ?micro|bitdefender|safelinks|curl|wget|python|java/|go-http|okhttp|headless|phantomjs|axios|libwww|apache-httpclient)' then true
    -- "Mozilla/5.0 ... Mozilla/5.0" と二重に名乗るのはスキャナの偽装UAの典型
    when p_ua ~* 'mozilla.+mozilla' then true
    -- 実在しない古いエンジン(MSIE/Trident/EdgeHTML/Chrome 59以前)を名乗るものは偽装とみなす
    when p_ua ~* '(msie |trident/|edge/1[0-9]\.|chrome/([1-9]|[1-5][0-9])\.)' then true
    else false
  end;
$$;
comment on function public.is_open_bot_ua(text) is
  '開封ピクセル取得元のUAがボット/スキャナかを判定する(true=開封として数えない)。判定に迷うものは false に倒す。';

-- ---- 開封記録RPC(ボット除外 + 30分の重複丸めを追加) ----
create or replace function public.track_email_open(p_token text, p_ua text default null, p_ip text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_tenant uuid; v_kind text; v_dup boolean;
begin
  select id, tenant_id into v_id, v_tenant from email_messages where track_token = p_token;
  if v_id is null then return; end if;

  if is_open_bot_ua(p_ua) then
    v_kind := 'open_bot';
  else
    -- 同一メールを同じクライアント(IPハッシュ+UA)が30分以内に再取得したら重複とみなす。
    -- スクロール・再表示・プロキシの多重取得を1回に丸める。
    select exists (
      select 1 from email_events e
      where e.email_message_id = v_id
        and e.kind = 'open'
        and e.user_agent is not distinct from p_ua
        and e.ip_hash is not distinct from p_ip
        and e.occurred_at > now() - interval '30 minutes'
    ) into v_dup;
    v_kind := case when v_dup then 'open_dup' else 'open' end;
  end if;

  insert into email_events (tenant_id, email_message_id, kind, user_agent, ip_hash)
    values (v_tenant, v_id, v_kind, p_ua, p_ip);

  if v_kind = 'open' then
    update email_messages set open_count = open_count + 1, last_opened_at = now() where id = v_id;
  end if;
end $$;
revoke execute on function public.track_email_open(text, text, text) from public, anon, authenticated;
grant execute on function public.track_email_open(text, text, text) to service_role;

-- ---- 既存データの再判定(過去の開封回数も同じ基準に揃える) ----
-- 1) ボットUAの open を open_bot へ
update public.email_events
   set kind = 'open_bot'
 where kind = 'open' and is_open_bot_ua(user_agent);

-- 2) 同一メール×同一クライアントで30分以内に連続した open を open_dup へ
--    (過去分は直前の open との間隔で近似する。以降の記録はRPC側の判定が正)
with ranked as (
  select id,
         lag(occurred_at) over (
           partition by email_message_id, coalesce(user_agent, ''), coalesce(ip_hash, '')
           order by occurred_at
         ) as prev_at,
         occurred_at
    from public.email_events
   where kind = 'open'
)
update public.email_events e
   set kind = 'open_dup'
  from ranked r
 where r.id = e.id
   and r.prev_at is not null
   and r.occurred_at <= r.prev_at + interval '30 minutes';

-- 3) open_count / last_opened_at を kind='open' から再計算
with agg as (
  select e.email_message_id as id,
         count(*) filter (where e.kind = 'open') as c,
         max(e.occurred_at) filter (where e.kind = 'open') as mx
    from public.email_events e
   where e.kind in ('open', 'open_bot', 'open_dup')
   group by e.email_message_id
)
update public.email_messages m
   set open_count = agg.c,
       last_opened_at = agg.mx
  from agg
 where agg.id = m.id
   and (m.open_count is distinct from agg.c or m.last_opened_at is distinct from agg.mx);
