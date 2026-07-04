-- WO-01: 案件の一次入力化。要件書4.3のカラム追加 + ヨミ→stage導出関数 + 保存ビュー。
-- 加算的・非破壊。stageは追加しない(ヨミから導出。MASTER_PLAN D2)。

-- 1) opportunities 拡張（要件書4.3の差分。既存カラムは再利用）
alter table public.opportunities
  add column if not exists opportunity_type text,             -- new/existing_upsell/renewal/partner/referral
  add column if not exists customer_issue text,
  add column if not exists proposed_solution text,
  add column if not exists budget_status text,                -- confirmed/likely/unknown/none/next_fy
  add column if not exists decision_maker_status text,        -- confirmed/not_confirmed/unknown
  add column if not exists competitor text,
  add column if not exists next_action_owner_id uuid references public.profiles(id),
  add column if not exists hq_approval_status text default 'not_required',
  add column if not exists hq_comment text,
  add column if not exists proposal_doc_url text,
  add column if not exists meeting_doc_url text,
  add column if not exists reapproach_date date,
  add column if not exists solution_package_id uuid;          -- FKはWO-04(solution_packages)で付与

-- 2) ヨミ(0〜9)→ 要件書stage の導出関数（表示/集計用の別名）
create or replace function public.yomi_stage(p_yomi text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_yomi like '0%' then 'won'
    when p_yomi like '1%' then 'commit'   -- 1.A
    when p_yomi like '2%' then 'A'        -- 2.B(提案済)
    when p_yomi like '3%' then 'B'        -- 3.C
    when p_yomi like '4%' then 'C'        -- 4.アポ
    when p_yomi like '9%' then 'C'        -- 9.調整中
    when p_yomi like '5%' then 'hold'     -- 5.リスケ
    when p_yomi like '6%' then 'hold'     -- 6.定期追い
    when p_yomi like '7%' then 'lost'
    when p_yomi like '8%' then 'lost'
    else 'approach' end
$$;

-- 3) 保存ビュー(案件一覧のフィルタプリセット)
create table if not exists public.opp_view_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  owner_user_id uuid not null,
  name text not null,
  params jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.opp_view_presets enable row level security;

-- 閲覧: 自分のプリセット or 共有プリセット(同一テナント)
create policy opp_view_presets_select on public.opp_view_presets
  for select using (
    tenant_id = any(array(select current_tenant_ids()))
    and (owner_user_id = auth.uid() or is_shared)
  );
-- 追加: 自分名義でテナント内
create policy opp_view_presets_insert on public.opp_view_presets
  for insert with check (
    tenant_id = any(array(select current_tenant_ids()))
    and owner_user_id = auth.uid()
    and can_edit_role(tenant_id)
  );
-- 更新: 自分のプリセットのみ
create policy opp_view_presets_update on public.opp_view_presets
  for update using (
    tenant_id = any(array(select current_tenant_ids()))
    and owner_user_id = auth.uid()
    and can_edit_role(tenant_id)
  );
-- 削除: 自分のプリセットのみ
create policy opp_view_presets_delete on public.opp_view_presets
  for delete using (
    tenant_id = any(array(select current_tenant_ids()))
    and owner_user_id = auth.uid()
    and can_edit_role(tenant_id)
  );

create trigger set_updated_at_opp_view_presets
  before update on public.opp_view_presets
  for each row execute function public.set_updated_at();

create index if not exists idx_opp_view_presets_tenant on public.opp_view_presets(tenant_id, owner_user_id);
