"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * D-4 AI支援v1: 商談の議事録詳細(minutes_detail)から要約＋次アクション提案を生成し、
 * meetings.ai_summary に保存する。ANTHROPIC_API_KEY 未設定時は安全にエラーを返す。
 */
export async function generateMeetingSummaryAction(input: {
  meetingId: string;
  opportunityId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY が未設定です。Vercelの環境変数に設定するとAI要約が使えます。" };
  }

  const sb = getSupabaseServer();
  const { data: meeting } = await sb
    .from("meetings")
    .select("id, title, meeting_date, meeting_at, minutes_detail, summary, opportunities(name, accounts(name))")
    .eq("id", input.meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "商談が見つかりません" };
  const m = meeting as unknown as {
    minutes_detail: string | null;
    title: string;
    meeting_date: string | null;
    opportunities: { name: string; accounts: { name: string } | null } | null;
  };
  if (!m.minutes_detail || m.minutes_detail.trim().length < 30) {
    return { ok: false, error: "議事録詳細が短すぎます。全文・文字起こしを貼り付けてから実行してください。" };
  }

  const oppName = m.opportunities?.name ?? "";
  const accName = m.opportunities?.accounts?.name ?? "";

  const client = new Anthropic();
  let text = "";
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system:
        "あなたはB2B営業支援CRMのアシスタントです。商談の議事録から、営業チームがそのまま使える簡潔な日本語の要約を作成します。" +
        "推測で情報を補わず、議事録に書かれている内容だけを使ってください。",
      messages: [
        {
          role: "user",
          content:
            `以下は「${accName}｜${oppName}」の商談「${m.title}」(${m.meeting_date ?? ""})の議事録です。\n` +
            "次の形式で要約してください:\n" +
            "## 要点\n- (3〜6個の箇条書き)\n" +
            "## 顧客の課題・関心\n- (箇条書き)\n" +
            "## 決定事項\n- (なければ「なし」)\n" +
            "## 宿題・次アクション\n- (担当と期日が分かれば含める)\n" +
            "## リスク・懸念\n- (なければ「なし」)\n\n" +
            "---議事録ここから---\n" +
            m.minutes_detail.slice(0, 100_000) +
            "\n---議事録ここまで---",
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, error: "AIが要約を生成できませんでした。内容を確認して再試行してください。" };
    }
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "APIキーが無効です" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "APIのレート制限中です。少し待って再試行してください" };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `AI要約に失敗しました(${e.status})` };
    return { ok: false, error: "AI要約に失敗しました(ネットワークエラー)" };
  }
  if (!text.trim()) return { ok: false, error: "要約が空でした。再試行してください" };

  await sb
    .from("meetings")
    .update({ ai_summary: text.trim(), ai_summary_at: new Date().toISOString() })
    .eq("id", input.meetingId);
  revalidatePath(`/app/opportunities/${input.opportunityId}/meetings/${input.meetingId}`);
  return { ok: true };
}
