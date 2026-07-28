-- =====================================================================
-- 0172: リード×メール反応のエンゲージメントMVP（展示会対応 / LEAD_TO_APPOINTMENT設計 F-201/203/204/205の初回分）
--   1) email_messages.lead_id … 送信メールをリードに直接紐付け（開封/クリックのリード帰属）
--   2) leads.priority_grade / last_engaged_at / hot_since … Fit×Engagement の優先グレード
--   3) mail_suppressions … 配信停止・バウンスの抑止リスト（特定電子メール法対応）
--   4) touchpoints の冪等キー … メール反応イベントを二重計上しない
--   5) business_cards.lead_id … 名刺→リード化の連携
--   6) batch_job_settings に engagement ジョブ行をシード（既定OFF・設定画面でON）
--   反応イベントは既存 touchpoints / person_engagement（0013）へ集約し、
--   リード一覧・詳細の既存エンゲージメント表示をそのまま活かす。
-- =====================================================================

-- ---- 1) 送信メールのリード帰属 ----
alter table public.email_messages
  add column if not exists lead_id uuid references public.leads(id) on delete set null;
create index if not exists idx_email_messages_lead on public.email_messages(lead_id) where lead_id is not null;

-- ---- 2) leads: 優先グレード（Fit×Engagement）とホット状態 ----
alter table public.leads
  add column if not exists priority_grade text,          -- 'P1'(今すぐ)〜'P5'(対象外候補)
  add column if not exists last_engaged_at timestamptz,  -- 最後にメール反応等があった時刻
  add column if not exists hot_since timestamptz;        -- P1到達時刻（再通知抑制の冪等キー）
create index if not exists idx_leads_engaged on public.leads(tenant_id, last_engaged_at desc) where last_engaged_at is not null;

-- ---- 3) 配信停止・サプレッション ----
create table if not exists public.mail_suppressions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  reason text not null default 'unsubscribe',   -- 'unsubscribe'|'bounce'|'manual'
  note text,
  source_message_id uuid references public.email_messages(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_mail_suppressions on public.mail_suppressions(tenant_id, lower(email));
alter table public.mail_suppressions enable row level security;
create policy ms_select on public.mail_suppressions for select using (tenant_id in (select current_tenant_ids()));
create policy ms_ins on public.mail_suppressions for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy ms_del on public.mail_suppressions for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- 4) touchpoints の冪等キー（メール反応の二重計上防止） ----
--   cron が meta.ref='ee:<event_id>' 等を付けて挿入する。ref付き行のみ一意制約。
create unique index if not exists uq_touchpoints_ref
  on public.touchpoints(tenant_id, type, (meta->>'ref')) where (meta ? 'ref');

-- ---- 5) 名刺→リード化の連携 ----
alter table public.business_cards
  add column if not exists lead_id uuid references public.leads(id) on delete set null;
create index if not exists idx_business_cards_lead on public.business_cards(lead_id) where lead_id is not null;

-- ---- 6) engagement ジョブの停止スイッチ行（既定OFF。設定画面でONにして開始） ----
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled)
select t.id, 'engagement', 'メール反応スコアリング',
       'メールの開封・クリック・返信を15分間隔でエンゲージメントに反映し、ホットリードを通知します。', false
from public.tenants t
on conflict (tenant_id, job_kind) do nothing;
