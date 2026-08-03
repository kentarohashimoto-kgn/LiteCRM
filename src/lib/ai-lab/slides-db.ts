import {
  ATTACHMENT_COLS,
  createAttachment,
  labDb,
  OUTPUT_BUCKET,
  type LabAttachmentRow,
} from "./db";
import { PPTX_MIME } from "./pptx";
import type { SlidePlan, SlideQuality } from "./slides";

/**
 * スライド作成のデータアクセス。
 *
 * db.ts と同じ方針で、service_role を使う代わりに company_id / user_id の絞り込みを
 * この層で必ず付ける。デッキIDは推測できないが、他人のIDを渡された場合に
 * 「見つからない」で終わるようにしておく。
 */

export interface LabSlideDeckRow {
  id: string;
  tenant_id: string;
  company_id: string;
  user_id: string;
  title: string;
  instruction: string;
  style_guide: string | null;
  quality: SlideQuality;
  status: "draft" | "generating" | "ready" | "failed";
  error_code: string | null;
  pptx_attachment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LabSlideItemRow {
  id: string;
  deck_id: string;
  position: number;
  title: string;
  summary: string | null;
  image_prompt: string;
  notes: string | null;
  status: "pending" | "done" | "failed";
  attachment_id: string | null;
  error_code: string | null;
}

const DECK_COLS =
  "id, tenant_id, company_id, user_id, title, instruction, style_guide, quality, status, error_code, pptx_attachment_id, created_at, updated_at";
const ITEM_COLS =
  "id, deck_id, position, title, summary, image_prompt, notes, status, attachment_id, error_code";

/** デッキと構成案をまとめて作る。構成案づくりが通ったときだけ呼ぶ。 */
export async function createDeckWithPlan(params: {
  tenantId: string;
  companyId: string;
  userId: string;
  instruction: string;
  quality: SlideQuality;
  plan: SlidePlan;
  /** 添付(デザインガイド・議事録)。デッキに紐づけて以後の生成でも使う。 */
  attachmentIds: string[];
}): Promise<LabSlideDeckRow | null> {
  const db = labDb();
  const { data } = await db
    .from("ai_lab_slide_decks")
    .insert({
      tenant_id: params.tenantId,
      company_id: params.companyId,
      user_id: params.userId,
      title: params.plan.title,
      instruction: params.instruction,
      style_guide: params.plan.styleGuide || null,
      quality: params.quality,
      status: "draft",
    })
    .select(DECK_COLS)
    .single();

  const deck = (data as LabSlideDeckRow | null) ?? null;
  if (!deck) return null;

  const rows = params.plan.slides.map((s, i) => ({
    tenant_id: params.tenantId,
    deck_id: deck.id,
    position: i + 1,
    title: s.title,
    summary: s.summary || null,
    image_prompt: s.imagePrompt,
    notes: s.notes || null,
  }));
  const { error } = await db.from("ai_lab_slide_items").insert(rows);
  if (error) {
    // 構成案が入らなかったデッキを残すと、空の履歴が並ぶだけなので畳む。
    await db.from("ai_lab_slide_decks").delete().eq("id", deck.id);
    return null;
  }

  if (params.attachmentIds.length > 0) {
    await db.from("ai_lab_attachments").update({ deck_id: deck.id }).in("id", params.attachmentIds);
  }
  return deck;
}

export async function getDeck(userId: string, deckId: string): Promise<LabSlideDeckRow | null> {
  const { data } = await labDb()
    .from("ai_lab_slide_decks")
    .select(DECK_COLS)
    .eq("id", deckId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as LabSlideDeckRow | null) ?? null;
}

export async function listDecks(userId: string, limit = 30): Promise<LabSlideDeckRow[]> {
  const { data } = await labDb()
    .from("ai_lab_slide_decks")
    .select(DECK_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as LabSlideDeckRow[] | null) ?? [];
}

export async function listSlideItems(deckId: string): Promise<LabSlideItemRow[]> {
  const { data } = await labDb()
    .from("ai_lab_slide_items")
    .select(ITEM_COLS)
    .eq("deck_id", deckId)
    .order("position", { ascending: true });
  return (data as LabSlideItemRow[] | null) ?? [];
}

export async function getSlideItem(deckId: string, position: number): Promise<LabSlideItemRow | null> {
  const { data } = await labDb()
    .from("ai_lab_slide_items")
    .select(ITEM_COLS)
    .eq("deck_id", deckId)
    .eq("position", position)
    .maybeSingle();
  return (data as LabSlideItemRow | null) ?? null;
}

/** デッキに紐づく添付(受講者が渡したデザインガイド・議事録)。 */
export async function listDeckAttachments(deckId: string): Promise<LabAttachmentRow[]> {
  const { data } = await labDb()
    .from("ai_lab_attachments")
    .select(ATTACHMENT_COLS)
    .eq("deck_id", deckId)
    .eq("origin", "upload")
    .order("created_at", { ascending: true });
  return (data as LabAttachmentRow[] | null) ?? [];
}

/** このデッキの生成物(スライド画像と統合済みpptx)をID引きできる形で返す。 */
export async function listDeckGenerated(deckId: string): Promise<Map<string, LabAttachmentRow>> {
  const { data } = await labDb()
    .from("ai_lab_attachments")
    .select(ATTACHMENT_COLS)
    .eq("deck_id", deckId)
    .eq("origin", "generated");
  const out = new Map<string, LabAttachmentRow>();
  for (const row of (data as LabAttachmentRow[] | null) ?? []) out.set(row.id, row);
  return out;
}

export async function updateDeck(
  deckId: string,
  patch: Partial<Pick<LabSlideDeckRow, "title" | "status" | "error_code" | "style_guide" | "pptx_attachment_id">>,
): Promise<void> {
  await labDb()
    .from("ai_lab_slide_decks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", deckId);
}

export async function updateSlideItem(
  itemId: string,
  patch: Partial<Pick<LabSlideItemRow, "title" | "summary" | "image_prompt" | "notes" | "status" | "attachment_id" | "error_code">>,
): Promise<void> {
  await labDb()
    .from("ai_lab_slide_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", itemId);
}

export async function deleteDeck(userId: string, deckId: string): Promise<void> {
  await labDb().from("ai_lab_slide_decks").delete().eq("id", deckId).eq("user_id", userId);
}

/** スライド画像を保存して添付行を作る。既存の画像があれば差し替える(作り直し)。 */
export async function saveSlideImage(params: {
  deck: LabSlideDeckRow;
  item: LabSlideItemRow;
  data: Buffer;
  mime: string;
}): Promise<LabAttachmentRow | null> {
  const db = labDb();
  const ext = params.mime === "image/jpeg" ? "jpg" : "png";
  const path = `${params.deck.company_id}/slides/${params.deck.id}/${params.item.position}-${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage
    .from(OUTPUT_BUCKET)
    .upload(path, params.data, { contentType: params.mime, upsert: false });
  if (error) return null;

  const row = await createAttachment({
    tenantId: params.deck.tenant_id,
    companyId: params.deck.company_id,
    userId: params.deck.user_id,
    origin: "generated",
    kind: "image",
    fileName: `${String(params.item.position).padStart(2, "0")}_${params.item.title || "slide"}.${ext}`,
    mime: params.mime,
    sizeBytes: params.data.length,
    storagePath: path,
    deckId: params.deck.id,
  });
  if (!row) return null;

  // 作り直しのときは古い画像行を残さない(pptx統合で拾ってしまうため)。
  if (params.item.attachment_id) {
    await db.from("ai_lab_attachments").delete().eq("id", params.item.attachment_id);
  }
  return row;
}

/** 統合した pptx を保存して添付行を作る。 */
export async function saveDeckPptx(params: {
  deck: LabSlideDeckRow;
  fileName: string;
  data: Buffer;
}): Promise<LabAttachmentRow | null> {
  const db = labDb();
  const safe = params.fileName.replace(/[^\w.\-ぁ-んァ-ヶ一-龠ー]/g, "_");
  const path = `${params.deck.company_id}/slides/${params.deck.id}/${crypto.randomUUID()}-${safe}`;
  const { error } = await db.storage
    .from(OUTPUT_BUCKET)
    .upload(path, params.data, { contentType: PPTX_MIME, upsert: false });
  if (error) return null;

  // 作り直しのたびに古い pptx が積み上がらないようにする。
  if (params.deck.pptx_attachment_id) {
    await db.from("ai_lab_attachments").delete().eq("id", params.deck.pptx_attachment_id);
  }
  return createAttachment({
    tenantId: params.deck.tenant_id,
    companyId: params.deck.company_id,
    userId: params.deck.user_id,
    origin: "generated",
    kind: "output",
    fileName: params.fileName,
    mime: PPTX_MIME,
    sizeBytes: params.data.length,
    storagePath: path,
    deckId: params.deck.id,
  });
}
