-- =====================================================================
-- 原価管理が空になる不具合の修正。
-- listManagedProjects() は opportunities.is_project_managed = true の案件のみ対象。
-- デモの受注開発案件(プロジェクト計画あり)にこのフラグが立っていなかったため、
-- 原価管理ページが空だった。seed_demo_extras() でフラグを立てるよう恒久化し、
-- 既存デモデータにも即時反映する。
-- =====================================================================

create or replace function seed_demo_extras()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
  v_month date := date_trunc('month', current_date)::date;
  v_wk0 date := (date_trunc('week', current_date))::date;
  v_wk1 date := (date_trunc('week', current_date) - interval '7 days')::date;
  v_exhibits text[] := array['AI・人工知能EXPO 2026春','DX総合EXPO 2026','Japan IT Week 2026','中小企業DXフェア 2026'];
begin
  perform set_config('app.demo_seed', '1', true);

  -- 原価管理の対象フラグ(受注開発案件=プロジェクト計画あり)を立てる。
  update opportunities set is_project_managed = true
  where tenant_id = v_tenant and exists (select 1 from project_plans p where p.opportunity_id = opportunities.id);

  -- ===== 原価/粗利の健全化 =====
  delete from project_weekly_reports where tenant_id = v_tenant;
  delete from project_profit_reviews where tenant_id = v_tenant;
  delete from project_cost_months where tenant_id = v_tenant;
  delete from project_revenue_months where tenant_id = v_tenant;
  insert into project_revenue_months (tenant_id, plan_id, month, amount)
  select v_tenant, pp.id, (pp.start_month + (mm || ' months')::interval)::date, round(oa.amount / 3.0)
  from project_plans pp join opportunities oa on oa.id = pp.opportunity_id cross join generate_series(0, 2) mm where pp.tenant_id = v_tenant;
  insert into project_cost_months (tenant_id, plan_id, assignment_id, month, man_month, ratio, cost_amount)
  select v_tenant, pa.plan_id, pa.id, (pp.start_month + (mm || ' months')::interval)::date, 1.0, 1.0,
    round(oa.amount / 3.0 * (case when ((oa.amount/500000)::int % 6) = 0 then 0.82 else 0.52 + 0.02 * ((oa.amount/500000)::int % 4) end) / greatest(cnt.n, 1))
  from project_assignments pa join project_plans pp on pp.id = pa.plan_id join opportunities oa on oa.id = pp.opportunity_id
  join (select plan_id, count(*) n from project_assignments where tenant_id = v_tenant group by plan_id) cnt on cnt.plan_id = pa.plan_id
  cross join generate_series(0, 2) mm where pa.tenant_id = v_tenant;
  insert into project_profit_reviews (tenant_id, customer_id, project_type, project_name, contract_amount, planned_cost, actual_cost, planned_gross_profit, forecast_gross_profit, quality_risk, cost_risk, continuation_status)
  select v_tenant, pp.account_id, 'development', (select name from accounts a where a.id = pp.account_id) || ' 開発PJ', oa.amount, round(oa.amount*0.55), round(oa.amount*0.57), round(oa.amount*0.45), round(oa.amount*0.43), (array['low','low','mid','high'])[1+((oa.amount/500000)::int % 4)], (array['low','mid','mid','high'])[1+((oa.amount/500000)::int % 4)], 'continuing'
  from project_plans pp join opportunities oa on oa.id = pp.opportunity_id where pp.tenant_id = v_tenant and ((oa.amount/500000)::int % 2) = 0;

  -- ===== 稼働報告 =====
  update project_assignments set member_user_id = v_slot where tenant_id = v_tenant and id in (select id from project_assignments where tenant_id = v_tenant order by created_at limit 8);
  insert into work_entries (tenant_id, plan_id, assignment_id, work_date, week_start, hours, task_text, outcome_text, next_action_text, created_by)
  select v_tenant, pa.plan_id, pa.id, (w.wk + (d || ' days')::interval)::date, w.wk, 8, (array['設計レビュー','実装','テスト','顧客MTG','ドキュメント整備'])[1+(d%5)], '順調に進捗', '次工程の準備', v_slot
  from project_assignments pa cross join (values (v_wk0), (v_wk1)) w(wk) cross join generate_series(0, 4) d where pa.tenant_id = v_tenant and pa.member_user_id = v_slot;
  insert into work_weeks (tenant_id, plan_id, assignment_id, week_start, status, submitted_at, created_by)
  select v_tenant, pa.plan_id, pa.id, w.wk, case when w.wk = v_wk1 then 'submitted' else 'draft' end, case when w.wk = v_wk1 then now() - interval '3 days' else null end, v_slot
  from project_assignments pa cross join (values (v_wk0), (v_wk1)) w(wk) where pa.tenant_id = v_tenant and pa.member_user_id = v_slot;

  -- ===== 展示会ハブ =====
  delete from exhibition_events where tenant_id = v_tenant;
  delete from campaigns where tenant_id = v_tenant and channel = 'exhibition';
  insert into campaigns (tenant_id, name, channel, event_status, event_date, end_date, days, organizer, venue, expected_leads, actual_leads, action_count, appointments, reported_deals, reported_revenue, cost, notes)
  select v_tenant, v_exhibits[1+g], 'exhibition', 'done', (v_month - ((2 + g) || ' months')::interval)::date, (v_month - ((2 + g) || ' months')::interval + interval '2 days')::date, 3, (array['リード エグジビション','ナノオプト・メディア','JBP','中小機構'])[1+g], (array['東京ビッグサイト','幕張メッセ','東京ビッグサイト','インテックス大阪'])[1+g], (array[300,220,260,140])[1+g], (array[286,203,241,128])[1+g], (array[120,95,110,60])[1+g], (array[38,26,31,17])[1+g], (array[9,6,7,3])[1+g], (array[42000000,28000000,33000000,12000000])[1+g], (array[3500000,2200000,2800000,1200000])[1+g], 'デモ用 展示会' from generate_series(0, 3) g;
  insert into exhibition_events (tenant_id, campaign_id, raw_event, label, ym, organizer, cost)
  select v_tenant, c.id, c.name, c.name, to_char(c.event_date, 'YYYY-MM'), c.organizer, c.cost from campaigns c where c.tenant_id = v_tenant and c.channel = 'exhibition';
  update leads set raw_event = v_exhibits[1 + (abs(hashtextextended(id::text, 0)) % array_length(v_exhibits,1))] where tenant_id = v_tenant and (abs(hashtextextended(id::text, 7)) % 5) < 3;
  update opportunities set source_detail = v_exhibits[1 + (abs(hashtextextended(id::text, 0)) % array_length(v_exhibits,1))] where tenant_id = v_tenant and status in ('won','open') and (abs(hashtextextended(id::text, 3)) % 4) < 2;

  -- ===== AI-PMO =====
  delete from pmo_reports where tenant_id = v_tenant;
  insert into pmo_reports (tenant_id, mode, title, report_md, alerts, digest, model, created_by, created_at) values
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

-- 既存デモデータへ即時反映(アサイン付替えは触らず、フラグのみ)。
select set_config('app.demo_seed', '1', true);
update opportunities set is_project_managed = true
where tenant_id = '00000000-0000-0000-0000-0000000000de'
  and exists (select 1 from project_plans p where p.opportunity_id = opportunities.id);
