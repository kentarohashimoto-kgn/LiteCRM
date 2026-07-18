"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { gatherPmoInput } from "@/lib/data/pmo";
import {
  PMO_MODE_MAP,
  PMO_SYSTEM_PROMPT,
  buildPmoDigest,
  detectPmoAlerts,
  pmoModeInstruction,
  type PmoMode,
} from "@/lib/pmo";

const PMO_MODEL = "claude-opus-4-8";

/**
 * AI-PMO: CRM横断データを収集し、ベテランPMアドバイザーとしての
 * レポート(振り返りPDCA/未来段取り/案件PJ管理/経営俯瞰)を生成して保存する。
 */
export async function generatePmoReportAction(input: {
  mode: PmoMode;
  memo?: string;
}): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const ctx = await requireCtx();
  const modeDef = PMO_MODE_MAP[input.mode];
  if (!modeDef) return { ok: false, error: "不正なモードです" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY が未設定です。Vercelの環境変数に設定するとAI-PMOが使えます。" };
  }

  const data = await gatherPmoInput();
  const alerts = detectPmoAlerts(data);
  const digest = buildPmoDigest(data, alerts);

  const memo = (input.memo ?? "").trim().slice(0, 2000);
  const userPrompt =
    pmoModeInstruction(input.mode, data.today) +
    (memo ? `\n\n# 依頼者からの補足・関心事\n${memo}` : "") +
    "\n\n---CRMデータここから---\n" +
    digest.slice(0, 150_000) +
    "\n---CRMデータここまで---";

  const client = new Anthropic();
  let text = "";
  try {
    const response = await client.messages.create({
      model: PMO_MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      system: PMO_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, error: "AIがレポートを生成できませんでした。再試行してください。" };
    }
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "APIキーが無効です" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "APIのレート制限中です。少し待って再試行してください" };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `AIレポート生成に失敗しました(${e.status})` };
    return { ok: false, error: "AIレポート生成に失敗しました(ネットワークエラー)" };
  }
  if (!text.trim()) return { ok: false, error: "レポートが空でした。再試行してください" };

  const sb = getSupabaseServer();
  const { data: inserted, error } = await sb
    .from("pmo_reports")
    .insert({
      tenant_id: ctx.tenantId,
      mode: input.mode,
      title: `${modeDef.label}（${data.today}）`,
      report_md: text.trim(),
      alerts: alerts.slice(0, 80),
      digest: {
        today: data.today,
        counts: {
          open_opps: data.opps.filter((o) => o.status === "open").length,
          tasks: data.tasks.length,
          meetings: data.meetings.length,
          projects: data.projects.length,
          alerts: alerts.length,
        },
        months: data.months,
        memo: memo || null,
      },
      model: PMO_MODEL,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "レポートの保存に失敗しました" };

  revalidatePath("/app/pmo");
  return { ok: true, reportId: (inserted as { id: string }).id };
}

/** レポート削除(owner/adminのみRLSで許可)。 */
export async function deletePmoReportAction(input: { reportId: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("pmo_reports").delete().eq("id", input.reportId);
  if (error) return { ok: false, error: "削除に失敗しました" };
  revalidatePath("/app/pmo");
  return { ok: true };
}
