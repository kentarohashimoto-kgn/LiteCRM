-- =====================================================================
-- デモデータ拡充: 原価/粗利の健全化・稼働報告・展示会ハブ・AI-PMOレポート
--   reset_demo_tenant() の最後に seed_demo_extras() を呼ぶ形で追加。
--   デモテナント配下のみ・block_demo_writes は app.demo_seed GUC で許可。
-- =====================================================================

create or replace function seed_demo_extras()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_reps uuid[] := array['d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000006']::uuid[];
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
  v_month date := date_trunc('month', current_date)::date;
  v_wk0 date := (date_trunc('week', current_date))::date;          -- 今週(月)
  v_wk1 date := (date_trunc('week', current_date) - interval '7 days')::date; -- 先週(月)
  v_exhibits text[] := array['AI・人工知能EXPO 2026春','DX総合EXPO 2026','Japan IT Week 2026','中小企業DXフェア 2026'];
  v_camps uuid[];
begin
  perform set_config('app.demo_seed', '1', true);

  -- ================= (A) 原価管理: 粗利を健全化(赤字にならないよう再生成) =================
  delete from project_weekly_reports where tenant_id = v_tenant;
  delete from project_profit_reviews where tenant_id = v_tenant;
  delete from project_cost_months where tenant_id = v_tenant;
  delete from project_revenue_months where tenant_id = v_tenant;

  -- 売上: 受注額を3ヶ月で按分
  insert into project_revenue_months (tenant_id, plan_id, month, amount)
  select v_tenant, pp.id, (pp.start_month + (mm || ' months')::interval)::date, round(oa.amount / 3.0)
  from project_plans pp
  join opportunities oa on oa.id = pp.opportunity_id
  cross join generate_series(0, 2) mm
  where pp.tenant_id = v_tenant;

  -- 原価: 売上×原価率(通常0.52〜0.58=粗利42〜48% / 6件に1件は0.82=粗利18%の要注意PJ)を人数で按分
  insert into project_cost_months (tenant_id, plan_id, assignment_id, month, man_month, ratio, cost_amount)
  select v_tenant, pa.plan_id, pa.id, (pp.start_month + (mm || ' months')::interval)::date, 1.0, 1.0,
    round(oa.amount / 3.0
      * (case when ((oa.amount/500000)::int % 6) = 0 then 0.82 else 0.52 + 0.02 * ((oa.amount/500000)::int % 4) end)
      / greatest(cnt.n, 1))
  from project_assignments pa
  join project_plans pp on pp.id = pa.plan_id
  join opportunities oa on oa.id = pp.opportunity_id
  join (select plan_id, count(*) n from project_assignments where tenant_id = v_tenant group by plan_id) cnt on cnt.plan_id = pa.plan_id
  cross join generate_series(0, 2) mm
  where pa.tenant_id = v_tenant;

  -- 一部PJに終了時 粗利レビュー(粗利率・リスク)を付与
  insert into project_profit_reviews (tenant_id, customer_id, project_type, project_name, contract_amount, planned_cost, actual_cost, planned_gross_profit, forecast_gross_profit, quality_risk, cost_risk, continuation_status)
  select v_tenant, pp.account_id, 'development', (select name from accounts a where a.id = pp.account_id) || ' 開発PJ',
    oa.amount, round(oa.amount*0.55), round(oa.amount*0.57), round(oa.amount*0.45), round(oa.amount*0.43),
    (array['low','low','mid','high'])[1+((oa.amount/500000)::int % 4)], (array['low','mid','mid','high'])[1+((oa.amount/500000)::int % 4)], 'continuing'
  from project_plans pp join opportunities oa on oa.id = pp.opportunity_id
  where pp.tenant_id = v_tenant and ((oa.amount/500000)::int % 2) = 0;

  -- ================= (B) 稼働報告: プレゼンター枠(slot)にアサイン+稼働記録 =================
  -- slot に明確なアサインを持たせる(先頭8件の member を slot に)
  update project_assignments set member_user_id = v_slot
  where tenant_id = v_tenant and id in (select id from project_assignments where tenant_id = v_tenant order by created_at limit 8);

  -- slotアサインに今週・先週の稼働(平日8h)
  insert into work_entries (tenant_id, plan_id, assignment_id, work_date, week_start, hours, task_text, outcome_text, next_action_text, created_by)
  select v_tenant, pa.plan_id, pa.id, (w.wk + (d || ' days')::interval)::date, w.wk,
    8, (array['設計レビュー','実装','テスト','顧客MTG','ドキュメント整備'])[1+(d%5)], '順調に進捗', '次工程の準備', v_slot
  from project_assignments pa
  cross join (values (v_wk0), (v_wk1)) w(wk)
  cross join generate_series(0, 4) d
  where pa.tenant_id = v_tenant and pa.member_user_id = v_slot;

  insert into work_weeks (tenant_id, plan_id, assignment_id, week_start, status, submitted_at, created_by)
  select v_tenant, pa.plan_id, pa.id, w.wk, case when w.wk = v_wk1 then 'submitted' else 'draft' end,
    case when w.wk = v_wk1 then now() - interval '3 days' else null end, v_slot
  from project_assignments pa
  cross join (values (v_wk0), (v_wk1)) w(wk)
  where pa.tenant_id = v_tenant and pa.member_user_id = v_slot;

  -- ================= (C) 展示会ハブ =================
  delete from exhibition_events where tenant_id = v_tenant;
  delete from campaigns where tenant_id = v_tenant and channel = 'exhibition';

  insert into campaigns (tenant_id, name, channel, event_status, event_date, end_date, days, organizer, venue, expected_leads, actual_leads, action_count, appointments, reported_deals, reported_revenue, cost, notes)
  select v_tenant, v_exhibits[1+g], 'exhibition', 'done',
    (v_month - ((2 + g) || ' months')::interval)::date, (v_month - ((2 + g) || ' months')::interval + interval '2 days')::date, 3,
    (array['リード エグジビション','ナノオプト・メディア','JBP','中小機構'])[1+g], (array['東京ビッグサイト','幕張メッセ','東京ビッグサイト','インテックス大阪'])[1+g],
    (array[300,220,260,140])[1+g], (array[286,203,241,128])[1+g], (array[120,95,110,60])[1+g], (array[38,26,31,17])[1+g], (array[9,6,7,3])[1+g], (array[42000000,28000000,33000000,12000000])[1+g], (array[3500000,2200000,2800000,1200000])[1+g], 'デモ用 展示会'
  from generate_series(0, 3) g;

  select array_agg(id order by event_date desc) into v_camps from campaigns where tenant_id = v_tenant and channel = 'exhibition';

  insert into exhibition_events (tenant_id, campaign_id, raw_event, label, ym, organizer, cost)
  select v_tenant, c.id, c.name, c.name, to_char(c.event_date, 'YYYY-MM'), c.organizer, c.cost
  from campaigns c where c.tenant_id = v_tenant and c.channel = 'exhibition';

  -- 展示会にリードを紐付け(raw_event) — 約80件
  update leads set raw_event = v_exhibits[1 + (abs(hashtextextended(id::text, 0)) % array_length(v_exhibits,1))]
  where tenant_id = v_tenant and (abs(hashtextextended(id::text, 7)) % 5) < 3;

  -- 展示会に商談を紐付け(source_detail) — 受注/進行中の一部
  update opportunities set source_detail = v_exhibits[1 + (abs(hashtextextended(id::text, 0)) % array_length(v_exhibits,1))]
  where tenant_id = v_tenant and status in ('won','open') and (abs(hashtextextended(id::text, 3)) % 4) < 2;

  -- ================= (D) AI-PMO レポート =================
  delete from pmo_reports where tenant_id = v_tenant;
  insert into pmo_reports (tenant_id, mode, title, report_md, alerts, digest, model, created_by, created_at)
  values
  (v_tenant, 'executive', to_char(current_date,'YYYY-MM') || ' 経営サマリー',
E'## 経営サマリー（デモ）\n\n- 直近12ヶ月の受注は **約6.7億円**、年間目標8.4億に対し達成率 **約79%**。\n- パイプライン加重は **約7,158万円**。今月クローズ予定11件。\n- **停滞案件が28件**（100件中）と多く、次回アクション未設定の放置が課題。\n\n### 提言\n1. 停滞案件のうち金額上位10件に即日フォロー。\n2. 展示会経由リードの商談化率が高く、次回出展の投資対効果は良好。\n3. デリバリー案件は粗利45%前後で健全。要注意PJ（粗利18%）の是正が必要。',
  '[{"level":"warn","text":"停滞案件28件 — 放置解消が急務"},{"level":"info","text":"展示会ROIは良好、追加出展を検討"}]'::jsonb,
  '{"won_ttm":666000000,"target":840000000,"achievement":0.79}'::jsonb, 'demo', v_slot, now() - interval '2 hours'),
  (v_tenant, 'sales', to_char(current_date,'YYYY-MM') || ' 営業レビュー',
E'## 営業レビュー（デモ）\n\n- 進行中案件 **133件 / 1.4億円**。ヨミA(80%)以上は30件。\n- ファネル上、C(30%)が58件と厚く、B/Aへの引き上げが鍵。\n- 失注理由は「価格」「競合」が中心。提案初速の改善余地あり。',
  '[{"level":"info","text":"C→Bの引き上げ施策を強化"}]'::jsonb, '{}'::jsonb, 'demo', v_slot, now() - interval '1 day'),
  (v_tenant, 'project', to_char(current_date,'YYYY-MM') || ' デリバリー状況',
E'## デリバリー状況（デモ）\n\n- 進行中デリバリーPJ **25件**、平均粗利率 **約45%**。\n- 稼働は各PMが週次で報告。今週の稼働入力率は良好。\n- 粗利18%の要注意PJが数件。要員配置と追加請求の交渉を推奨。',
  '[{"level":"warn","text":"低粗利PJの是正（要員/追加請求）"}]'::jsonb, '{}'::jsonb, 'demo', v_slot, now() - interval '5 hours');
end $fn$;

-- reset_demo_tenant の最後に extras 生成を追加（既存の営業/タスク/案件生成の後）。
create or replace function reset_demo_tenant_with_extras()
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform reset_demo_tenant();
  perform seed_demo_extras();
end $fn$;

revoke all on function reset_demo_tenant_with_extras() from public, authenticated;

-- reset_demo_tenant_guarded は extras込みで呼ぶよう差し替え。
create or replace function reset_demo_tenant_guarded()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from memberships where user_id = v_uid and tenant_id = '00000000-0000-0000-0000-0000000000de' and status = 'active') then
    raise exception 'not a demo member';
  end if;
  perform reset_demo_tenant();
  perform seed_demo_extras();
end $fn$;
grant execute on function reset_demo_tenant_guarded() to authenticated;

-- enter/exit: 稼働アサイン(member_user_id)もプレゼンターに付替え。
create or replace function enter_presentation_mode()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_tenant uuid := '00000000-0000-0000-0000-0000000000de'; v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from memberships m join tenants t on t.id = m.tenant_id where m.user_id = v_uid and m.status = 'active' and t.is_demo = false) then raise exception 'presentation mode is only for internal members'; end if;
  perform set_config('app.demo_seed', '1', true);
  insert into memberships (tenant_id, user_id, role, status) values (v_tenant, v_uid, 'owner', 'active') on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner';
  insert into presentation_sessions (user_id, expires_at) values (v_uid, now() + interval '12 hours') on conflict (user_id) do update set started_at = now(), expires_at = now() + interval '12 hours';
  if v_uid <> v_slot then
    update opportunities set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update activities set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update meetings set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update leads set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update accounts set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update tasks set assigned_to = v_uid where tenant_id = v_tenant and assigned_to = v_slot;
    update tasks set created_by = v_uid where tenant_id = v_tenant and created_by = v_slot;
    update task_projects set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update stage_histories set changed_by = v_uid where tenant_id = v_tenant and changed_by = v_slot;
    update billing_schedules set created_by = v_uid where tenant_id = v_tenant and created_by = v_slot;
    update project_assignments set member_user_id = v_uid where tenant_id = v_tenant and member_user_id = v_slot;
    update work_entries set created_by = v_uid where tenant_id = v_tenant and created_by = v_slot;
    update work_weeks set created_by = v_uid where tenant_id = v_tenant and created_by = v_slot;
  end if;
end $fn$;

create or replace function exit_presentation_mode()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_tenant uuid := '00000000-0000-0000-0000-0000000000de'; v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform set_config('app.demo_seed', '1', true);
  delete from presentation_sessions where user_id = v_uid;
  if v_uid = v_slot then return; end if;
  update opportunities set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update activities set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update meetings set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update leads set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update accounts set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update tasks set assigned_to = v_slot where tenant_id = v_tenant and assigned_to = v_uid;
  update tasks set created_by = v_slot where tenant_id = v_tenant and created_by = v_uid;
  update task_projects set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update stage_histories set changed_by = v_slot where tenant_id = v_tenant and changed_by = v_uid;
  update billing_schedules set created_by = v_slot where tenant_id = v_tenant and created_by = v_uid;
  update project_assignments set member_user_id = v_slot where tenant_id = v_tenant and member_user_id = v_uid;
  update work_entries set created_by = v_slot where tenant_id = v_tenant and created_by = v_uid;
  update work_weeks set created_by = v_slot where tenant_id = v_tenant and created_by = v_uid;
end $fn$;

-- 拡張データを投入
select seed_demo_extras();
