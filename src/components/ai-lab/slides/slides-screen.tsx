import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Presentation } from "lucide-react";
import { listConversations, signAttachmentUrls, type LabAttachmentRow } from "@/lib/ai-lab/db";
import { requireLabCtx } from "@/lib/ai-lab/session";
import { slideProgress } from "@/lib/ai-lab/slides";
import { getDeck, listDecks, listDeckGenerated, listSlideItems } from "@/lib/ai-lab/slides-db";
import type { LabUiDeck, LabUiDeckSummary } from "@/lib/ai-lab/slides-ui-types";

/** スライド画像・pptx の署名URLの有効時間。生成と確認にかかる時間に合わせて長めに取る。 */
const SLIDE_URL_TTL_SEC = 3600;
import { LabShell } from "../lab-shell";
import { DeckClient } from "./deck-client";
import { NewDeckForm } from "./new-deck-form";

/**
 * スライド作成画面のサーバー側組み立て。
 * 一覧(deckId なし)と個別(deckId あり)で必要なデータがほぼ同じなので、両ページから共有する。
 */
export async function SlidesScreen({ slug, deckId }: { slug: string; deckId?: string }) {
  const ctx = await requireLabCtx(slug);
  const conversations = await listConversations(ctx.user.id);

  const canGenerate =
    ctx.models.some((m) => m.provider === "anthropic" && m.kind === "text") &&
    ctx.models.some((m) => m.kind === "image");

  const shell = (children: React.ReactNode) => (
    <LabShell
      slug={slug}
      companyName={ctx.company.name}
      displayName={ctx.user.display_name}
      isPreview={ctx.user.is_preview}
      conversations={conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }))}
      activeId={null}
      slidesActive
    >
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </LabShell>
  );

  if (deckId) {
    const deck = await getDeck(ctx.user.id, deckId);
    if (!deck) notFound();

    const items = await listSlideItems(deck.id);
    const generated = await listDeckGenerated(deck.id);

    const rows: LabAttachmentRow[] = [];
    for (const i of items) {
      const row = i.attachment_id ? generated.get(i.attachment_id) : null;
      if (row) rows.push(row);
    }
    let pptxRow: LabAttachmentRow | null = null;
    if (deck.pptx_attachment_id) {
      const all = await listDeckGenerated(deck.id);
      pptxRow = all.get(deck.pptx_attachment_id) ?? null;
    }
    // 生成に数分かかるので、既定(10分)だと画面を開いたまま作業する間に切れてしまう。
    const urls = await signAttachmentUrls([...rows, ...(pptxRow ? [pptxRow] : [])], SLIDE_URL_TTL_SEC);

    const ui: LabUiDeck = {
      id: deck.id,
      title: deck.title,
      instruction: deck.instruction,
      quality: deck.quality,
      status: deck.status,
      createdAt: deck.created_at,
      pptxUrl: pptxRow ? (urls[pptxRow.id] ?? null) : null,
      pptxFileName: pptxRow?.file_name ?? null,
      items: items.map((i) => ({
        position: i.position,
        title: i.title,
        summary: i.summary ?? "",
        imagePrompt: i.image_prompt,
        notes: i.notes ?? "",
        status: i.status,
        errorCode: i.error_code,
        imageUrl: i.attachment_id ? (urls[i.attachment_id] ?? null) : null,
      })),
    };

    return shell(
      <>
        <div className="mb-4">
          <Link href={`/lab/${slug}/slides`} className="text-xs text-teal-deep hover:underline">
            ← スライド一覧
          </Link>
          <h1 className="mt-1 text-lg font-bold text-ink">{deck.title}</h1>
          {deck.instruction && <p className="mt-1 text-xs text-ink/55">{deck.instruction}</p>}
        </div>
        <DeckClient slug={slug} deck={ui} />
      </>,
    );
  }

  const decks = await listDecks(ctx.user.id);
  const summaries: LabUiDeckSummary[] = [];
  for (const d of decks) {
    const items = await listSlideItems(d.id);
    const p = slideProgress(items);
    summaries.push({
      id: d.id,
      title: d.title,
      status: d.status,
      createdAt: d.created_at,
      total: p.total,
      done: p.done,
    });
  }

  return shell(
    <>
      <div className="mb-4 flex items-center gap-2">
        <Presentation size={18} className="text-teal-primary" />
        <h1 className="text-lg font-bold text-ink">スライド作成</h1>
      </div>

      <NewDeckForm slug={slug} canGenerate={canGenerate} />

      {summaries.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-semibold text-ink/50">これまでに作ったもの</h2>
          <ul className="space-y-2">
            {summaries.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/lab/${slug}/slides/${d.id}`}
                  className="card flex items-center gap-3 px-4 py-3 transition-colors hover:bg-mist-soft"
                >
                  <FileText size={16} className="shrink-0 text-ink/30" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{d.title}</span>
                  <span className="shrink-0 text-xs text-ink/50">
                    {d.done}/{d.total} 枚
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>,
  );
}
