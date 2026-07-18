import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import {
  matchesYomiCondition,
  renderTemplate,
  yomiLabel,
  type AutomationAction,
  type TemplateVars,
} from "@/lib/automation";

export const dynamic = "force-dynamic";

/**
 * WO-18 ワークフロー自動化(F-102) — バッチ発火(ユーザー決定 2026-07-18)。
 *
 * 有効な automation_rules を、既存の変更ログ(まずは yomi_change_logs 0126)を
 * 走査して評価し、Slack / アプリ内通知 / タスク起票を実行する。
 * 検知源は新設せず既存ログを使う。冪等性は automation_runs(rule_id, trigger_ref) の
 * 一意制約で担保(cron 再実行・短間隔化に強い)。
 *
 * 認可: Authorization: Bearer <CRON_SECRET>（daily-digest と同一・fail-closed）。
 * 停止: batch_job_settings(job_kind='automation') が enabled=false なら即終了。
 * 必要な環境変数: CRON_SECRET(認可), SLACK_WEBHOOK_URL(slack_notify の送信先・任意)。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const startedAt = new Date().toISOString();

  // 走査の上限(暴走・大量発火の保険)。初回や長期停止後の取りこぼしはログで気付ける。
  const MAX_LOGS = 500;

  // 停止スイッチ: 自動化ジョブが有効なテナントのみ対象
  const { data: jobRows } = await admin
    .from("batch_job_settings")
    .select("tenant_id, enabled")
    .eq("job_kind", "automation");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) {
    return NextResponse.json({ ok: true, skipped: "automation job disabled (batch_job_settings)", fired: 0 });
  }

  // 有効な yomi_changed ルール(WO-18で実装済みのトリガー)
  const { data: rules, error: rulesErr } = await admin
    .from("automation_rules")
    .select("id, tenant_id, name, trigger_type, condition_json, action_json, enabled, last_evaluated_at")
    .eq("trigger_type", "yomi_changed")
    .eq("enabled", true);
  if (rulesErr) {
    return NextResponse.json({ ok: false, error: `ルール取得失敗: ${rulesErr.message}` }, { status: 500 });
  }
  const activeRules = (rules ?? []).filter((r) => enabledTenants.has(r.tenant_id as string));
  if (activeRules.length === 0) {
    return NextResponse.json({ ok: true, fired: 0, note: "有効な yomi_changed ルールなし" });
  }

  let firedTotal = 0;
  let errorsTotal = 0;
  const nowIso = new Date().toISOString();

  for (const rule of activeRules) {
    const tenantId = rule.tenant_id as string;
    // 増分走査: このルールが最後に評価した時刻以降の新規ログのみ(初回は全件だが MAX_LOGS で頭打ち)
    const since = (rule.last_evaluated_at as string | null) ?? "1970-01-01T00:00:00Z";
    const { data: logs, error: logErr } = await admin
      .from("yomi_change_logs")
      .select("id, opportunity_id, from_yomi, to_yomi, changed_at")
      .eq("tenant_id", tenantId)
      .gt("changed_at", since)
      .order("changed_at", { ascending: true })
      .limit(MAX_LOGS);
    if (logErr) {
      errorsTotal += 1;
      continue;
    }
    const matched = (logs ?? []).filter((lg) =>
      matchesYomiCondition({ from_yomi: lg.from_yomi as string | null, to_yomi: lg.to_yomi as string | null }, rule.condition_json as never),
    );

    // マッチ対象の案件・担当・会社名をまとめて取得(テンプレート差し込み用)
    const oppIds = Array.from(new Set(matched.map((m) => m.opportunity_id as string)));
    const oppMap = new Map<string, { name: string; owner: string | null; account_id: string | null }>();
    const ownerIds = new Set<string>();
    const accIds = new Set<string>();
    if (oppIds.length) {
      const { data: opps } = await admin
        .from("opportunities")
        .select("id, name, owner_user_id, account_id")
        .in("id", oppIds.slice(0, MAX_LOGS));
      for (const o of opps ?? []) {
        oppMap.set(o.id as string, { name: o.name as string, owner: (o.owner_user_id as string) ?? null, account_id: (o.account_id as string) ?? null });
        if (o.owner_user_id) ownerIds.add(o.owner_user_id as string);
        if (o.account_id) accIds.add(o.account_id as string);
      }
    }
    const nameMap = new Map<string, string>();
    if (ownerIds.size) {
      const { data: profs } = await admin.from("profiles").select("id, display_name, email").in("id", Array.from(ownerIds));
      for (const p of profs ?? []) nameMap.set(p.id as string, (p.display_name as string) ?? (p.email as string) ?? "—");
    }
    const accMap = new Map<string, string>();
    if (accIds.size) {
      const { data: accs } = await admin.from("accounts").select("id, name").in("id", Array.from(accIds));
      for (const a of accs ?? []) accMap.set(a.id as string, a.name as string);
    }

    for (const lg of matched) {
      const triggerRef = lg.id as string;
      // 冪等性(claim-first): 先に automation_runs 行を確保する。既発火なら unique 制約で
      // 弾かれ、アクションは一切実行しない=Slack/通知の二重送信を構造的に防ぐ。
      const claim = await admin
        .from("automation_runs")
        .insert({
          tenant_id: tenantId,
          rule_id: rule.id,
          trigger_ref: triggerRef,
          target_type: "opportunity",
          target_id: lg.opportunity_id,
          status: "running",
          actions_result: [],
        })
        .select("id")
        .single();
      if (claim.error || !claim.data) {
        // 23505 = unique_violation(既に発火済み)。それ以外はエラー計上。
        if (!String(claim.error?.code).includes("23505")) errorsTotal += 1;
        continue;
      }
      const runId = claim.data.id as string;

      const opp = oppMap.get(lg.opportunity_id as string);
      const ownerName = opp?.owner ? nameMap.get(opp.owner) ?? "—" : "—";
      const accountName = opp?.account_id ? accMap.get(opp.account_id) ?? opp?.name ?? "—" : opp?.name ?? "—";
      const vars: TemplateVars = {
        account: accountName,
        opportunity: opp?.name ?? "—",
        owner: ownerName,
        from_yomi: yomiLabel(lg.from_yomi as string | null),
        to_yomi: yomiLabel(lg.to_yomi as string | null),
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/app/opportunities/${lg.opportunity_id}`,
      };

      const actions = (rule.action_json as AutomationAction[]) ?? [];
      const results: { type: string; ok: boolean; note?: string }[] = [];
      for (const act of actions) {
        try {
          if (act.type === "slack_notify") {
            if (webhook) {
              const res = await fetch(webhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: renderTemplate(act.template, vars) }),
              });
              results.push({ type: act.type, ok: res.ok });
            } else {
              results.push({ type: act.type, ok: false, note: "SLACK_WEBHOOK_URL未設定" });
            }
          } else if (act.type === "app_notify") {
            const targetUser = act.to === "owner" ? opp?.owner : null;
            if (targetUser) {
              const { error } = await admin.from("notifications").insert({
                tenant_id: tenantId,
                user_id: targetUser,
                kind: "automation",
                title: renderTemplate(act.title, vars),
                body: act.body ? renderTemplate(act.body, vars) : null,
                href: act.href ? renderTemplate(act.href, vars) : `/app/opportunities/${lg.opportunity_id}`,
              });
              results.push({ type: act.type, ok: !error, note: error?.message });
            } else {
              results.push({ type: act.type, ok: false, note: "宛先(担当)なし" });
            }
          } else if (act.type === "create_task") {
            // tasks.assigned_to / created_by / due_date は NOT NULL。担当(owner)が無い案件は起票不可。
            const owner = opp?.owner ?? null;
            if (!owner) {
              results.push({ type: act.type, ok: false, note: "担当(owner)なしのため起票不可" });
            } else {
              const dueDays = act.due_in_days ?? 3;
              const due = new Date(Date.now() + dueDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
              const { error } = await admin.from("tasks").insert({
                tenant_id: tenantId,
                opportunity_id: lg.opportunity_id,
                account_id: opp?.account_id ?? null,
                assigned_to: owner,
                created_by: owner, // 無人実行のため担当者を発生源として記録
                title: renderTemplate(act.title, vars),
                due_date: due,
                status: "todo",
                origin: "automation",
              });
              results.push({ type: act.type, ok: !error, note: error?.message });
            }
          } else {
            results.push({ type: (act as { type: string }).type, ok: false, note: "未対応アクション" });
          }
        } catch (e) {
          results.push({ type: (act as { type: string }).type, ok: false, note: String(e) });
        }
      }

      const anyFail = results.some((r) => !r.ok);
      // 確保済みの run 行に結果を書き戻す(claim-first のため二重発火はしない)。
      await admin
        .from("automation_runs")
        .update({ status: anyFail ? "partial" : "success", actions_result: results })
        .eq("id", runId);
      firedTotal += 1;
      if (anyFail) errorsTotal += 1;
    }

    // このルールの走査済み位置を更新(次回はこの時刻以降のみ)
    await admin.from("automation_rules").update({ last_evaluated_at: nowIso }).eq("id", rule.id);
  }

  // 運用ログ(既存 batch_runs を再利用)。テナント横断のためログは代表テナントへ集約記録。
  try {
    const repTenant = activeRules[0]?.tenant_id as string | undefined;
    if (repTenant) {
      await admin.from("batch_runs").insert({
        tenant_id: repTenant,
        job_kind: "automation",
        run_date: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        status: errorsTotal ? "partial" : "success",
        targets_total: activeRules.length,
        items_generated: firedTotal,
        items_failed: errorsTotal,
        detail: { rules: activeRules.length, fired: firedTotal, errors: errorsTotal },
      });
    }
  } catch {
    /* 運用ログ失敗は本処理に影響させない */
  }

  return NextResponse.json({ ok: true, rules: activeRules.length, fired: firedTotal, errors: errorsTotal });
}
