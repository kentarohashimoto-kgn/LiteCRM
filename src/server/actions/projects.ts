"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProjectCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { cellCost } from "@/lib/project-cost";

function str(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** month入力(YYYY-MM)を date(YYYY-MM-01)へ。既に日付ならそのまま先頭7桁を採用。 */
function monthDate(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s ? `${s.slice(0, 7)}-01` : null;
}

function revalidateProject(oppId: string) {
  revalidatePath(`/app/projects/${oppId}`);
  revalidatePath("/app/projects");
  revalidatePath(`/app/opportunities/${oppId}`);
}

/** 案件を「案件管理対象」にし、実行計画を用意して詳細へ遷移。 */
export async function enableProjectManagementAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  if (!oppId) redirect("/app/projects");

  await sb.from("opportunities").update({ is_project_managed: true }).eq("id", oppId);
  const { data: existing } = await sb.from("project_plans").select("id").eq("opportunity_id", oppId).maybeSingle();
  if (!existing) {
    const { data: opp } = await sb.from("opportunities").select("account_id").eq("id", oppId).maybeSingle();
    await sb.from("project_plans").insert({
      tenant_id: ctx.tenantId,
      opportunity_id: oppId,
      account_id: (opp as { account_id: string | null } | null)?.account_id ?? null,
      created_by: ctx.userId,
    });
  }
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}`);
}

/** 案件管理対象から外す(計画データは残す)。 */
export async function disableProjectManagementAction(formData: FormData) {
  await requireProjectCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  await sb.from("opportunities").update({ is_project_managed: false }).eq("id", oppId);
  revalidateProject(oppId);
  redirect(`/app/opportunities/${oppId}`);
}

/** 計画ヘッダ(期間・最低粗利率・本部関与・リスク・メモ)を更新。 */
export async function updateProjectPlanAction(formData: FormData) {
  await requireProjectCtx();
  const sb = getSupabaseServer();
  const planId = String(formData.get("plan_id"));
  const oppId = String(formData.get("opportunity_id"));
  const minRate = num(formData.get("min_gross_rate"));
  await sb
    .from("project_plans")
    .update({
      start_month: monthDate(formData.get("start_month")),
      end_month: monthDate(formData.get("end_month")),
      min_gross_rate: minRate == null ? 0.25 : Math.max(0, Math.min(0.99, minRate > 1 ? minRate / 100 : minRate)),
      hq_involvement: str(formData.get("hq_involvement")) ?? "none",
      plan_risk: str(formData.get("plan_risk")) ?? "low",
      notes: str(formData.get("notes")),
    })
    .eq("id", planId);
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=1`);
}

/** 受注時: 計画をベースラインとして確定(以後の実績はこれと比較)。 */
export async function lockBaselineAction(formData: FormData) {
  await requireProjectCtx();
  const sb = getSupabaseServer();
  const planId = String(formData.get("plan_id"));
  const oppId = String(formData.get("opportunity_id"));
  await sb
    .from("project_plans")
    .update({ status: "in_progress", baseline_locked_at: new Date().toISOString() })
    .eq("id", planId);
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=baseline`);
}

/** 月別の販売(売上)計画をまとめて保存(既存を置き換え)。 */
export async function saveRevenueMonthsAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const planId = String(formData.get("plan_id"));
  const oppId = String(formData.get("opportunity_id"));
  const months = formData.getAll("rev_month").map((v) => `${String(v).slice(0, 7)}-01`);
  const amounts = formData.getAll("rev_amount").map((v) => Number(String(v)) || 0);
  const rows = months
    .map((month, i) => ({ month, amount: amounts[i] ?? 0 }))
    .filter((r) => r.month && r.month.length === 10);

  await sb.from("project_revenue_months").delete().eq("plan_id", planId);
  if (rows.length > 0) {
    await sb.from("project_revenue_months").insert(
      rows.map((r) => ({ tenant_id: ctx.tenantId, plan_id: planId, month: r.month, amount: r.amount }))
    );
  }
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=1`);
}

/** アサイン1件(＋月別の工数・稼働率・原価)を作成/更新。 */
export async function saveAssignmentAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const planId = String(formData.get("plan_id"));
  const oppId = String(formData.get("opportunity_id"));
  const assignmentId = str(formData.get("assignment_id"));
  const costRate = num(formData.get("cost_rate")) ?? 0;
  const kind = str(formData.get("kind")) ?? "external";

  const patch = {
    kind,
    member_user_id: kind === "internal" ? str(formData.get("member_user_id")) : null,
    label: str(formData.get("label")) ?? "アサイン",
    role: str(formData.get("role")),
    cost_rate: costRate,
    bill_rate: num(formData.get("bill_rate")),
    start_month: monthDate(formData.get("start_month")),
    end_month: monthDate(formData.get("end_month")),
    notes: str(formData.get("notes")),
  };

  let aid = assignmentId;
  if (aid) {
    await sb.from("project_assignments").update(patch).eq("id", aid);
  } else {
    const { data } = await sb
      .from("project_assignments")
      .insert({ tenant_id: ctx.tenantId, plan_id: planId, status: "active", ...patch })
      .select("id")
      .single();
    aid = (data as { id: string } | null)?.id ?? null;
  }

  if (aid) {
    // 月別セルを置き換え(工数0は保存しない)。原価は書込時に算出。
    const cmMonths = formData.getAll("cm_month").map((v) => String(v).slice(0, 7));
    const cmMM = formData.getAll("cm_mm").map((v) => Number(String(v)) || 0);
    const cmRatio = formData.getAll("cm_ratio").map((v) => {
      const n = Number(String(v));
      return Number.isFinite(n) ? n : 1;
    });
    const cells = cmMonths
      .map((m, i) => ({ month: `${m}-01`, mm: cmMM[i] ?? 0, ratio: cmRatio[i] ?? 1 }))
      .filter((c) => c.month.length === 10 && c.mm > 0);

    await sb.from("project_cost_months").delete().eq("assignment_id", aid);
    if (cells.length > 0) {
      await sb.from("project_cost_months").insert(
        cells.map((c) => ({
          tenant_id: ctx.tenantId,
          plan_id: planId,
          assignment_id: aid,
          month: c.month,
          man_month: c.mm,
          ratio: c.ratio,
          cost_amount: cellCost(costRate, c.mm, c.ratio),
        }))
      );
    }
  }
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=1`);
}

/** アサインを削除(月別原価も連鎖削除)。 */
export async function deleteAssignmentAction(formData: FormData) {
  await requireProjectCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  await sb.from("project_assignments").delete().eq("id", String(formData.get("assignment_id")));
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=1`);
}

/** 週次実績(予定/実績の工数・原価、進捗、状態)を保存。 */
export async function saveWeeklyReportAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const planId = String(formData.get("plan_id"));
  const oppId = String(formData.get("opportunity_id"));
  await sb.from("project_weekly_reports").insert({
    tenant_id: ctx.tenantId,
    plan_id: planId,
    assignment_id: str(formData.get("assignment_id")),
    week_start: str(formData.get("week_start")),
    planned_mm: num(formData.get("planned_mm")),
    actual_mm: num(formData.get("actual_mm")),
    planned_cost: num(formData.get("planned_cost")),
    actual_cost: num(formData.get("actual_cost")),
    progress_pct: num(formData.get("progress_pct")),
    status: str(formData.get("status")) ?? "on_track",
    reporter: str(formData.get("reporter")),
    blockers: str(formData.get("blockers")),
    notes: str(formData.get("notes")),
    created_by: ctx.userId,
  });
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=weekly`);
}

/** 週次実績を削除。 */
export async function deleteWeeklyReportAction(formData: FormData) {
  await requireProjectCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  await sb.from("project_weekly_reports").delete().eq("id", String(formData.get("id")));
  revalidateProject(oppId);
  redirect(`/app/projects/${oppId}?saved=1`);
}
