"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

// 分類別の自動フォロータスク（要件書5.3）。biz=営業日換算。
const SCHEDULE_TASKS: Record<string, { days: number; biz?: boolean; title: string }[]> = {
  A_short_term: [
    { days: 0, title: "商談御礼＋議事録要約送付" },
    { days: 3, biz: true, title: "提案書・見積送付" },
    { days: 7, title: "稟議状況確認" },
    { days: 14, title: "追加事例・ROI資料送付" },
    { days: 21, title: "決裁者同席MTG打診" },
    { days: 30, title: "受注/保留/失注判断" },
  ],
  B_subsidy_budget: [
    { days: 0, title: "助成金活用可能性の整理" },
    { days: 3, title: "助成金シミュレーション送付" },
    { days: 7, title: "対象人数・研修時間・予算確認" },
    { days: 14, title: "社労士/申請確認の案内" },
    { days: 30, title: "予算化判断" },
    { days: 45, title: "実施時期確定" },
  ],
  C_multi_stakeholder: [
    { days: 0, title: "関係者整理" },
    { days: 3, title: "部署別課題仮説を送付" },
    { days: 7, title: "関係者同席MTGを依頼" },
    { days: 14, title: "部門別提案" },
    { days: 30, title: "トライアル研修/小規模PoC提案" },
  ],
  D_long_term: [{ days: 30, title: "定期接触（情報提供）" }],
  E_nurturing: [],
};

function addDays(base: Date, days: number, biz?: boolean): string {
  const d = new Date(base);
  if (!biz) {
    d.setDate(d.getDate() + days);
  } else {
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) added++;
    }
  }
  return d.toISOString().slice(0, 10);
}

/**
 * 初回商談後の営業スケジュール分類を登録し、分類別フォロータスクを自動生成する。
 * 再分類時は未完了の schedule 由来タスクを削除して再生成（完了済みは残す）。
 */
export async function saveScheduleAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  const scheduleType = String(formData.get("schedule_type"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!oppId || !scheduleType) return;
  if (!reason) {
    redirect(`/app/opportunities/${oppId}?error=` + encodeURIComponent("分類理由を入力してください"));
  }

  // 予想値: 成約時期(年月)・受注確度・受注金額
  const monthRaw = String(formData.get("expected_month") ?? "").trim();
  const expectedMonth = monthRaw ? monthRaw.slice(0, 7) + "-01" : null;
  const probRaw = String(formData.get("win_probability") ?? "").trim();
  const winProbability = probRaw === "" ? null : Math.max(0, Math.min(100, parseInt(probRaw, 10) || 0));
  const amountRaw = String(formData.get("expected_amount") ?? "").replace(/[^\d.-]/g, "");
  const expectedAmount = amountRaw === "" ? null : Number(amountRaw);

  await sb.from("sales_schedules").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    schedule_type: scheduleType,
    reason,
    expected_month: expectedMonth,
    win_probability: winProbability,
    expected_amount: Number.isNaN(expectedAmount as number) ? null : expectedAmount,
    proposed_by: ctx.userId,
    approval_status: "pending",
  });

  // 案件の予測にも反映(売上予測・カレンダーと整合)。入力があった項目のみ更新。
  const oppPatch: Record<string, unknown> = {};
  if (expectedMonth) oppPatch.expected_revenue_month = expectedMonth;
  if (winProbability != null) oppPatch.rep_probability = winProbability;
  if (expectedAmount != null && !Number.isNaN(expectedAmount)) oppPatch.amount = expectedAmount;
  if (Object.keys(oppPatch).length) await sb.from("opportunities").update(oppPatch).eq("id", oppId);

  // 未完了の分類由来タスクを削除して再生成
  await sb.from("tasks").delete().eq("opportunity_id", oppId).eq("origin", "schedule").neq("status", "done");

  const { data: opp } = await sb.from("opportunities").select("account_id").eq("id", oppId).maybeSingle();
  const today = new Date();
  const tasks = (SCHEDULE_TASKS[scheduleType] ?? []).map((t) => ({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: (opp?.account_id as string) ?? null,
    assigned_to: ctx.userId,
    created_by: ctx.userId,
    title: t.title,
    description: "スケジュール分類による自動作成",
    due_date: addDays(today, t.days, t.biz),
    status: "todo",
    priority: "middle",
    origin: "schedule",
  }));
  if (tasks.length) await sb.from("tasks").insert(tasks);

  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/exec");
}

/** 本部が分類を承認/却下/修正依頼する。 */
export async function decideScheduleAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const oppId = String(formData.get("opportunity_id"));
  const decision = String(formData.get("decision"));
  const comment = String(formData.get("approval_comment") ?? "").trim() || null;
  if (!["approved", "rejected", "needs_revision"].includes(decision)) return;
  await sb
    .from("sales_schedules")
    .update({ approval_status: decision, approval_comment: comment, approved_by: ctx.userId })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/exec");
}
