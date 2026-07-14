-- 監査イベントログ（適度な粒度）: ログインと「重い処理」（一括取込/書き出し/マッチング/名寄せ等）のみ記録。
-- レスポンス影響・データ肥大を避けるため、通常の閲覧/クリックは記録しない。
-- 書き込みはサーバー(service role)からのみ（直接INSERTポリシー無し＝改ざん防止）。閲覧は owner / admin のみ。
-- ※既存の audit_logs（テーブル変更のbefore/after監査）とは別用途のため新設。
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid,
  actor_email text,
  action text not null,        -- 例: login / leads.import / leads.export_csv / cards.import / accounts.merge
  target text,                 -- 任意: 対象の短い説明（件数概要・対象IDなど）
  meta jsonb not null default '{}'::jsonb,  -- 小さな構造化詳細（件数・条件など。ペイロード全文は入れない）
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auditev_tenant_time on public.audit_events(tenant_id, created_at desc);
create index if not exists idx_auditev_action_time on public.audit_events(tenant_id, action, created_at desc);
create index if not exists idx_auditev_user_time on public.audit_events(tenant_id, user_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = audit_events.tenant_id
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );
-- INSERT/UPDATE/DELETE ポリシーは付与しない（service role のみ書込可・不変ログ）。
