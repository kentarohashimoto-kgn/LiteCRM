-- =====================================================================
-- 0185: 施策実行（WO-35 / F-303）
--   承認した提案を「実行チケット」にし、成果物・反映記録まで管理する。
--   HP本体への自動デプロイはしない(v1)。事故時の影響が大きいため、
--   「指示書を渡す → 反映されたら記録する」の運用で回す。
--   反映日(applied_at)が効果検証(WO-36)の起点マーカーになる。
--   ロールバック: drop table seo_actions;
-- =====================================================================
create table if not exists public.seo_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  proposal_id uuid references public.seo_proposals(id) on delete set null,
  action_type text not null,
  execution_mode text not null default 'external',  -- external|content|app|manual
  title text not null,
  target_query text not null default '',
  target_page text not null default '',
  expected_json jsonb not null default '{}'::jsonb,
  -- 成果物。決定的テンプレートで生成し、AIが後から中身を上書きする
  deliverable_md text,
  options_json jsonb,                       -- タイトル案・メタ案など
  ai_generated_at timestamptz,
  -- G6: 反映前スナップショット。負けたときに戻せるようにする
  before_snapshot jsonb,
  assignee_user_id uuid references auth.users(id),
  due_date date,
  status text not null default 'todo',
    -- todo|in_progress|review|waiting_deploy|deployed|verifying|done|canceled
  content_idea_id uuid references public.content_ideas(id) on delete set null,
  applied_at timestamptz,                   -- ★効果検証の起点
  applied_by uuid references auth.users(id),
  verify_after_days int not null default 14,
  verify_due_at timestamptz,                -- applied_at + verify_after_days
  reverted_at timestamptz,
  revert_reason text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_seo_actions_board on public.seo_actions(site_id, status, created_at desc);
create index if not exists idx_seo_actions_verify on public.seo_actions(tenant_id, status, verify_due_at);
-- G3: 同一ページに未完了の施策が並走すると効果の帰属が不能になる。
-- 検出用の索引（強制はアプリ側で行い、例外運用を止めない）
create index if not exists idx_seo_actions_open_page
  on public.seo_actions(site_id, target_page)
  where status not in ('done','canceled');

-- 反映日から検証期限を自動計算する（人の入力漏れで検証が走らないのを防ぐ）
create or replace function public.seo_actions_set_verify_due()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.applied_at is not null then
    new.verify_due_at := new.applied_at + make_interval(days => coalesce(new.verify_after_days, 14));
  else
    new.verify_due_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_seo_actions_verify_due on public.seo_actions;
create trigger trg_seo_actions_verify_due before insert or update on public.seo_actions
  for each row execute function public.seo_actions_set_verify_due();

drop trigger if exists trg_seo_actions_updated on public.seo_actions;
create trigger trg_seo_actions_updated before update on public.seo_actions
  for each row execute function public.set_updated_at();

alter table public.seo_actions enable row level security;
drop policy if exists seo_actions_sel on public.seo_actions;
drop policy if exists seo_actions_ins on public.seo_actions;
drop policy if exists seo_actions_upd on public.seo_actions;
drop policy if exists seo_actions_del on public.seo_actions;
create policy seo_actions_sel on public.seo_actions for select
  using (tenant_id in (select current_tenant_ids()));
create policy seo_actions_ins on public.seo_actions for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_actions_upd on public.seo_actions for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_actions_del on public.seo_actions for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

comment on table public.seo_actions is 'SEO施策の実行チケット。applied_at が効果検証の起点マーカー';
comment on column public.seo_actions.before_snapshot is '反映前の状態。効果が悪化した場合に戻せるようにする';

-- 成果物のAI生成ジョブ（既定OFF。指示書は決定的テンプレートで既に渡せる状態）
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'seo_action_draft', 'SEO成果物のAI生成（夜間）',
   '承認済み施策のタイトル案・改訂稿・指示書本文をAIが作成する。1晩5件まで。',
   false, '指示書は決定的テンプレートで生成済み。AIによる案の具体化は品質確認後に開始する')
on conflict (tenant_id, job_kind) do nothing;
