-- =====================================================================
-- WO-20(第一弾): メール連携 — F-101a(選択肢B / OAuth不要)
--   既存の Google 連携は Calendar の ICS フィード(一方向・トークン)のみで、
--   OAuth 基盤は無い。よって「常時受信同期(選択肢A)」は Google OAuth の新設が
--   前提になるため後続に回し、まず資格情報不要で今日から価値が出る:
--     ・email_templates … 定型文(お礼/資料送付/日程調整)をテナントで共有・変数差込
--     ・email_messages  … 送受信メールのメタ+名寄せ(顧客/担当者/商談)ログ
--   から着手する。送信は「Gmail送信画面を開いて人が送る」= 確定原則(送信は手動)。
--   記録は activities(type='email') と紐付けてタイムラインに自動反映。
--   このデータモデルが後続の F-101b(シーケンス)・F-101c(開封追跡)の土台になる。
--
--   加算的スキーマ。全テーブル tenant_id + RLS4点セット + set_updated_at。
-- =====================================================================

-- ---- メール定型文(テナント共有・変数差込) ----
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text not null default 'other',   -- 'thanks'|'material'|'schedule'|'followup'|'other'
  subject_tmpl text not null default '',
  body_tmpl text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_email_templates_tenant on public.email_templates(tenant_id, category);
create trigger trg_email_templates_updated before update on public.email_templates
  for each row execute function public.set_updated_at();

alter table public.email_templates enable row level security;

-- 参照: テナントメンバー全員(定型文は組織で共有)
drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates for select
  using (tenant_id in (select current_tenant_ids()));
-- 作成/更新/削除: 編集ロール
drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- メールログ(送受信メタ + 名寄せ) ----
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  direction text not null default 'out',    -- 'out'(送信)|'in'(受信)
  subject text,
  snippet text,                             -- 本文抜粋(全文は保持しない=容量/プライバシー)
  to_addrs text[] not null default '{}',
  from_addr text,
  contact_id uuid references contacts(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete cascade,
  template_id uuid references email_templates(id) on delete set null,
  activity_id uuid references activities(id) on delete set null,  -- タイムライン活動への紐付け
  source text not null default 'compose',   -- 'compose'(CRMから作成)|'manual'|'gmail_sync'(将来)
  sent_at timestamptz,
  logged_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_email_messages_opp on public.email_messages(opportunity_id, sent_at desc);
create index if not exists idx_email_messages_contact on public.email_messages(contact_id, sent_at desc);
create index if not exists idx_email_messages_tenant on public.email_messages(tenant_id, sent_at desc);
create trigger trg_email_messages_updated before update on public.email_messages
  for each row execute function public.set_updated_at();

alter table public.email_messages enable row level security;

-- 参照: 管理系=全件 / それ以外=自分が記録 or 自分担当案件のメール(activities/yomi_logs と同型)
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and (logged_by = (select auth.uid())
        or exists (select 1 from opportunities o where o.id = opportunity_id and o.owner_user_id = (select auth.uid()))))
);
-- 記録(insert): 編集ロール かつ 記録者は本人
drop policy if exists email_messages_insert on public.email_messages;
create policy email_messages_insert on public.email_messages for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id) and logged_by = (select auth.uid()));
-- 更新/削除: 記録者本人 or 管理系の編集ロール
drop policy if exists email_messages_update on public.email_messages;
create policy email_messages_update on public.email_messages for update using (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
  and (logged_by = (select auth.uid()) or tenant_id in (select view_all_tenant_ids()))
) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists email_messages_delete on public.email_messages;
create policy email_messages_delete on public.email_messages for delete using (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
  and (logged_by = (select auth.uid()) or tenant_id in (select view_all_tenant_ids()))
);

-- ---- 初期テンプレート(カトルセ運用の定番3種)。既存があれば追加しない。 ----
insert into public.email_templates (tenant_id, name, category, subject_tmpl, body_tmpl)
select v.tenant_id, v.name, v.category, v.subject_tmpl, v.body_tmpl
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, '商談お礼', 'thanks',
   '本日はお時間をいただきありがとうございました（{company}）',
   E'{contact} 様\n\n本日はお忙しいところお時間をいただき、誠にありがとうございました。\n{company} 様の課題について理解を深めることができ、大変有意義な時間となりました。\n\n本日のお話を踏まえ、次回までに提案をまとめてまいります。\n引き続きどうぞよろしくお願いいたします。\n\n{sender}'),
  ('00000000-0000-0000-0000-000000000001'::uuid, '資料送付', 'material',
   '【資料送付】ご依頼の資料をお送りします（{company}）',
   E'{contact} 様\n\nお世話になっております。\n先日ご依頼いただいた資料をお送りいたします。\n\nご不明な点やご質問がございましたら、お気軽にお問い合わせください。\n\n{sender}'),
  ('00000000-0000-0000-0000-000000000001'::uuid, '日程調整', 'schedule',
   '次回のお打ち合わせ日程について（{company}）',
   E'{contact} 様\n\nお世話になっております。\n次回のお打ち合わせについて、下記の候補日時でご都合はいかがでしょうか。\n\n・（候補1）\n・（候補2）\n・（候補3）\n\nご都合のよい日時をお知らせいただけますと幸いです。\nよろしくお願いいたします。\n\n{sender}')
) as v(tenant_id, name, category, subject_tmpl, body_tmpl)
where not exists (
  select 1 from public.email_templates t
  where t.tenant_id = v.tenant_id and t.name = v.name
);
