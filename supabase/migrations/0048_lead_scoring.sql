-- WO-06: リードスコアリング。要件書4.10の5軸(規模/役職/課題/時期/相性)でスコア0-100とランクS-D。
-- ※ needs/timing 等の質的データが未整備の間は規模+役職中心のスコアになる（データ拡充で精度向上）。

alter table public.leads
  add column if not exists lead_score integer,
  add column if not exists lead_score_detail jsonb,
  add column if not exists nurture_status text default 'not_started',  -- not_started/active/mql/sql/converted/unsubscribed
  add column if not exists first_contact_due_date date,
  add column if not exists converted_opportunity_id uuid references public.opportunities(id);

-- スコアリングRPC（一括 or 単一）。SECURITY DEFINER + 明示テナント + authenticated限定。
create or replace function public.rescore_leads(p_lead_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  n integer;
begin
  with base as materialized (
    select l.id,
      -- 規模(最大20): employee_size 内の最大ASCII数値で判定
      (select coalesce(max((m[1])::int), 0) from regexp_matches(coalesce(l.employee_size,''), '([0-9]+)', 'g') as m) as emp_num,
      l.role_level, l.job_title, coalesce(l.needs,'') as needs, coalesce(l.timing,'') as timing,
      coalesce(l.tags::text,'') as tags, l.industry, l.budget_band
    from leads l
    where l.tenant_id = any(v) and (p_lead_id is null or l.id = p_lead_id)
  ),
  scored as (
    select id,
      -- size(20)
      (case when emp_num >= 1000 then 20 when emp_num >= 300 then 15 when emp_num >= 100 then 10 when emp_num >= 30 then 5 when emp_num > 0 then 2 else 0 end) as s_size,
      -- role(20)
      (case when role_level in ('exec','officer') then 20 when role_level = 'manager' then 12 when role_level = 'staff' then 4 else 0 end
        + case when coalesce(job_title,'') ~ '社長|代表|役員|取締役|CxO|CEO|CTO' then 5 else 0 end) as s_role_raw,
      -- issue(25): needs のキーワード
      least(25, (case when needs ~ 'AI導入|生成AI' then 15 else 0 end)
        + case when needs ~ '効率|生産性' then 10 else 0 end
        + case when needs ~ '問い合わせ|問合せ|チャットボット' then 15 else 0 end
        + case when needs ~ '研修|人材育成' then 10 else 0 end) as s_issue,
      -- timing(15)
      (case when timing ~ '1[-〜~]?3|即|今|1ヶ月|3ヶ月' then 15 when timing ~ '半年|6ヶ月' then 10 when timing ~ '来期|来年' then 5 else 0 end) as s_timing,
      -- fit(20): 関心/タグ
      least(20, (case when (needs||tags) ~ 'SUISHIN' then 20 else 0 end)
        + case when (needs||tags) ~ '研修' then 15 else 0 end
        + case when (needs||tags) ~ '顧問' then 15 else 0 end
        + case when (needs||tags) ~ 'Dify|RAG|開発' then 15 else 0 end
        + case when (needs||tags) ~ '情シス|情報システム' then 15 else 0 end) as s_fit
    from base
  ),
  final as (
    select id, s_size, least(20, s_role_raw) as s_role, s_issue, s_timing, s_fit,
      (s_size + least(20, s_role_raw) + s_issue + s_timing + s_fit) as total
    from scored
  )
  update leads l set
    lead_score = f.total,
    lead_score_detail = jsonb_build_object(
      'size', f.s_size, 'role', f.s_role, 'issue', f.s_issue, 'timing', f.s_timing, 'fit', f.s_fit,
      'auto_rank', case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end
    ),
    -- rank は「未設定のときだけ」自動判定で補完（既存の手動/取込ランクは保持）
    rank = coalesce(nullif(l.rank, ''), case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end),
    first_contact_due_date = case
      when f.total >= 80 then current_date + 1
      when f.total >= 65 then current_date + 3
      when f.total >= 50 then current_date + 7
      else null end
  from final f
  where l.id = f.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.rescore_leads(uuid) from public, anon;
grant execute on function public.rescore_leads(uuid) to authenticated;
