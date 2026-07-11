-- =====================================================================
-- 既存タスクを既定プロジェクト「営業タスク」へ移行（データ移行・冪等）
--
--   project_id が未設定のタスクを持つ各テナントに、既定プロジェクトと
--   未対応 / 対応中 / 完了 のセクションを1組作成し、未所属タスクを割り当てる。
--     - done → 完了、それ以外 → 未対応
--     - opportunity_id / account_id の紐付けは変更しない（非破壊）
--   既にプロジェクトを持つタスク・空テナントには影響しない。再実行しても安全。
-- =====================================================================
do $$
declare
  r record;
  proj uuid;
  sec_todo uuid;
  sec_done uuid;
begin
  for r in select distinct tenant_id from public.tasks where project_id is null loop
    select id into proj from public.task_projects
      where tenant_id = r.tenant_id and name = '営業タスク' limit 1;

    if proj is null then
      insert into public.task_projects (tenant_id, name, description, color, default_view, status)
        values (r.tenant_id, '営業タスク', '既存の次アクション／タスクを集約した既定プロジェクト', 'teal', 'board', 'active')
        returning id into proj;
      insert into public.task_sections (tenant_id, project_id, name, sort_order)
        values (r.tenant_id, proj, '未対応', 0) returning id into sec_todo;
      insert into public.task_sections (tenant_id, project_id, name, sort_order)
        values (r.tenant_id, proj, '対応中', 1);
      insert into public.task_sections (tenant_id, project_id, name, sort_order)
        values (r.tenant_id, proj, '完了', 2) returning id into sec_done;
    else
      select id into sec_todo from public.task_sections where project_id = proj and name = '未対応' limit 1;
      select id into sec_done from public.task_sections where project_id = proj and name = '完了' limit 1;
    end if;

    update public.tasks t
      set project_id = proj,
          section_id = case when t.status = 'done' then sec_done else sec_todo end
      where t.tenant_id = r.tenant_id and t.project_id is null;
  end loop;
end $$;
