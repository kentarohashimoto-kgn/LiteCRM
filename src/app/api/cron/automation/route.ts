import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { STAGE_MAP } from "@/lib/constants";
import {
  matchesYomiCondition,
  matchesStageCondition,
  meetsAmount,
  renderTemplate,
  yomiLabel,
  type AutomationAction,
  type TemplateVars,
} from "@/lib/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LOGS = 500;
const MAX_STATE = 300;

interface OppRow { id: string; name: string; owner: string | null; account_id: string | null; amount: number | null; next_action_date: string | null; last_activity_at: string | null; stage: string | null; }
interface Candidate { rule: RuleRow; tenantId: string; triggerRef: string; opp: OppRow; extra: Record<string, string | number | null>; }
interface RuleRow { id: string; tenant_id: string; name: string; trigger_type: string; condition_json: Record<string, unknown>; action_json: AutomationAction[]; last_evaluated_at: string | null; }

function todayJST(): string { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function addDays(dateStr: string, days: number): string { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function yen(n: number | null): string { return n == null ? "—" : Number(n).toLocaleString("ja-JP"); }

/**
 * WO-18/19 ワークフロー自動化(F-102) — バッチ発火。
 * 対応トリガー: yomi_changed / stage_changed(ログ増分) ・ next_action_overdue / no_activity_days(状態走査)。
 * 検知源は新設せず既存ログ・状態を走査。冪等性は automation_runs(rule_id, trigger_ref) の一意制約。
 * 認可: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='automation')。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const startedAt = new Date().toISOString();
  const nowIso = new Date().toISOString();
  const today = todayJST();

  const { data: jobRows } = await admin.from("batch_job_settings").select("tenant_id, enabled").eq("job_kind", "automation");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) return NextResponse.json({ ok: true, skipped: "automation job disabled", fired: 0 });

  const { data: rulesRaw, error: rulesErr } = await admin
    .from("automation_rules")
    .select("id, tenant_id, name, trigger_type, condition_json, action_json, last_evaluated_at")
    .eq("enabled", true)
    .in("trigger_type", ["yomi_changed", "stage_changed", "next_action_overdue", "no_activity_days"]);
  if (rulesErr) return NextResponse.json({ ok: false, error: `ルール取得失敗: ${rulesErr.message}` }, { status: 500 });
  const rules = (rulesRaw ?? []).filter((r) => enabledTenants.has(r.tenant_id as string)) as RuleRow[];
  if (rules.length === 0) return NextResponse.json({ ok: true, fired: 0, note: "有効なルールなし" });

  const oppById = new Map<string, OppRow>();
  const candidates: Candidate[] = [];
  const logRuleIds: string[] = []; // last_evaluated_at を進めるルール

  async function loadOpps(ids: string[]) {
    const missing = ids.filter((id) => !oppById.has(id));
    if (!missing.length) return;
    const { data } = await admin.from("opportunities").select("id, name, owner_user_id, account_id, amount, next_action_date, last_activity_at, stage").in("id", missing.slice(0, MAX_LOGS));
    for (const o of data ?? []) oppById.set(o.id as string, { id: o.id as string, name: (o.name as string) ?? "—", owner: (o.owner_user_id as string) ?? null, account_id: (o.account_id as string) ?? null, amount: (o.amount as number) ?? null, next_action_date: (o.next_action_date as string) ?? null, last_activity_at: (o.last_activity_at as string) ?? null, stage: (o.stage as string) ?? null });
  }

  // ---- ログ増分: yomi_changed ----
  for (const rule of rules.filter((r) => r.trigger_type === "yomi_changed")) {
    logRuleIds.push(rule.id);
    const since = rule.last_evaluated_at ?? "1970-01-01T00:00:00Z";
    const { data: logs } = await admin.from("yomi_change_logs").select("id, opportunity_id, from_yomi, to_yomi").eq("tenant_id", rule.tenant_id).gt("changed_at", since).order("changed_at", { ascending: true }).limit(MAX_LOGS);
    const rows = (logs ?? []).filter((lg) => matchesYomiCondition({ from_yomi: lg.from_yomi as string | null, to_yomi: lg.to_yomi as string | null }, rule.condition_json as never));
    await loadOpps(rows.map((r) => r.opportunity_id as string));
    for (const lg of rows) {
      const opp = oppById.get(lg.opportunity_id as string); if (!opp) continue;
      if (!meetsAmount(opp.amount, (rule.condition_json as { amount_gte?: number }).amount_gte)) continue;
      candidates.push({ rule, tenantId: rule.tenant_id, triggerRef: lg.id as string, opp, extra: { from_yomi: yomiLabel(lg.from_yomi as string | null), to_yomi: yomiLabel(lg.to_yomi as string | null) } });
    }
  }

  // ---- ログ増分: stage_changed ----
  for (const rule of rules.filter((r) => r.trigger_type === "stage_changed")) {
    logRuleIds.push(rule.id);
    const since = rule.last_evaluated_at ?? "1970-01-01T00:00:00Z";
    const { data: logs } = await admin.from("stage_histories").select("id, opportunity_id, from_stage, to_stage").eq("tenant_id", rule.tenant_id).gt("changed_at", since).order("changed_at", { ascending: true }).limit(MAX_LOGS);
    const rows = (logs ?? []).filter((lg) => matchesStageCondition({ from_stage: lg.from_stage as string | null, to_stage: lg.to_stage as string | null }, rule.condition_json as never));
    await loadOpps(rows.map((r) => r.opportunity_id as string));
    for (const lg of rows) {
      const opp = oppById.get(lg.opportunity_id as string); if (!opp) continue;
      if (!meetsAmount(opp.amount, (rule.condition_json as { amount_gte?: number }).amount_gte)) continue;
      candidates.push({ rule, tenantId: rule.tenant_id, triggerRef: lg.id as string, opp, extra: { from_stage: STAGE_MAP[lg.from_stage as string]?.label ?? (lg.from_stage as string) ?? "—", to_stage: STAGE_MAP[lg.to_stage as string]?.label ?? (lg.to_stage as string) ?? "—" } });
    }
  }

  // ---- 状態走査: next_action_overdue ----
  for (const rule of rules.filter((r) => r.trigger_type === "next_action_overdue")) {
    const overdueDays = Number((rule.condition_json as { overdue_days_gte?: number }).overdue_days_gte ?? 1);
    const cutoff = addDays(today, -overdueDays);
    const { data: opps } = await admin.from("opportunities").select("id, name, owner_user_id, account_id, amount, next_action_date, last_activity_at, stage").eq("tenant_id", rule.tenant_id).eq("status", "open").is("deleted_at", null).not("next_action_date", "is", null).lte("next_action_date", cutoff).limit(MAX_STATE);
    for (const o of opps ?? []) {
      const opp: OppRow = { id: o.id as string, name: (o.name as string) ?? "—", owner: (o.owner_user_id as string) ?? null, account_id: (o.account_id as string) ?? null, amount: (o.amount as number) ?? null, next_action_date: (o.next_action_date as string) ?? null, last_activity_at: (o.last_activity_at as string) ?? null, stage: (o.stage as string) ?? null };
      oppById.set(opp.id, opp);
      candidates.push({ rule, tenantId: rule.tenant_id, triggerRef: `${opp.id}:ac:${opp.next_action_date}`, opp, extra: { next_action_date: opp.next_action_date } });
    }
  }

  // ---- 状態走査: no_activity_days ----
  for (const rule of rules.filter((r) => r.trigger_type === "no_activity_days")) {
    const days = Number((rule.condition_json as { days_gte?: number }).days_gte ?? 7);
    const stageIn = (rule.condition_json as { stage_in?: string[] }).stage_in;
    const cutoffTs = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    let q = admin.from("opportunities").select("id, name, owner_user_id, account_id, amount, next_action_date, last_activity_at, stage").eq("tenant_id", rule.tenant_id).eq("status", "open").is("deleted_at", null).not("last_activity_at", "is", null).lte("last_activity_at", cutoffTs).limit(MAX_STATE);
    if (stageIn?.length) q = q.in("stage", stageIn);
    const { data: opps } = await q;
    for (const o of opps ?? []) {
      const opp: OppRow = { id: o.id as string, name: (o.name as string) ?? "—", owner: (o.owner_user_id as string) ?? null, account_id: (o.account_id as string) ?? null, amount: (o.amount as number) ?? null, next_action_date: (o.next_action_date as string) ?? null, last_activity_at: (o.last_activity_at as string) ?? null, stage: (o.stage as string) ?? null };
      oppById.set(opp.id, opp);
      const laDate = (opp.last_activity_at ?? "").slice(0, 10);
      candidates.push({ rule, tenantId: rule.tenant_id, triggerRef: `${opp.id}:noact:${laDate}`, opp, extra: {} });
    }
  }

  // 名前解決(担当・会社名)
  const ownerIds = new Set<string>(); const accIds = new Set<string>();
  for (const o of oppById.values()) { if (o.owner) ownerIds.add(o.owner); if (o.account_id) accIds.add(o.account_id); }
  const nameMap = new Map<string, string>(); const accMap = new Map<string, string>();
  if (ownerIds.size) { const { data } = await admin.from("profiles").select("id, display_name, email").in("id", [...ownerIds]); for (const p of data ?? []) nameMap.set(p.id as string, (p.display_name as string) ?? (p.email as string) ?? "—"); }
  if (accIds.size) { const { data } = await admin.from("accounts").select("id, name").in("id", [...accIds]); for (const a of data ?? []) accMap.set(a.id as string, a.name as string); }

  let firedTotal = 0, errorsTotal = 0;

  for (const c of candidates) {
    const { rule, tenantId, opp } = c;
    // claim-first 冪等
    const claim = await admin.from("automation_runs").insert({ tenant_id: tenantId, rule_id: rule.id, trigger_ref: c.triggerRef, target_type: "opportunity", target_id: opp.id, status: "running", actions_result: [] }).select("id").single();
    if (claim.error || !claim.data) { if (!String(claim.error?.code).includes("23505")) errorsTotal += 1; continue; }
    const runId = claim.data.id as string;

    const vars: TemplateVars = {
      account: opp.account_id ? accMap.get(opp.account_id) ?? opp.name : opp.name,
      opportunity: opp.name,
      owner: opp.owner ? nameMap.get(opp.owner) ?? "—" : "—",
      amount: yen(opp.amount),
      url: `${appUrl}/app/opportunities/${opp.id}`,
      ...c.extra,
    };

    const results: { type: string; ok: boolean; note?: string }[] = [];
    for (const act of (rule.action_json ?? [])) {
      try {
        if (act.type === "slack_notify") {
          if (webhook) { const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: renderTemplate(act.template, vars) }) }); results.push({ type: act.type, ok: res.ok }); }
          else results.push({ type: act.type, ok: false, note: "SLACK_WEBHOOK_URL未設定" });
        } else if (act.type === "app_notify") {
          const targetUser = act.to === "owner" ? opp.owner : null;
          if (targetUser) { const { error } = await admin.from("notifications").insert({ tenant_id: tenantId, user_id: targetUser, kind: "automation", title: renderTemplate(act.title, vars), body: act.body ? renderTemplate(act.body, vars) : null, href: act.href ? renderTemplate(act.href, vars) : `/app/opportunities/${opp.id}` }); results.push({ type: act.type, ok: !error, note: error?.message }); }
          else results.push({ type: act.type, ok: false, note: "宛先(担当)なし" });
        } else if (act.type === "create_task") {
          if (!opp.owner) results.push({ type: act.type, ok: false, note: "担当(owner)なしのため起票不可" });
          else {
            const due = addDays(today, act.due_in_days ?? 3);
            const { error } = await admin.from("tasks").insert({ tenant_id: tenantId, opportunity_id: opp.id, account_id: opp.account_id, assigned_to: opp.owner, created_by: opp.owner, title: renderTemplate(act.title, vars), due_date: due, status: "todo", origin: "automation" });
            results.push({ type: act.type, ok: !error, note: error?.message });
          }
        } else results.push({ type: (act as { type: string }).type, ok: false, note: "未対応アクション" });
      } catch (e) { results.push({ type: (act as { type: string }).type, ok: false, note: String(e) }); }
    }

    const anyFail = results.some((r) => !r.ok);
    await admin.from("automation_runs").update({ status: anyFail ? "partial" : "success", actions_result: results }).eq("id", runId);
    firedTotal += 1;
    if (anyFail) errorsTotal += 1;
  }

  // ログ系ルールの走査位置を更新
  if (logRuleIds.length) await admin.from("automation_rules").update({ last_evaluated_at: nowIso }).in("id", logRuleIds);

  try {
    const repTenant = rules[0]?.tenant_id;
    if (repTenant) await admin.from("batch_runs").insert({ tenant_id: repTenant, job_kind: "automation", run_date: today, started_at: startedAt, ended_at: new Date().toISOString(), status: errorsTotal ? "partial" : "success", targets_total: rules.length, items_generated: firedTotal, items_failed: errorsTotal, detail: { rules: rules.length, candidates: candidates.length, fired: firedTotal, errors: errorsTotal } });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true, rules: rules.length, candidates: candidates.length, fired: firedTotal, errors: errorsTotal });
}
