"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProjectCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

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
/** month入力(YYYY-MM)を date(YYYY-MM-01)へ。 */
function monthDate(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s ? `${s.slice(0, 7)}-01` : null;
}

/** デリバリー見込みを作成/更新する。既存案件に紐づけると同一行にマージ表示される。 */
export async function saveDeliveryForecastAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));

  // 紐づけ案件(任意)。指定時は顧客も案件から引き継ぐ
  const oppId = str(formData.get("opportunity_id"));
  let accountId: string | null = null;
  let oppName: string | null = null;
  if (oppId) {
    const { data } = await sb.from("opportunities").select("account_id, name").eq("id", oppId).maybeSingle();
    accountId = (data as { account_id: string | null; name: string } | null)?.account_id ?? null;
    oppName = (data as { name: string } | null)?.name ?? null;
  }

  const prob = num(formData.get("probability"));
  const patch = {
    kind: str(formData.get("kind")) === "new" ? "new" : "continuation",
    opportunity_id: oppId,
    account_id: accountId,
    // タイトル未入力で案件に紐づけた場合は「案件名（継続）」を自動採用
    title: str(formData.get("title")) ?? (oppName ? `${oppName}（継続）` : "見込み"),
    start_month: monthDate(formData.get("start_month")),
    end_month: monthDate(formData.get("end_month")),
    amount: num(formData.get("amount")),
    amount_basis: str(formData.get("amount_basis")) === "total" ? "total" : "monthly",
    probability: prob == null ? 50 : Math.max(0, Math.min(100, Math.round(prob))),
    required_headcount: num(formData.get("required_headcount")),
    staffing_status: (["ready", "shortage", "unknown"].includes(String(formData.get("staffing_status"))) ? String(formData.get("staffing_status")) : "unknown"),
    arrange_deadline: str(formData.get("arrange_deadline")),
    notes: str(formData.get("notes")),
  };

  if (id) {
    await sb.from("delivery_forecasts").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  } else {
    await sb.from("delivery_forecasts").insert({ tenant_id: ctx.tenantId, owner_user_id: ctx.userId, created_by: ctx.userId, ...patch });
  }
  revalidatePath("/app/projects");
}

/**
 * 商談中(未受注)の案件を「見込み管理」に載せる。
 * 案件の基礎情報(顧客・案件名・金額・確度・受注予定月)を引き継いで見込みを作成し、
 * 案件に紐づけたままカレンダーへ。受注して対象化するとそのまま同じ行が確定に切り替わる。
 */
export async function startForecastFromOpportunityAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) return;

  // 二重登録防止: 既にこの案件の見込みがあれば作らずカレンダーへ
  const { data: existing } = await sb
    .from("delivery_forecasts").select("id").eq("opportunity_id", oppId).eq("status", "active").limit(1);
  if (!existing || existing.length === 0) {
    const { data: opp } = await sb
      .from("opportunities")
      .select("name, account_id, amount, probability, status, expected_close_date, expected_revenue_month")
      .eq("id", oppId)
      .maybeSingle();
    if (!opp) return;
    const o = opp as { name: string; account_id: string | null; amount: number | null; probability: number | null; status: string; expected_close_date: string | null; expected_revenue_month: string | null };
    const start = o.expected_revenue_month ?? (o.expected_close_date ? `${o.expected_close_date.slice(0, 7)}-01` : null);
    await sb.from("delivery_forecasts").insert({
      tenant_id: ctx.tenantId,
      opportunity_id: oppId,
      account_id: o.account_id,
      kind: o.status === "won" ? "continuation" : "new",
      title: o.name,
      amount: o.amount,
      amount_basis: "total",
      probability: Math.max(0, Math.min(100, Math.round(o.probability ?? 50))),
      start_month: start,
      end_month: start,
      staffing_status: "unknown",
      owner_user_id: ctx.userId,
      created_by: ctx.userId,
    });
  }
  revalidatePath("/app/projects");
  redirect("/app/projects?view=calendar");
}

/** デリバリー見込みを削除する。 */
export async function deleteDeliveryForecastAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb.from("delivery_forecasts").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/projects");
}
