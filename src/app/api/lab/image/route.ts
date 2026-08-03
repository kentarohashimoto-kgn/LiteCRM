import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { addUsage, labDb, signImageUrls } from "@/lib/ai-lab/db";
import { getImageProvider, LabProviderError } from "@/lib/ai-lab/providers";
import { prepareLabTurn, saveAssistantMessage } from "@/lib/ai-lab/turn";

/**
 * AI Lab の画像生成(gpt-image-2)。
 * ストリーミングしないため、テキストと違い通常のJSON応答で返す。
 * 生成画像は非公開バケットに保存し、表示は都度の署名URLで行う(履歴からも再表示できる)。
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const IMAGE_COUNT = 1;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: string; conversationId?: string | null; presetId?: string | null; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const prep = await prepareLabTurn({
    slug: String(body.slug ?? ""),
    conversationId: body.conversationId ?? null,
    presetId: body.presetId ?? null,
    modelKey: "image-gen",
    message: String(body.message ?? ""),
  });
  if (!prep.ok) return Response.json({ error: prep.error.code }, { status: prep.error.status });

  const turn = prep.turn;
  if (turn.model.kind !== "image") return Response.json({ error: "model_not_allowed" }, { status: 400 });

  const prompt = String(body.message ?? "").trim();
  try {
    const images = await getImageProvider(turn.model).generate({
      modelId: turn.model.modelId(),
      prompt,
      n: IMAGE_COUNT,
      signal: req.signal,
    });

    const db = labDb();
    const paths: string[] = [];
    for (const img of images) {
      const path = `${turn.ctx.company.id}/${turn.conversation.id}/${crypto.randomUUID()}.png`;
      const { error } = await db.storage
        .from("ai-lab-generated")
        .upload(path, img.data, { contentType: img.mime, upsert: false });
      if (!error) paths.push(path);
    }
    if (paths.length === 0) throw new LabProviderError("provider_error", "画像の保存に失敗しました");

    const messageId = await saveAssistantMessage({
      turn,
      content: "（画像を生成しました）",
      inputTokens: 0,
      outputTokens: 0,
      imagePaths: paths,
    });
    await addUsage({
      tenantId: turn.ctx.company.tenant_id,
      companyId: turn.ctx.company.id,
      userId: turn.ctx.user.id,
      modelKey: turn.model.key,
      inputTokens: 0,
      outputTokens: 0,
      images: paths.length,
    });

    return Response.json({
      conversationId: turn.conversation.id,
      title: turn.conversation.title,
      messageId,
      images: await signImageUrls(paths),
    });
  } catch (e) {
    const code = e instanceof LabProviderError ? e.code : "provider_error";
    await saveAssistantMessage({ turn, content: "", inputTokens: 0, outputTokens: 0, errorCode: code });
    if (code !== "aborted") Sentry.captureException(e);
    return Response.json({ error: code }, { status: code === "rate_limited" ? 429 : 502 });
  }
}
