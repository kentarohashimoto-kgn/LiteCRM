-- =====================================================================
-- 顧客分析マトリクス: セグメント(業界分類) × ランク
--
-- 目的:
--   「どのセグメントの、どのランクの顧客を、何社持っているか」を1画面で見る。
--   セルの中に顧客名を出し、クリックで顧客・案件の詳細を右ペインで開く。
--
-- 設計メモ:
--   ・セグメントはテナントごとのマスタ(account_segments)。並び順・表示/非表示を編集できる。
--   ・既存の accounts.industry は自由入力で表記ゆれが大きい(「製造」「製造業」「製造・メーカー」)。
--     そのため各セグメントに keywords[] を持たせ、industry への部分一致で自動マッピングする。
--     手動で確定させたい顧客は accounts.segment_id を直接指定する(手動が常に優先)。
--   ・ランクは accounts.rank(手動)が最優先。未設定の顧客は取引額・企業規模から自動判定する。
--     本番の accounts は rank 未設定が 738/784 件あり、手動のみだとマトリクスがほぼ空になるため。
--     判定に使う閾値は account_rank_settings でテナントごとに変更できる。
--
-- ロールバック:
--   drop function public.account_segment_matrix(int);
--   drop function public.account_employee_count(text);
--   alter table public.accounts drop column segment_id;
--   drop table public.account_rank_settings;
--   drop table public.account_segments;
-- =====================================================================

-- ---------------------------------------------------------------------
-- セグメント(業界分類)マスタ
-- ---------------------------------------------------------------------
create table if not exists public.account_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- バッジ色(hex)。未指定なら画面側の既定色
  color text,
  -- accounts.industry への部分一致キーワード。表記ゆれの吸収用
  keywords text[] not null default '{}',
  sort_order int not null default 0,
  -- 非表示にしてもデータは消さない(所属顧客は「その他」列にまとめて出す)
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_account_segments_name on public.account_segments(tenant_id, name);
create index if not exists idx_account_segments_order on public.account_segments(tenant_id, sort_order);

alter table public.account_segments enable row level security;

drop policy if exists account_segments_sel on public.account_segments;
create policy account_segments_sel on public.account_segments for select
  using (tenant_id = any(array(select current_tenant_ids())));

drop policy if exists account_segments_ins on public.account_segments;
create policy account_segments_ins on public.account_segments for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop policy if exists account_segments_upd on public.account_segments;
create policy account_segments_upd on public.account_segments for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id))
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop policy if exists account_segments_del on public.account_segments;
create policy account_segments_del on public.account_segments for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop trigger if exists account_segments_updtrg on public.account_segments;
create trigger account_segments_updtrg before update on public.account_segments
  for each row execute function set_updated_at();

-- 顧客への手動割当(自動マッピングより常に優先)
alter table public.accounts add column if not exists segment_id uuid references public.account_segments(id) on delete set null;
create index if not exists idx_accounts_segment on public.accounts(tenant_id, segment_id);

-- ---------------------------------------------------------------------
-- ランク自動判定の閾値(テナントごと)
--   S: 大企業(s_employees名〜) または 累計受注 >= s_revenue
--   A: 中堅(a_employees名〜) または 累計受注 >= a_revenue または 進行中見込み >= a_potential
--   B: 累計受注あり または 進行中見込み >= b_potential
--   C: 案件はあるが受注も上記見込みも無い
--   D: 案件なし
-- ---------------------------------------------------------------------
create table if not exists public.account_rank_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  s_revenue   numeric not null default 100000000,  -- 1億
  a_revenue   numeric not null default  10000000,  -- 1000万
  a_potential numeric not null default 100000000,  -- 1億のポテンシャル
  b_potential numeric not null default  10000000,  -- 1000万のポテンシャル
  s_employees int not null default 1000,           -- 大企業
  a_employees int not null default  100,           -- 中堅企業
  updated_at timestamptz not null default now()
);

alter table public.account_rank_settings enable row level security;

drop policy if exists account_rank_settings_sel on public.account_rank_settings;
create policy account_rank_settings_sel on public.account_rank_settings for select
  using (tenant_id = any(array(select current_tenant_ids())));

drop policy if exists account_rank_settings_ins on public.account_rank_settings;
create policy account_rank_settings_ins on public.account_rank_settings for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop policy if exists account_rank_settings_upd on public.account_rank_settings;
create policy account_rank_settings_upd on public.account_rank_settings for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id))
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop policy if exists account_rank_settings_del on public.account_rank_settings;
create policy account_rank_settings_del on public.account_rank_settings for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));

drop trigger if exists account_rank_settings_updtrg on public.account_rank_settings;
create trigger account_rank_settings_updtrg before update on public.account_rank_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 従業員数の抽出
--   employee_size は自由入力(「1,000名以上」「101〜300名」「838名（単体）」「100〜1000名未満」)。
--   範囲表記で上振れしないよう、含まれる数値の【最小値】を採用する
--   (「301〜1000名」を1000名=大企業と誤判定しないため)。
--   既存の size_band() はカンマ入り(「1,000名以上」)を取りこぼすのでここでは使わない。
-- ---------------------------------------------------------------------
create or replace function public.account_employee_count(p text)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  -- 桁数を9桁までに制限しているのは int オーバーフロー回避(自由入力に電話番号等が混ざりうるため)
  select nullif(
    coalesce((
      select min(m[1]::int)
      from regexp_matches(replace(coalesce(p, ''), ',', ''), '([0-9]{1,9})', 'g') as m
    ), 0),
  0);
$$;

revoke execute on function public.account_employee_count(text) from public, anon;
grant execute on function public.account_employee_count(text) to authenticated;


-- ---------------------------------------------------------------------
-- セグメント・ランク解決の共通土台
--   マトリクス本体とセル明細(もっと見る)の両方がこれを使う。
--   ロジックを1箇所に閉じ込めるための関数化。security definer なので
--   参照する全テーブルに明示テナントフィルタを掛けている。
-- ---------------------------------------------------------------------
create or replace function public.account_matrix_base()
returns table (
  id uuid, name text, industry text, area text, status text, owner_name text,
  segment_id uuid, segment_manual boolean,
  rank text, rank_auto boolean,
  won numeric, open_amt numeric, opp_count bigint, open_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid[] := array(select current_tenant_ids());
begin
  if v is null or array_length(v, 1) is null then
    return;
  end if;

  return query
  with cfg as materialized (
    -- 行が無いテナントでも既定値で動く
    select
      coalesce(max(s.s_revenue),   100000000::numeric) as s_revenue,
      coalesce(max(s.a_revenue),    10000000::numeric) as a_revenue,
      coalesce(max(s.a_potential), 100000000::numeric) as a_potential,
      coalesce(max(s.b_potential),  10000000::numeric) as b_potential,
      coalesce(max(s.s_employees), 1000) as s_employees,
      coalesce(max(s.a_employees),  100) as a_employees
    from public.account_rank_settings s
    where s.tenant_id = any(v)
  ),
  seg as materialized (
    select s.id, s.name, s.keywords, s.sort_order
    from public.account_segments s
    where s.tenant_id = any(v)
  ),
  acc as materialized (
    select a.id, a.name, a.rank as manual_rank, a.segment_id, a.industry,
           a.owner_user_id, a.status, a.area,
           public.account_employee_count(a.employee_size) as employees
    from public.accounts a
    where a.tenant_id = any(v)
      and a.deleted_at is null
  ),
  opp as materialized (
    select o.account_id,
           coalesce(sum(o.amount) filter (where o.status = 'won'), 0)  as won,
           coalesce(sum(o.amount) filter (where o.status = 'open'), 0) as open_amt,
           count(*) as opp_count,
           count(*) filter (where o.status = 'open') as open_count
    from public.opportunities o
    where o.tenant_id = any(v)
      and o.account_id is not null
    group by o.account_id
  ),
  -- セグメント解決: 手動(accounts.segment_id) → industry のキーワード部分一致(sort_order順の先頭)
  resolved as materialized (
    select a.id, a.name, a.industry, a.owner_user_id, a.status, a.area, a.employees,
           coalesce(a.segment_id, k.seg_id) as segment_id,
           (a.segment_id is not null) as segment_manual,
           coalesce(o.won, 0) as won,
           coalesce(o.open_amt, 0) as open_amt,
           coalesce(o.opp_count, 0) as opp_count,
           coalesce(o.open_count, 0) as open_count,
           a.manual_rank
    from acc a
    left join opp o on o.account_id = a.id
    left join lateral (
      select s.id as seg_id
      from seg s
      where a.segment_id is null
        and a.industry is not null
        and btrim(a.industry) <> ''
        and exists (
          select 1 from unnest(s.keywords) as k(w)
          where btrim(k.w) <> '' and a.industry ilike '%' || btrim(k.w) || '%'
        )
      order by s.sort_order, s.name
      limit 1
    ) k on true
  )
  select r.id, r.name, r.industry, r.area, r.status,
         coalesce(p.display_name, p.email) as owner_name,
         r.segment_id, r.segment_manual,
         case
           -- 手動ランクが最優先。旧データの 'dormant' は D 相当に寄せる
           when r.manual_rank in ('S', 'A', 'B', 'C', 'D') then r.manual_rank
           when r.manual_rank = 'dormant' then 'D'
           when r.employees >= c.s_employees or r.won >= c.s_revenue then 'S'
           when r.employees >= c.a_employees or r.won >= c.a_revenue or r.open_amt >= c.a_potential then 'A'
           when r.won > 0 or r.open_amt >= c.b_potential then 'B'
           when r.opp_count > 0 then 'C'
           else 'D'
         end as rank,
         (r.manual_rank is null or r.manual_rank not in ('S', 'A', 'B', 'C', 'D', 'dormant')) as rank_auto,
         r.won, r.open_amt, r.opp_count, r.open_count
  from resolved r
  cross join cfg c
  left join public.profiles p on p.id = r.owner_user_id;
end $$;

revoke execute on function public.account_matrix_base() from public, anon;
grant execute on function public.account_matrix_base() to authenticated;

-- ---------------------------------------------------------------------
-- マトリクス本体
--   返り値: { settings, segments[], cells[] }
--   cells[].accounts は各セルにつき p_max_per_cell 件まで(累計受注の降順)。
--   セル全体の件数は cells[].count に入るので、画面側で「他N社」を出せる。
-- ---------------------------------------------------------------------
create or replace function public.account_segment_matrix(p_max_per_cell int default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  v_limit int := least(greatest(coalesce(p_max_per_cell, 8), 1), 100);
  result jsonb;
begin
  if v is null or array_length(v, 1) is null then
    return jsonb_build_object('segments', '[]'::jsonb, 'cells', '[]'::jsonb, 'settings', '{}'::jsonb);
  end if;

  with base as materialized (
    select * from public.account_matrix_base()
  ),
  numbered as materialized (
    select b.*,
           row_number() over (
             partition by coalesce(b.segment_id::text, '__none__'), b.rank
             order by b.won desc, b.open_amt desc, b.name
           ) as rn
    from base b
  ),
  cells as (
    select coalesce(n.segment_id::text, '__none__') as segment_key,
           n.rank,
           count(*) as cnt,
           sum(n.won) as won,
           sum(n.open_amt) as open_amt,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'id', n.id, 'name', n.name, 'industry', n.industry, 'area', n.area,
               'status', n.status, 'ownerName', n.owner_name,
               'won', n.won, 'openAmount', n.open_amt,
               'oppCount', n.opp_count, 'openCount', n.open_count,
               'rankAuto', n.rank_auto, 'segmentManual', n.segment_manual
             ) order by n.won desc, n.open_amt desc, n.name
           ) filter (where n.rn <= v_limit), '[]'::jsonb) as accounts
    from numbered n
    group by 1, 2
  )
  select jsonb_build_object(
    'settings', (
      select to_jsonb(x) from (
        select
          coalesce(max(s.s_revenue),   100000000::numeric) as s_revenue,
          coalesce(max(s.a_revenue),    10000000::numeric) as a_revenue,
          coalesce(max(s.a_potential), 100000000::numeric) as a_potential,
          coalesce(max(s.b_potential),  10000000::numeric) as b_potential,
          coalesce(max(s.s_employees), 1000) as s_employees,
          coalesce(max(s.a_employees),  100) as a_employees
        from public.account_rank_settings s where s.tenant_id = any(v)
      ) x
    ),
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'color', s.color,
               'keywords', to_jsonb(s.keywords),
               'sortOrder', s.sort_order, 'isVisible', s.is_visible
             ) order by s.sort_order, s.name)
      from public.account_segments s where s.tenant_id = any(v)
    ), '[]'::jsonb),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
               'segmentKey', c.segment_key, 'rank', c.rank, 'count', c.cnt,
               'won', c.won, 'openAmount', c.open_amt, 'accounts', c.accounts
             ))
      from cells c
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.account_segment_matrix(int) from public, anon;
grant execute on function public.account_segment_matrix(int) to authenticated;

-- ---------------------------------------------------------------------
-- セル明細(「他N社」を開いたときの続き)
--   p_segment に '__none__' を渡すと未分類セル。
-- ---------------------------------------------------------------------
create or replace function public.account_segment_rank_accounts(
  p_segment text,
  p_rank text,
  p_offset int default 0,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  with base as materialized (
    select b.* from public.account_matrix_base() b
    where b.rank = p_rank
      and coalesce(b.segment_id::text, '__none__') = coalesce(nullif(p_segment, ''), '__none__')
  ),
  ordered as materialized (
    select b.*, row_number() over (order by b.won desc, b.open_amt desc, b.name) as rn,
           count(*) over () as total
    from base b
  )
  select jsonb_build_object(
    'total', coalesce((select max(o.total) from ordered o), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name, 'industry', o.industry, 'area', o.area,
               'status', o.status, 'ownerName', o.owner_name,
               'won', o.won, 'openAmount', o.open_amt,
               'oppCount', o.opp_count, 'openCount', o.open_count,
               'rankAuto', o.rank_auto, 'segmentManual', o.segment_manual
             ) order by o.rn)
      from ordered o
      where o.rn > v_offset and o.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.account_segment_rank_accounts(text, text, int, int) from public, anon;
grant execute on function public.account_segment_rank_accounts(text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 既定セグメントの投入
--   既存 accounts.industry の表記ゆれを吸収できるキーワードを付けておく。
--   すでにセグメントを1件でも持つテナントには入れない(再実行しても壊さない)。
-- ---------------------------------------------------------------------
insert into public.account_segments (tenant_id, name, color, keywords, sort_order)
select t.id, d.name, d.color, d.keywords, d.sort_order
from public.tenants t
cross join (values
  ('住宅・建築',       '#F59A2A', array['住宅', '建築', '建設', '不動産', '工務店', 'リフォーム'],           10),
  ('IT・ソフトウェア', '#008C8C', array['IT', 'ソフトウェア', 'SaaS', 'システム', '情報', 'Web', 'AI', 'DX'], 20),
  ('製造',             '#3B82F6', array['製造', 'メーカー', '電機', '電気製品', '機械', '部品', '自動車'],   30),
  ('金融・保険',       '#8B5CF6', array['金融', '保険', '銀行', '証券', 'リース'],                           40),
  ('人材・教育',       '#10B981', array['人材', '教育', '研修', '採用', 'スクール'],                         50),
  ('医療・介護',       '#EC4899', array['医療', 'ヘルスケア', '介護', '病院', '調剤', '福祉'],               60),
  ('小売・EC',         '#F97316', array['小売', 'EC', '通販', 'アパレル', '店舗'],                           70),
  ('物流・運輸',       '#0EA5E9', array['物流', '運輸', '運送', '倉庫', '鉄道', '海運'],                     80),
  ('商社・卸',         '#6366F1', array['商社', '卸', '貿易'],                                               90),
  ('飲食・食品',       '#EF4444', array['飲食', '食品', '外食', 'フード'],                                  100),
  ('コンサル・士業',   '#14B8A6', array['コンサル', '士業', '法律', '会計', '税理', '専門サービス'],         110),
  ('広告・メディア',   '#A855F7', array['広告', 'メディア', '出版', '印刷', 'マーケティング'],               120)
) as d(name, color, keywords, sort_order)
where not exists (
  select 1 from public.account_segments s where s.tenant_id = t.id
)
on conflict (tenant_id, name) do nothing;

-- 閾値の既定行(未作成テナントのみ)
insert into public.account_rank_settings (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;
