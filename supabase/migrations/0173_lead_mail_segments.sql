-- =====================================================================
-- 0173: 一括メールのセグメント履歴・反応分析（F-203/F-206 拡張）
--   1) lead_mail_batches … 一括送信1回=1セグメント（任意タイトル・対象条件・件数）
--   2) email_messages.mail_batch_id … 送信メールをセグメントへ紐付け
--   3) lead_mail_batch_stats() … セグメント別の開封/クリック/返信率
--   4) lead_event_mail_stats() … 流入(raw_event)別のリード数×メール反応×架電/アポ状況
-- =====================================================================

-- ---- 1) セグメント（一括送信の履歴） ----
create table if not exists public.lead_mail_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,                    -- セグメント名（任意指定。未指定は自動命名）
  template_id uuid references public.email_templates(id) on delete set null,
  filters jsonb not null default '{}'::jsonb,   -- 送信時の絞り込み条件(再現用): {event, ranks, q, leadIds...}
  sent_count int not null default 0,
  failed_count int not null default 0,
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_lead_mail_batches_tenant on public.lead_mail_batches(tenant_id, created_at desc);
alter table public.lead_mail_batches enable row level security;
create policy lmb_select on public.lead_mail_batches for select using (tenant_id in (select current_tenant_ids()));
create policy lmb_ins on public.lead_mail_batches for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy lmb_upd on public.lead_mail_batches for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- 2) 送信メール→セグメント紐付け ----
alter table public.email_messages
  add column if not exists mail_batch_id uuid references public.lead_mail_batches(id) on delete set null;
create index if not exists idx_email_messages_batch on public.email_messages(mail_batch_id) where mail_batch_id is not null;

-- ---- 3) セグメント別の反応集計 ----
--   返信は「受信メールの In-Reply-To が当該送信の Message-Id に一致」で判定(0146)。
create or replace function public.lead_mail_batch_stats()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with b as (
    select * from lead_mail_batches where tenant_id in (select current_tenant_ids())
    order by created_at desc limit 100
  ),
  m as (
    select m.mail_batch_id, m.id, m.smtp_message_id,
      (m.open_count > 0) as opened, (m.click_count > 0) as clicked
    from email_messages m
    where m.mail_batch_id in (select id from b) and m.status = 'sent'
  ),
  r as (
    select distinct m.id
    from m join email_messages rin
      on rin.direction = 'in' and rin.in_reply_to = m.smtp_message_id
    where m.smtp_message_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'title', b.title, 'createdAt', b.created_at,
    'templateId', b.template_id, 'filters', b.filters, 'sentBy', b.sent_by,
    'sent', b.sent_count, 'failed', b.failed_count,
    'opened', coalesce(s.opened, 0), 'clicked', coalesce(s.clicked, 0), 'replied', coalesce(s.replied, 0)
  ) order by b.created_at desc), '[]'::jsonb)
  from b
  left join (
    select m.mail_batch_id,
      count(*) filter (where m.opened) as opened,
      count(*) filter (where m.clicked) as clicked,
      count(*) filter (where m.id in (select id from r)) as replied
    from m group by m.mail_batch_id
  ) s on s.mail_batch_id = b.id
$$;
revoke execute on function public.lead_mail_batch_stats() from public, anon;
grant execute on function public.lead_mail_batch_stats() to authenticated;

-- ---- 4) 流入(raw_event)別: リード数 × メール反応 × アクション状況 ----
create or replace function public.lead_event_mail_stats()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with l as (
    select id, coalesce(nullif(raw_event, ''), '(流入なし)') as ev,
      (email is not null and email <> '') as has_email,
      (disposition is not null and disposition not in ('untouched')) as touched,
      (disposition = 'appointment') as appt,
      (account_id is not null or status = 'converted') as converted
    from leads where tenant_id in (select current_tenant_ids())
  ),
  m as (
    select m.lead_id, m.id, m.smtp_message_id,
      (m.open_count > 0) as opened, (m.click_count > 0) as clicked
    from email_messages m
    where m.tenant_id in (select current_tenant_ids()) and m.lead_id is not null and m.status = 'sent'
  ),
  r as (
    select distinct m.id
    from m join email_messages rin
      on rin.direction = 'in' and rin.in_reply_to = m.smtp_message_id
    where m.smtp_message_id is not null
  ),
  ml as ( -- リード単位に反応をロールアップ
    select m.lead_id,
      bool_or(true) as mailed, bool_or(m.opened) as opened, bool_or(m.clicked) as clicked,
      bool_or(m.id in (select id from r)) as replied
    from m group by m.lead_id
  )
  select coalesce(jsonb_agg(row order by (row->>'mailed')::int desc, (row->>'leads')::int desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'event', l.ev,
      'leads', count(*),
      'withEmail', count(*) filter (where l.has_email),
      'mailed', count(*) filter (where ml.mailed),
      'opened', count(*) filter (where ml.opened),
      'clicked', count(*) filter (where ml.clicked),
      'replied', count(*) filter (where ml.replied),
      'touched', count(*) filter (where l.touched),
      'appointments', count(*) filter (where l.appt),
      'converted', count(*) filter (where l.converted)
    ) as row
    from l left join ml on ml.lead_id = l.id
    group by l.ev
  ) rows
$$;
revoke execute on function public.lead_event_mail_stats() from public, anon;
grant execute on function public.lead_event_mail_stats() to authenticated;
