-- 0179 開封の重複丸め補正: 画像プロキシのIPローテーションに対応
--
-- 0178の重複判定キーは (email_message_id, user_agent, ip_hash) だったが、Gmailの画像プロキシ
-- (ggpht.com GoogleImageProxy)は取得のたびに別IPから来るため、同じ人が同じメールを
-- 再表示しただけでも別クライアント扱いになり、開封回数が積み上がっていた
-- (実例: 1通に GoogleImageProxy の open が4件)。
--
-- 対応: 既知の画像プロキシUAについてはIPを見ず、UA+30分の窓だけで丸める。
-- 通常のクライアント(直接取得)は従来どおりIPも一致条件に含める。

create or replace function public.is_image_proxy_ua(p_ua text)
returns boolean language sql immutable as $$
  select coalesce(p_ua ~* '(googleimageproxy|ggpht\.com|yahoomailproxy|imageproxy|mail\.protection\.outlook)', false);
$$;
comment on function public.is_image_proxy_ua(text) is
  'メールサービスの画像プロキシ経由の取得か(true=実開封だがIPが毎回変わるため重複判定でIPを見ない)。';

create or replace function public.track_email_open(p_token text, p_ua text default null, p_ip text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_tenant uuid; v_kind text; v_dup boolean; v_ignore_ip boolean;
begin
  select id, tenant_id into v_id, v_tenant from email_messages where track_token = p_token;
  if v_id is null then return; end if;

  if is_open_bot_ua(p_ua) then
    v_kind := 'open_bot';
  else
    -- 画像プロキシはIPが毎回変わるのでUAのみで同一クライアントとみなす
    v_ignore_ip := is_image_proxy_ua(p_ua);
    select exists (
      select 1 from email_events e
      where e.email_message_id = v_id
        and e.kind = 'open'
        and e.user_agent is not distinct from p_ua
        and (v_ignore_ip or e.ip_hash is not distinct from p_ip)
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

-- ---- 既存データの再判定(プロキシ経由分をUAのみのキーで丸め直す) ----
with ranked as (
  select id,
         lag(occurred_at) over (
           partition by email_message_id, coalesce(user_agent, '')
           order by occurred_at
         ) as prev_at,
         occurred_at
    from public.email_events
   where kind = 'open' and is_image_proxy_ua(user_agent)
)
update public.email_events e
   set kind = 'open_dup'
  from ranked r
 where r.id = e.id
   and r.prev_at is not null
   and r.occurred_at <= r.prev_at + interval '30 minutes';

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
