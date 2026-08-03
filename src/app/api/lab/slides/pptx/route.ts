import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { downloadAttachment, signAttachmentUrls } from "@/lib/ai-lab/db";
import { buildDeckPptx, type PptxSlideInput } from "@/lib/ai-lab/pptx";
import { getLabCtx } from "@/lib/ai-lab/session";
import { pptxFileName, slideProgress } from "@/lib/ai-lab/slides";
import {
  getDeck,
  listDeckGenerated,
  listSlideItems,
  saveDeckPptx,
  updateDeck,
} from "@/lib/ai-lab/slides-db";

/**
 * スライド作成 ③PPTX統合。
 *
 * 生成済みの画像を position 順に1枚ずつ全面へ敷いた pptx を作る。
 * 生成はライブラリ(pptxgenjs)に任せる。OOXML と ZIP を自前で書くのは、
 * PowerPoint で開いて確かめられない環境では壊れたファイルを出す危険が高いため。
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: string; deckId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const ctx = await getLabCtx(String(body.slug ?? ""));
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });

  const deck = await getDeck(ctx.user.id, String(body.deckId ?? ""));
  if (!deck) return Response.json({ error: "not_found" }, { status: 404 });

  const items = await listSlideItems(deck.id);
  const progress = slideProgress(items);
  // 1枚も出来ていない状態で作ると、中身の無い pptx を渡すことになる。
  if (progress.done === 0) return Response.json({ error: "slides_not_ready" }, { status: 400 });

  try {
    const generated = await listDeckGenerated(deck.id);
    const slides: PptxSlideInput[] = [];
    for (const item of items) {
      if (item.status !== "done" || !item.attachment_id) continue;
      const row = generated.get(item.attachment_id);
      if (!row) continue;
      const data = await downloadAttachment(row);
      if (!data) continue;
      slides.push({ data, mime: row.mime, notes: item.notes });
    }
    if (slides.length === 0) return Response.json({ error: "slides_not_ready" }, { status: 400 });

    const buffer = await buildDeckPptx(slides);
    const fileName = pptxFileName(deck.title);
    const row = await saveDeckPptx({ deck, fileName, data: buffer });
    if (!row) return Response.json({ error: "provider_error" }, { status: 500 });

    await updateDeck(deck.id, { pptx_attachment_id: row.id });
    const urls = await signAttachmentUrls([row]);

    return Response.json({
      fileName: row.file_name,
      url: urls[row.id] ?? null,
      slides: slides.length,
      // 未生成・失敗のまま統合した場合に、何枚が抜けているかを画面へ返す。
      missing: items.length - slides.length,
    });
  } catch (e) {
    // 失敗理由(ストレージのエラーメッセージ等)は例外に載せてある。受講者には出さず記録に残す。
    Sentry.captureException(e);
    return Response.json({ error: "pptx_failed" }, { status: 500 });
  }
}
