-- ============================================================
-- 案件のネクストアクションを「複数」持てるようにする
--   - ネクストアクションの実体は tasks(origin='next_action')。
--     1案件に複数のオープンな next_action タスクを許容する。
--   - 商談(meetings)ごとの次アクションは、その商談に紐づく
--     next_action タスク（source_meeting_id）を1件だけ upsert する。
--       * 同じ商談を再保存しても重複しない
--       * 空で保存するとその商談のネクストアクションは消える
--   - opportunities.next_action_date/text は従来どおり
--     「手動/主ネクストアクション（source_meeting_id が NULL の1件）」の
--     キャッシュとして温存し、既存の入力経路（活動記録・クイック入力・
--     インライン編集・アポ登録・一括取込）は無改修で動く。
--   - 一覧/サマリの「次アクション」表示は、未完了で最も近い期日の
--     next_action タスク（＝案件横断で最も直近のネクストアクション）に切替える。
-- ============================================================

-- 商談との紐付け列。商談が消えたら、その商談発のネクストアクションも消す。
alter table public.tasks
  add column if not exists source_meeting_id uuid references public.meetings(id) on delete cascade;

create index if not exists idx_tasks_source_meeting
  on public.tasks(source_meeting_id) where source_meeting_id is not null;

-- ------------------------------------------------------------
-- opp→task 同期トリガーを「主ネクストアクション(source_meeting_id が NULL)」に限定
--   商談発(source_meeting_id 有り)のタスクを opportunities カラムの
--   変更で上書き/削除しないようにする。挿入は従来どおり NULL(=主) で作る。
-- ------------------------------------------------------------
create or replace function public.sync_next_action_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_task_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.next_action_date is not distinct from old.next_action_date
     and new.next_action_text is not distinct from old.next_action_text
     and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'open' and new.next_action_date is not null then
    v_title := coalesce(nullif(btrim(new.next_action_text), ''), '次回アクション');
    -- 既存のオープンな「主」next_action タスク(source_meeting_id NULL)があれば更新、無ければ作成
    select id into v_task_id
    from public.tasks
    where opportunity_id = new.id and origin = 'next_action'
      and source_meeting_id is null and status <> 'done'
    order by created_at desc
    limit 1;

    if v_task_id is not null then
      update public.tasks
      set title = v_title, due_date = new.next_action_date, account_id = new.account_id, updated_at = now()
      where id = v_task_id;
    else
      insert into public.tasks
        (tenant_id, opportunity_id, account_id, assigned_to, created_by, title, due_date, status, priority, origin)
      values
        (new.tenant_id, new.id, new.account_id, new.owner_user_id, new.owner_user_id,
         v_title, new.next_action_date, 'todo', 'middle', 'next_action');
    end if;
  else
    -- 次回AC未設定 or 案件クローズ: 自動生成のオープンな「主」ACタスクのみ片付ける
    delete from public.tasks
    where opportunity_id = new.id and origin = 'next_action'
      and source_meeting_id is null and status <> 'done';
  end if;

  return new;
end $$;

-- ============================================================
-- 案件一覧 RPC: 「次アクション」を未完了で最も近い期日の
-- next_action タスクから算出する（案件横断で最も直近のネクストアクション）。
--   （0136 の定義に nearest-open ラテラル結合 na を足して再作成）
-- ============================================================
CREATE OR REPLACE FUNCTION public.opportunities_page(p_filter jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'expected_close_date'::text, p_asc boolean DEFAULT true, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  yomi text[] := case when jsonb_typeof(p_filter->'yomi') = 'array' and jsonb_array_length(p_filter->'yomi') > 0
                      then array(select jsonb_array_elements_text(p_filter->'yomi')) else null end;
  f_owner uuid := nullif(p_filter->>'owner', '')::uuid;
  f_product uuid := nullif(p_filter->>'product', '')::uuid;
  f_source uuid := nullif(p_filter->>'source', '')::uuid;
  f_sd text := nullif(p_filter->>'campaign', '');
  only_no_next boolean := coalesce((p_filter->>'only_no_next')::boolean, false);
  only_stale boolean := coalesce((p_filter->>'only_stale')::boolean, false);
  sort_col text := case p_sort
    when 'name' then 'a.name'
    when 'yomi' then 'o.yomi'
    when 'owner' then 'p.display_name'
    when 'product' then 'pr.name'
    when 'source_detail' then 'o.source_detail'
    when 'stage' then 'o.stage'
    when 'amount' then 'o.amount'
    when 'probability' then 'o.probability'
    when 'next_action_date' then 'coalesce(na.due, o.next_action_date)'
    when 'last_activity_at' then 'o.last_activity_at'
    when 'meeting_count' then '(select count(*) from meetings mt where mt.opportunity_id = o.id)'
    when 'last_meeting_date' then '(select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id)'
    else 'o.expected_close_date' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with f as (
      select o.id, o.name, a.name as account_name, o.yomi, o.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
        o.primary_product_id, pr.name as product_name, o.campaign_id, c.name as campaign_name, o.campaign_estimated,
        o.lead_source_id, ls.name as source_name, o.source_detail,
        o.amount, o.stage, o.probability, o.forecast_category, o.status, o.deal_phase,
        o.expected_close_date, o.expected_revenue_month,
        coalesce(na.due, o.next_action_date) as next_action_date,
        coalesce(na.title, o.next_action_text) as next_action_text,
        o.notes, o.last_activity_at,
        o.risk_level, o.first_meeting_date, o.appointment_at, o.created_at, o.updated_at,
        (select count(*) from meetings mt where mt.opportunity_id = o.id)::int as meeting_count,
        (select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id) as last_meeting_date,
        case
          when na.due is not null then 'open'
          when exists(select 1 from tasks t where t.opportunity_id = o.id and t.origin = 'next_action' and t.status = 'done') then 'done'
          else null
        end as next_action_status,
        coalesce(
          na.id,
          (select t.id from tasks t where t.opportunity_id = o.id and t.origin = 'next_action'
             order by (t.status = 'done') asc, t.created_at desc limit 1)
        ) as next_action_task_id,
        round(o.amount * o.probability / 100.0) as weighted,
        count(*) over() as total,
        sum(o.amount) over() as sum_amount,
        sum(round(o.amount * o.probability / 100.0)) over() as sum_weighted,
        row_number() over(order by %s %s nulls last) as rn
      from opportunities o
        left join accounts a on a.id = o.account_id
        left join profiles p on p.id = o.owner_user_id
        left join products pr on pr.id = o.primary_product_id
        left join campaigns c on c.id = o.campaign_id
        left join lead_sources ls on ls.id = o.lead_source_id
        left join lateral (
          select t.id, t.due_date as due, t.title
          from tasks t
          where t.opportunity_id = o.id and t.origin = 'next_action' and t.status <> 'done'
          order by t.due_date asc nulls last, t.created_at desc
          limit 1
        ) na on true
      where o.tenant_id = any($1)
        and o.deleted_at is null
        and ($2 is null or o.name ilike '%%' || $2 || '%%' or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or o.yomi = any($3))
        and ($4 is null or o.owner_user_id = $4)
        and ($5 is null or o.primary_product_id = $5)
        and ($6 is null or o.lead_source_id = $6)
        and ($7 is null or btrim(o.source_detail) = $7)
        and (not $8 or (o.status = 'open' and na.due is null))
        and (not $9 or (o.status = 'open' and o.last_activity_at < now() - interval '7 day'))
      order by %s %s nulls last
      limit $10 offset $11
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' - 'sum_amount' - 'sum_weighted' - 'rn' order by f.rn), '[]'::jsonb),
      'total', coalesce(max(f.total), 0),
      'sum_amount', coalesce(max(f.sum_amount), 0),
      'sum_weighted', coalesce(max(f.sum_weighted), 0)
    ) from f
  $f$, sort_col, dir, sort_col, dir)
  into result
  using v, q, yomi, f_owner, f_product, f_source, f_sd, only_no_next, only_stale, p_limit, p_offset;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_amount', 0, 'sum_weighted', 0));
end $function$;
