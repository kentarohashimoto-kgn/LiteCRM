-- B-1 変更履歴: audit_logs(既存・未使用)をDBトリガーで記録し、詳細画面から参照できるようにする。
-- 方針:
--   - opportunities / accounts / leads の行トリガーで「誰が・いつ・どの項目を・どう変えたか」を記録
--   - UPDATE は変更のあった項目だけの before/after 差分を保存(自動更新されるノイズ列は除外)
--   - INSERT は opportunities / accounts のみ記録(リードは一括取込で大量発生するため対象外)
--   - 参照はテナント内メンバー全員に開放(従来は owner/admin のみ)

-- ============================================================
-- (1) 監査トリガー関数
-- ============================================================
create or replace function public.fn_audit_row()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- 自動更新・ノイズ列(差分から除外)。空変更になった場合は記録しない。
  noise text[] := array[
    'updated_at','created_at','last_activity_at','last_activity_date',
    'lead_score','lead_score_detail','first_contact_due_date','priority_score','priority_base'
  ];
  b jsonb; a jsonb; diff_b jsonb; diff_a jsonb;
begin
  if tg_op = 'INSERT' then
    insert into audit_logs (tenant_id, actor_user_id, table_name, record_id, action, before_data, after_data)
    values (new.tenant_id, auth.uid(), tg_table_name, new.id, 'INSERT', null,
            jsonb_strip_nulls(to_jsonb(new) - noise));
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_logs (tenant_id, actor_user_id, table_name, record_id, action, before_data, after_data)
    values (old.tenant_id, auth.uid(), tg_table_name, old.id, 'DELETE',
            jsonb_strip_nulls(to_jsonb(old) - noise), null);
    return old;
  else
    b := to_jsonb(old) - noise;
    a := to_jsonb(new) - noise;
    select coalesce(jsonb_object_agg(k.key, b -> k.key), '{}'::jsonb),
           coalesce(jsonb_object_agg(k.key, a -> k.key), '{}'::jsonb)
      into diff_b, diff_a
      from (select jsonb_object_keys(a) as key union select jsonb_object_keys(b) as key) k
      where (a -> k.key) is distinct from (b -> k.key);
    if diff_a = '{}'::jsonb and diff_b = '{}'::jsonb then
      return new; -- ノイズ列のみの更新は記録しない
    end if;
    insert into audit_logs (tenant_id, actor_user_id, table_name, record_id, action, before_data, after_data)
    values (new.tenant_id, auth.uid(), tg_table_name, new.id, 'UPDATE', diff_b, diff_a);
    return new;
  end if;
end $$;

-- ============================================================
-- (2) トリガー設置
-- ============================================================
drop trigger if exists trg_audit_opportunities on public.opportunities;
create trigger trg_audit_opportunities
  after insert or update or delete on public.opportunities
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_accounts on public.accounts;
create trigger trg_audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.fn_audit_row();

-- リードは一括取込があるため INSERT は記録しない(更新・削除のみ)
drop trigger if exists trg_audit_leads on public.leads;
create trigger trg_audit_leads
  after update or delete on public.leads
  for each row execute function public.fn_audit_row();

-- ============================================================
-- (3) 参照ポリシー: テナント内メンバー全員が閲覧可能に
-- ============================================================
alter policy audit_select on public.audit_logs
  using (tenant_id in (select current_tenant_ids()));

-- 詳細画面での「このレコードの履歴」取得用
create index if not exists idx_audit_record
  on public.audit_logs(tenant_id, table_name, record_id, created_at desc);
