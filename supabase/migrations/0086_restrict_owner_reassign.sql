-- 案件・商談の担当者(owner_user_id)の変更は 代表(owner)/管理者(admin)/Sales Ops(sales_manager) のみ許可。
-- どの経路(インライン/一括/基本情報編集/商談編集)からの更新でも一元的に強制するトリガー。
-- 新規作成(INSERT)時のowner設定は対象外(アポ登録などで担当を指定する通常フロー)。
create or replace function public.enforce_owner_reassign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    if coalesce(current_role_in(new.tenant_id), '') not in ('owner','admin','sales_manager') then
      raise exception '担当者の変更は代表・管理者・Sales Opsのみ実行できます'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_opps_owner_reassign on opportunities;
create trigger trg_opps_owner_reassign
  before update of owner_user_id on opportunities
  for each row execute function public.enforce_owner_reassign();

drop trigger if exists trg_meetings_owner_reassign on meetings;
create trigger trg_meetings_owner_reassign
  before update of owner_user_id on meetings
  for each row execute function public.enforce_owner_reassign();
