-- =====================================================================
-- 商談(meetings): 案件(opportunities)配下の個別商談(面談/折衝)レコード
--
-- 階層: 顧客(accounts) > 案件(opportunities) > 商談(meetings)
--   案件は金額/ステージ/ヨミを持つ営業案件。
--   商談は案件の中で行われた個々の商談(1回ごと)。複数回ぶら下がる。
-- =====================================================================

create table meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  account_id uuid references accounts(id),
  owner_user_id uuid not null references auth.users(id),
  title text not null,
  meeting_date date,
  meeting_at timestamptz,            -- 時刻(任意。今後データ整備)
  method text,                       -- 訪問 / オンライン / 電話 など
  summary text,                      -- 議事・要点
  next_action_date date,
  next_action_text text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_meetings_opp on meetings(opportunity_id);
create index idx_meetings_tenant_date on meetings(tenant_id, meeting_date);

create trigger trg_meetings_updated before update on meetings for each row execute function set_updated_at();

alter table meetings enable row level security;

-- 参照: テナント内で全件閲覧ロール、または自分担当 / 親案件の担当
create policy meetings_select on meetings for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id)
      or owner_user_id = auth.uid()
      or exists (select 1 from opportunities o where o.id = meetings.opportunity_id and o.owner_user_id = auth.uid())
    )
  );
create policy meetings_ins on meetings for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy meetings_upd on meetings for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy meetings_del on meetings for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
