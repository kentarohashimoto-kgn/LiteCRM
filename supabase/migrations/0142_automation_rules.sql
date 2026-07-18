-- =====================================================================
-- WO-18: ワークフロー自動化(ユーザー定義ルール) — F-102
--   「WHEN(業務イベント) → IF(条件) → THEN(アクション)」の軽量ルールエンジン。
--   検知源は新設せず、既存の変更ログ(yomi_change_logs 0126 等)を日次/短間隔
--   cron で走査する「バッチ方式」(ユーザー決定 2026-07-18)。
--   出力は既存の Slack Webhook / notifications(0071) / tasks(origin) を再利用。
--   第一号レシピ =「ヨミC転落 → Slack + 担当へアプリ内通知」。
--
--   加算的スキーマ(既存を壊さない)。全テーブル tenant_id + RLS4点セット +
--   set_updated_at。cron は service role で走るため insert ポリシーは設けない。
-- =====================================================================

-- ---- ルール定義 (WHEN / IF / THEN) ----
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  recipe_key text,                       -- 由来レシピ(レシピ方式UI用)。NULL=手動作成
  trigger_type text not null,            -- 'yomi_changed'|'stage_changed'|'next_action_overdue' 等
  condition_json jsonb not null default '{}'::jsonb,  -- トリガー種別ごとの条件(§3.2)
  action_json jsonb not null default '[]'::jsonb,     -- アクション配列(§3.4)
  enabled boolean not null default true,
  last_evaluated_at timestamptz,         -- ログ走査の増分基準(この時刻以降の新規ログを評価)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_automation_rules_tenant on public.automation_rules(tenant_id, enabled);
create index if not exists idx_automation_rules_trigger on public.automation_rules(tenant_id, trigger_type) where enabled;
create trigger trg_automation_rules_updated before update on public.automation_rules
  for each row execute function public.set_updated_at();

alter table public.automation_rules enable row level security;

-- 参照: テナントメンバー(設定画面で状態を見せる)
drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select on public.automation_rules for select
  using (tenant_id in (select current_tenant_ids()));
-- 作成/更新/削除: owner/admin のみ(設定操作)
drop policy if exists automation_rules_insert on public.automation_rules;
create policy automation_rules_insert on public.automation_rules for insert
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
drop policy if exists automation_rules_update on public.automation_rules;
create policy automation_rules_update on public.automation_rules for update
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
drop policy if exists automation_rules_delete on public.automation_rules;
create policy automation_rules_delete on public.automation_rules for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- ---- 発火監査ログ (冪等キーで二重発火を防ぐ) ----
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_id uuid not null references automation_rules(id) on delete cascade,
  fired_at timestamptz not null default now(),
  trigger_ref text not null,             -- 例: yomi_change_logs.id。同一イベントの再処理を防ぐ
  target_type text,                      -- 'opportunity' 等
  target_id uuid,
  status text not null default 'success',-- 'success'|'partial'|'error'
  actions_result jsonb not null default '[]'::jsonb,  -- 各アクションの成否
  created_at timestamptz not null default now()
);
-- 冪等性: 同じルール×同じイベントは一度だけ
create unique index if not exists uq_automation_runs_ref on public.automation_runs(rule_id, trigger_ref);
create index if not exists idx_automation_runs_tenant_at on public.automation_runs(tenant_id, fired_at desc);

alter table public.automation_runs enable row level security;

-- 参照: テナントメンバー(発火履歴の可視化)。insert は cron(service role)経由のみ。
drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs for select
  using (tenant_id in (select current_tenant_ids()));

-- ---- 自動化ジョブの停止スイッチ + 運用ログの受け皿(既存基盤を再利用) ----
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'automation', 'ワークフロー自動化（ルール実行）',
   '有効なルールを日次/短間隔cronで評価し、Slack/アプリ内通知/タスク起票を実行。停止中は一切発火しない。', true, null)
on conflict (tenant_id, job_kind) do nothing;

-- ---- 第一号レシピ「ヨミC転落 → Slack + 担当へアプリ内通知」(初期は停止・確認後に有効化) ----
insert into public.automation_rules (tenant_id, name, recipe_key, trigger_type, condition_json, action_json, enabled)
select
  '00000000-0000-0000-0000-000000000001',
  'ヨミC転落 → Slack + 担当へ通知',
  'yomi_drop_to_c',
  'yomi_changed',
  '{"to_in": ["3.C(30%)"], "direction": "down"}'::jsonb,
  '[
     {"type": "slack_notify", "template": ":arrow_down: *{account}* が {from_yomi} → *{to_yomi}* に転落（担当 {owner}）"},
     {"type": "app_notify", "to": "owner", "title": "ヨミが3.Cに転落", "body": "{account}: {from_yomi} → {to_yomi}"}
   ]'::jsonb,
  false
where not exists (
  select 1 from public.automation_rules
  where tenant_id = '00000000-0000-0000-0000-000000000001' and recipe_key = 'yomi_drop_to_c'
);
