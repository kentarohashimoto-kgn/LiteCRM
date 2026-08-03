import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { TEXT_MIMES, inlineTextAttachment } from "@/lib/ai-lab/attachments";
import { addUsage, downloadAttachment, getPendingAttachments, monthlyTokensUsed } from "@/lib/ai-lab/db";
import { isBudgetExceeded, monthRange } from "@/lib/ai-lab/limits";
import { BASE_GUARDRAIL } from "@/lib/ai-lab/prompt";
import { getChatProvider, LabProviderError } from "@/lib/ai-lab/providers";
import type { ChatAttachment } from "@/lib/ai-lab/providers/types";
import { getLabCtx } from "@/lib/ai-lab/session";
import { createDeckWithPlan } from "@/lib/ai-lab/slides-db";
import {
  buildPlanInstruction,
  clampSlideCount,
  DEFAULT_SLIDE_QUALITY,
  parseSlidePlan,
  requestedSlideCount,
} from "@/lib/ai-lab/slides";

/**
 * スライド作成 ①構成案づくり。
 *
 * デザインガイドと議事録を Claude に読ませて、何ページ目に何を載せるかを JSON で決める。
 * 画像生成の前にここを挟むのは、10枚の生成に数分と実費がかかるため。
 * 方向性がずれたまま走り切る事故を、受講者が構成案を直せる形で防ぐ。
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_OUTPUT_TOKENS = 8000;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: string; instruction?: string; attachmentIds?: string[]; count?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const ctx = await getLabCtx(String(body.slug ?? ""));
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });

  const instruction = String(body.instruction ?? "").trim();
  const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [];
  if (!instruction && attachmentIds.length === 0) {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  // 構成案づくりは Claude に任せる。会社が Claude を許可していなければ使えない。
  const planner = ctx.models.find((m) => m.provider === "anthropic" && m.kind === "text");
  if (!planner) return Response.json({ error: "model_not_allowed" }, { status: 400 });
  // 画像生成が許可されていないと、構成案だけ作っても先へ進めない。
  if (!ctx.models.some((m) => m.kind === "image")) {
    return Response.json({ error: "model_not_allowed" }, { status: 400 });
  }

  if (ctx.company.monthly_token_budget != null) {
    const { from, to } = monthRange();
    const used = await monthlyTokensUsed(ctx.company.id, from, to);
    if (isBudgetExceeded(used, ctx.company.monthly_token_budget)) {
      return Response.json({ error: "budget_exceeded" }, { status: 403 });
    }
  }

  const pending = attachmentIds.length
    ? await getPendingAttachments(ctx.company.id, ctx.user.id, attachmentIds)
    : [];
  if (pending.length !== attachmentIds.length) {
    return Response.json({ error: "attachment_rejected" }, { status: 400 });
  }

  const count = body.count != null ? clampSlideCount(Number(body.count)) : requestedSlideCount(instruction);

  // 画像(デザインガイド)は視覚入力、テキスト(議事録)は本文へ差し込む。
  let content = buildPlanInstruction(instruction, count);
  const visuals: ChatAttachment[] = [];
  for (const row of pending) {
    const buf = await downloadAttachment(row);
    if (!buf) continue;
    if ((TEXT_MIMES as readonly string[]).includes(row.mime)) {
      content += inlineTextAttachment(row.file_name, buf.toString("utf8"));
    } else {
      visuals.push({
        kind: row.kind === "image" ? "image" : "document",
        mime: row.mime,
        fileName: row.file_name,
        data: buf.toString("base64"),
      });
    }
  }

  try {
    let text = "";
    const usage = await getChatProvider(planner).stream({
      modelId: planner.modelId(),
      system: BASE_GUARDRAIL,
      messages: [{ role: "user", content, attachments: visuals.length ? visuals : undefined }],
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: req.signal,
      // 構成案は JSON で受け取るだけなので、コード実行は不要。
      enableFileTools: false,
      onDelta: (d) => {
        text += d;
      },
    });

    const plan = parseSlidePlan(text, count);
    if (!plan) return Response.json({ error: "plan_failed" }, { status: 502 });

    const deck = await createDeckWithPlan({
      tenantId: ctx.company.tenant_id,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      instruction,
      quality: DEFAULT_SLIDE_QUALITY,
      plan,
      attachmentIds: pending.map((a) => a.id),
    });
    if (!deck) return Response.json({ error: "provider_error" }, { status: 500 });

    await addUsage({
      tenantId: ctx.company.tenant_id,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      modelKey: planner.key,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return Response.json({ deckId: deck.id });
  } catch (e) {
    const code = e instanceof LabProviderError ? e.code : "provider_error";
    if (code !== "aborted") Sentry.captureException(e);
    return Response.json({ error: code }, { status: code === "rate_limited" ? 429 : 502 });
  }
}
