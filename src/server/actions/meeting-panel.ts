"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 商談詳細サイドパネル用のデータ取得(商談一覧から画面遷移せずに内容を確認するため)。
 * 商談メモ画面と同じ情報源から、パネル表示に必要な分だけを1往復で返す。
 * 編集が要る時だけ「商談メモを開く」で詳細ページへ遷移する。
 */

export interface MeetingPanelData {
  ok: boolean;
  error?: string;
  meeting?: {
    id: string;
    title: string | null;
    meetingDate: string | null;
    meetingAt: string | null;
    method: string | null;
    summary: string | null;
    minutesDetail: string | null;
    aiSummary: string | null;
    aiSummaryAt: string | null;
    nextActionDate: string | null;
    nextActionText: string | null;
    ownerName: string | null;
    /** 商談の担当が未設定で案件の担当を代わりに出している場合 true */
    ownerFromOpp: boolean;
    opportunityId: string;
    oppName: string;
    accountId: string | null;
    accountName: string;
    yomi: string | null;
    amount: number | null;
    expectedCloseDate: string | null;
  };
}

export async function getMeetingPanelAction(meetingId: string): Promise<MeetingPanelData> {
  await requireCtx();
  if (!meetingId) return { ok: false, error: "商談IDがありません" };
  const sb = getSupabaseServer();

  const { data: m, error } = await sb
    .from("meetings")
    .select(
      "id,title,meeting_date,meeting_at,method,summary,minutes_detail,ai_summary,ai_summary_at,next_action_date,next_action_text,owner_user_id,opportunity_id," +
        "opportunities!inner(id,name,yomi,amount,expected_close_date,owner_user_id,accounts(id,name))",
    )
    .eq("id", meetingId)
    .maybeSingle();
  if (error || !m) return { ok: false, error: "商談が見つかりません" };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = m as any;
  const opp = row.opportunities ?? {};
  // 担当は商談の担当を優先し、未設定なら親案件の担当を表示する(一覧の営業担当列と同じ規則)。
  const ownerId: string | null = row.owner_user_id ?? opp.owner_user_id ?? null;
  const ownerFromOpp = !row.owner_user_id && Boolean(opp.owner_user_id);
  let ownerName: string | null = null;
  if (ownerId) {
    const { data: p } = await sb.from("profiles").select("display_name,email").eq("id", ownerId).maybeSingle();
    ownerName = ((p as any)?.display_name as string) ?? ((p as any)?.email as string) ?? null;
  }

  return {
    ok: true,
    meeting: {
      id: row.id,
      title: row.title ?? null,
      meetingDate: row.meeting_date ?? null,
      meetingAt: row.meeting_at ?? null,
      method: row.method ?? null,
      summary: row.summary ?? null,
      minutesDetail: row.minutes_detail ?? null,
      aiSummary: row.ai_summary ?? null,
      aiSummaryAt: row.ai_summary_at ?? null,
      nextActionDate: row.next_action_date ?? null,
      nextActionText: row.next_action_text ?? null,
      ownerName,
      ownerFromOpp,
      opportunityId: row.opportunity_id,
      oppName: (opp.name as string) ?? "—",
      accountId: (opp.accounts?.id as string) ?? null,
      accountName: (opp.accounts?.name as string) ?? "—",
      yomi: (opp.yomi as string) ?? null,
      amount: (opp.amount as number) ?? null,
      expectedCloseDate: (opp.expected_close_date as string) ?? null,
    },
  };
}
