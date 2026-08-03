import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { selectImageReferences } from "@/lib/ai-lab/attachments";
import {
  addUsage,
  downloadAttachment,
  highImagesToday,
  monthlyTokensUsed,
  signAttachmentUrls,
} from "@/lib/ai-lab/db";
import { canUseHighImages, highImageQuota, isBudgetExceeded, monthRange } from "@/lib/ai-lab/limits";
import { resolveModel } from "@/lib/ai-lab/models";
import { getImageProvider, LabProviderError } from "@/lib/ai-lab/providers";
import type { ImageReference } from "@/lib/ai-lab/providers/types";
import { getLabCtx } from "@/lib/ai-lab/session";
import { buildSlideImagePrompt } from "@/lib/ai-lab/slides";
import {
  getDeck,
  getSlideItem,
  listDeckAttachments,
  listDeckGenerated,
  listSlideItems,
  saveSlideImage,
  updateDeck,
  updateSlideItem,
} from "@/lib/ai-lab/slides-db";

/**
 * スライド作成 ②画像生成（1リクエスト1枚）。
 *
 * 10枚を1リクエストで作ると関数の実行時間上限(300秒)を超えるため、ブラウザ側から
 * 1枚ずつ順に叩く形にしている。進捗が見え、失敗した枚だけ作り直せる利点もある。
 *
 * 参照画像には「受講者が渡したデザインガイド」に加えて「直前に生成したスライド」を足す。
 * ガイドだけだとページごとに配色や余白がぶれるため。
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const IMAGE_COUNT = 1;
/**
 * スライド画像の署名URLの有効時間。
 * 10枚の生成に数分かかるため、既定(10分)だと最初の数枚が生成中に切れて画像が消える。
 */
const SLIDE_URL_TTL_SEC = 3600;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: string; deckId?: string; position?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const ctx = await getLabCtx(String(body.slug ?? ""));
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });

  const deck = await getDeck(ctx.user.id, String(body.deckId ?? ""));
  if (!deck) return Response.json({ error: "not_found" }, { status: 404 });

  const position = Number(body.position);
  const item = Number.isFinite(position) ? await getSlideItem(deck.id, position) : null;
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });

  const model = ctx.models.find((m) => m.kind === "image") ?? null;
  if (!model || !resolveModel(model.key)) {
    return Response.json({ error: "model_not_allowed" }, { status: 400 });
  }

  if (ctx.company.monthly_token_budget != null) {
    const { from, to } = monthRange();
    const used = await monthlyTokensUsed(ctx.company.id, from, to);
    if (isBudgetExceeded(used, ctx.company.monthly_token_budget)) {
      return Response.json({ error: "budget_exceeded" }, { status: 403 });
    }
  }

  // High は単価が高いので1人1日の枚数で止める。運営の検証アカウントは対象外。
  if (deck.quality === "high") {
    const quota = highImageQuota(await highImagesToday(ctx.user.id), ctx.user.is_unlimited);
    if (!canUseHighImages(quota)) {
      return Response.json({ error: "high_quota_exceeded" }, { status: 429 });
    }
  }

  const items = await listSlideItems(deck.id);
  const prompt = buildSlideImagePrompt({
    styleGuide: deck.style_guide,
    title: item.title,
    imagePrompt: item.image_prompt,
    position: item.position,
    total: items.length,
  });

  try {
    if (deck.status !== "generating") await updateDeck(deck.id, { status: "generating", error_code: null });

    const references = await collectReferences(deck.id, items, item.position);
    const images = await getImageProvider(model).generate({
      modelId: model.modelId(),
      prompt,
      n: IMAGE_COUNT,
      quality: deck.quality,
      references,
      signal: req.signal,
    });
    const first = images[0];
    if (!first) throw new LabProviderError("provider_error", "画像が生成されませんでした");

    const row = await saveSlideImage({ deck, item, data: first.data, mime: first.mime });
    if (!row) throw new LabProviderError("provider_error", "画像の保存に失敗しました");

    await updateSlideItem(item.id, { status: "done", attachment_id: row.id, error_code: null });
    await addUsage({
      tenantId: ctx.company.tenant_id,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      modelKey: model.key,
      inputTokens: 0,
      outputTokens: 0,
      images: 1,
      highImages: deck.quality === "high" ? 1 : 0,
    });

    // 最後の1枚が終わったらデッキを ready にする(統合ボタンの活性判定に使う)。
    const after = items.map((i) => (i.id === item.id ? { ...i, status: "done" as const } : i));
    if (after.every((i) => i.status === "done")) await updateDeck(deck.id, { status: "ready" });

    // 1枚ごとに署名URLを返し、生成の途中でもサムネイルを出せるようにする。
    // 全部終わるまで見えないと、10枚のあいだ何が出来ているのか分からない。
    const urls = await signAttachmentUrls([row], SLIDE_URL_TTL_SEC);
    return Response.json({ position: item.position, attachmentId: row.id, imageUrl: urls[row.id] ?? null });
  } catch (e) {
    const code = e instanceof LabProviderError ? e.code : "provider_error";
    if (code !== "aborted") Sentry.captureException(e);
    // 失敗した枚だけを作り直せるよう、状態を残す(他の枚には触らない)。
    await updateSlideItem(item.id, { status: "failed", error_code: code });
    return Response.json({ error: code, position: item.position }, { status: code === "rate_limited" ? 429 : 502 });
  }
}

/**
 * 参照画像を集める。
 * デザインガイド等の添付を優先し、余りがあれば直前に生成したスライドを足して
 * ページ間のトンマナを寄せる。枚数・合計サイズの上限は共通の選定関数に任せる。
 */
async function collectReferences(
  deckId: string,
  items: { position: number; status: string; attachment_id: string | null }[],
  position: number,
): Promise<ImageReference[]> {
  const uploads = await listDeckAttachments(deckId);
  const rows = [...uploads];

  const previous = items
    .filter((i) => i.position < position && i.status === "done" && i.attachment_id)
    .sort((a, b) => b.position - a.position)[0];
  if (previous?.attachment_id) {
    const generated = await listDeckGenerated(deckId);
    const row = generated.get(previous.attachment_id);
    if (row) rows.push(row);
  }

  const { used } = selectImageReferences(
    rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      row,
    })),
  );

  const refs: ImageReference[] = [];
  for (const ref of used) {
    const buf = await downloadAttachment(ref.row);
    if (buf) refs.push({ fileName: ref.fileName, mime: ref.mime, data: buf });
  }
  return refs;
}
