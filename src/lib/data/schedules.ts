/** 営業スケジュール分類・テンプレートのデータ取得。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface SalesSchedule {
  id: string;
  opportunity_id: string;
  schedule_type: string;
  reason: string;
  approval_status: string;
  approval_comment: string | null;
  expected_month: string | null;
  win_probability: number | null;
  expected_amount: number | null;
  created_at: string;
}

export interface PendingSchedule extends SalesSchedule {
  opportunity_name: string;
  account_name: string;
}

export interface SalesTemplate {
  id: string;
  template_type: string;
  key_name: string;
  pitch: string;
}

/** 案件の最新スケジュール分類（1件）。 */
export async function getLatestSchedule(oppId: string): Promise<SalesSchedule | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("sales_schedules")
    .select("id,opportunity_id,schedule_type,reason,approval_status,approval_comment,expected_month,win_probability,expected_amount,created_at")
    .eq("opportunity_id", oppId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SalesSchedule) ?? null;
}

/** 承認待ち/修正依頼の分類一覧（本部レビュー用）。各案件の最新1件のみ。 */
export async function getPendingSchedules(): Promise<PendingSchedule[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("sales_schedules")
    .select("id,opportunity_id,schedule_type,reason,approval_status,approval_comment,expected_month,win_probability,expected_amount,created_at,opportunities(name,accounts(name))")
    .order("created_at", { ascending: false });
  const seen = new Set<string>();
  const out: PendingSchedule[] = [];
  for (const r of data ?? []) {
    if (seen.has(r.opportunity_id as string)) continue; // 各案件の最新のみ
    seen.add(r.opportunity_id as string);
    if (r.approval_status !== "pending" && r.approval_status !== "needs_revision") continue;
    const opp = r.opportunities as { name?: string; accounts?: { name?: string } | null } | null;
    out.push({
      id: r.id as string,
      opportunity_id: r.opportunity_id as string,
      schedule_type: r.schedule_type as string,
      reason: r.reason as string,
      approval_status: r.approval_status as string,
      approval_comment: (r.approval_comment as string) ?? null,
      expected_month: (r.expected_month as string) ?? null,
      win_probability: (r.win_probability as number) ?? null,
      expected_amount: (r.expected_amount as number) ?? null,
      created_at: r.created_at as string,
      opportunity_name: opp?.name ?? "—",
      account_name: opp?.accounts?.name ?? "—",
    });
  }
  return out;
}

export async function getSalesTemplates(): Promise<SalesTemplate[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("sales_templates").select("id,template_type,key_name,pitch").order("template_type");
  return (data ?? []) as SalesTemplate[];
}

/** 顧客の業種・担当役職に一致するテンプレを返す（完全一致→部分一致）。 */
export function matchTemplates(templates: SalesTemplate[], industry?: string | null, titles: (string | null | undefined)[] = []): SalesTemplate[] {
  const out: SalesTemplate[] = [];
  const ind = (industry ?? "").trim();
  if (ind) {
    const hit = templates.find((t) => t.template_type === "industry" && (t.key_name === ind || ind.includes(t.key_name) || t.key_name.includes(ind)));
    if (hit) out.push(hit);
  }
  for (const title of titles) {
    const tt = (title ?? "").trim();
    if (!tt) continue;
    const hit = templates.find((t) => t.template_type === "role" && (tt.includes(t.key_name) || t.key_name.includes(tt)));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}
