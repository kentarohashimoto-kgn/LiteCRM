import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 確認キュー(今朝の確認)のデータ取得。
 * 夜間バッチ(方針A)がAI生成した「下書き」のうち、まだ人が確認していないものを集める。
 * v1 = 議事録AI要約(meetings.ai_summary で ai_summary_reviewed_at が未設定)。
 * RLSにより、閲覧権限のある商談だけが対象になる(外部営業は自分の担当のみ)。
 */

export type PendingSummary = {
  meetingId: string;
  opportunityId: string | null;
  title: string | null;
  meetingDate: string | null;
  aiSummary: string;
  aiSummaryAt: string | null;
  oppName: string | null;
  accName: string | null;
};

type Row = {
  id: string;
  opportunity_id: string | null;
  title: string | null;
  meeting_date: string | null;
  ai_summary: string | null;
  ai_summary_at: string | null;
  opportunities: { name: string | null } | null;
  accounts: { name: string | null } | null;
};

export async function getReviewQueue(): Promise<PendingSummary[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("meetings")
    .select("id,opportunity_id,title,meeting_date,ai_summary,ai_summary_at,opportunities(name),accounts(name)")
    .not("ai_summary", "is", null)
    .neq("ai_summary", "")
    .is("ai_summary_reviewed_at", null)
    .order("ai_summary_at", { ascending: false })
    .limit(100);

  return ((data ?? []) as unknown as Row[]).map((m) => ({
    meetingId: m.id,
    opportunityId: m.opportunity_id,
    title: m.title,
    meetingDate: m.meeting_date,
    aiSummary: m.ai_summary ?? "",
    aiSummaryAt: m.ai_summary_at,
    oppName: m.opportunities?.name ?? null,
    accName: m.accounts?.name ?? null,
  }));
}
