"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { MAIL_TOUCH_LABEL } from "@/lib/engagement";

/**
 * リード詳細サイドパネル用のデータ取得(画面遷移せずに一覧上で確認するため)。
 * 詳細ページと同じ情報源から、パネル表示に必要な分だけを1往復で返す。
 */

export interface LeadPanelData {
  ok: boolean;
  error?: string;
  lead?: {
    id: string;
    company: string;
    contact: string;
    email: string | null;
    phone: string | null;
    mobilePhone: string | null;
    jobTitle: string | null;
    department: string | null;
    industry: string | null;
    employeeSize: string | null;
    event: string | null;
    acquirer: string | null;
    acquiredAt: string | null;
    rank: string | null;
    leadScore: number | null;
    scoreDetail: Record<string, number | string> | null;
    priorityGrade: string | null;
    disposition: string;
    funnelStage: string;
    needs: string | null;
    timing: string | null;
    budgetBand: string | null;
    notes: string | null;
    converted: boolean;
    opportunityId: string | null;
  };
  engagement?: { score: number; rank: string; touchCount: number };
  touchpoints?: { type: string; label: string; weight: number; occurredAt: string | null }[];
}

export async function getLeadPanelAction(leadId: string): Promise<LeadPanelData> {
  await requireCtx();
  if (!leadId) return { ok: false, error: "リードIDがありません" };
  const sb = getSupabaseServer();

  const { data: l, error } = await sb.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error || !l) return { ok: false, error: "リードが見つかりません" };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = l as any;
  const email = (row.email as string | null)?.trim().toLowerCase() || null;

  const [engR, tpR, oppR] = await Promise.all([
    email ? sb.from("person_engagement").select("score, rank, touch_count").eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
    email ? sb.from("touchpoints").select("type, weight, occurred_at").eq("email", email).order("occurred_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] as any[] }),
    sb.from("opportunities").select("id").eq("lead_id", leadId).limit(1).maybeSingle(),
  ]);

  const TP_LABEL: Record<string, string> = {
    exhibition: "展示会で名刺交換", call: "架電ログ", seminar: "セミナー参加", survey: "アンケート回答",
    doc_request: "資料請求", meeting: "商談実施", meeting_repeat: "再商談", visit: "訪問", proposal: "見積・提案提出",
    ...MAIL_TOUCH_LABEL,
  };

  return {
    ok: true,
    lead: {
      id: row.id,
      company: row.company_name ?? "",
      contact: row.contact_name ?? "",
      email: row.email ?? null,
      phone: row.phone ?? null,
      mobilePhone: row.mobile_phone ?? null,
      jobTitle: row.job_title ?? null,
      department: row.department ?? null,
      industry: row.industry ?? null,
      employeeSize: row.employee_size ?? null,
      event: row.raw_event ?? null,
      acquirer: row.acquirer ?? null,
      acquiredAt: row.acquired_at ?? null,
      rank: row.rank ?? null,
      leadScore: row.lead_score ?? null,
      scoreDetail: (row.lead_score_detail as Record<string, number | string>) ?? null,
      priorityGrade: row.priority_grade ?? null,
      disposition: row.disposition ?? "untouched",
      funnelStage: row.funnel_stage ?? "new",
      needs: row.needs ?? null,
      timing: row.timing ?? null,
      budgetBand: row.budget_band ?? null,
      notes: row.notes ?? null,
      converted: !!row.account_id || row.status === "converted",
      opportunityId: (oppR.data?.id as string) ?? null,
    },
    engagement: engR.data
      ? { score: (engR.data as any).score ?? 0, rank: (engR.data as any).rank ?? "D", touchCount: (engR.data as any).touch_count ?? 0 }
      : { score: 0, rank: "D", touchCount: 0 },
    touchpoints: ((tpR.data ?? []) as any[]).map((t) => ({
      type: t.type, label: TP_LABEL[t.type] ?? t.type, weight: t.weight ?? 1, occurredAt: t.occurred_at ?? null,
    })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
