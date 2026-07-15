"use server";

/**
 * 名刺情報のServer Actions: Eight CSV取込・CRMマッチング・手動連携。
 */
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { cardDedupKey, type BusinessCardInput } from "@/lib/card-import";
import { logAudit, clientIp } from "@/lib/audit-events";

const LIST_PATH = "/app/business-cards";

export interface ImportCardsResult {
  ok: boolean;
  inserted: number;
  skipped: number;
  error?: string;
}

/**
 * 名刺の取込（クライアントでパース済みの行をチャンクで受け取る）。
 * owner_user_id は名刺交換者（未指定なら取込実行者）。再取込は dedup_key で重複スキップ。
 */
export async function importBusinessCardsAction(rows: BusinessCardInput[], exchangerId?: string): Promise<ImportCardsResult> {
  const ctx = await requireCtx();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, inserted: 0, skipped: 0, error: "取込対象がありません" };
  if (rows.length > 500) return { ok: false, inserted: 0, skipped: 0, error: "1回の取込は500件までです（分割して送信してください）" };
  const sb = getSupabaseServer();

  // 名刺交換者(owner_user_id)。指定があり自テナントのメンバーなら採用、なければ取込者。
  let ownerId = ctx.userId;
  const wanted = (exchangerId ?? "").trim();
  if (wanted && wanted !== ctx.userId) {
    const { data: m } = await sb.from("memberships").select("user_id").eq("user_id", wanted).maybeSingle();
    if (m) ownerId = wanted;
  }

  const t = (v?: string) => {
    const s = (v ?? "").trim();
    return s === "" ? null : s.slice(0, 500);
  };
  const records = rows
    .filter((r) => (r.company_name ?? "").trim() !== "" || (r.full_name ?? "").trim() !== "")
    .map((r) => ({
      tenant_id: ctx.tenantId,
      owner_user_id: ownerId,
      company_name: (r.company_name ?? "").trim().slice(0, 300),
      department: t(r.department),
      title: t(r.title),
      full_name: (r.full_name ?? "").trim().slice(0, 200),
      last_name: t(r.last_name),
      first_name: t(r.first_name),
      email: t(r.email)?.toLowerCase() ?? null,
      postal_code: t(r.postal_code),
      address: t(r.address),
      tel_company: t(r.tel_company),
      tel_department: t(r.tel_department),
      tel_direct: t(r.tel_direct),
      fax: t(r.fax),
      mobile_phone: t(r.mobile_phone),
      url: t(r.url),
      exchanged_on: r.exchanged_on ?? null,
      eight_connected: !!r.eight_connected,
      rank: t(r.rank),
      memo: t(r.memo),
      tags: (r.tags ?? []).slice(0, 60),
      source: "eight",
      dedup_key: cardDedupKey(r),
      created_by: ctx.userId,
    }));
  const { data, error } = await sb
    .from("business_cards")
    .upsert(records, { onConflict: "tenant_id,owner_user_id,dedup_key", ignoreDuplicates: true })
    .select("id");
  if (error) return { ok: false, inserted: 0, skipped: 0, error: `取込に失敗しました: ${error.message}` };
  const inserted = data?.length ?? 0;
  revalidatePath(LIST_PATH);
  return { ok: true, inserted, skipped: records.length - inserted };
}

export interface MatchCardsResult {
  ok: boolean;
  email: number;
  companyContact: number;
  company: number;
  error?: string;
}

/** CRMマッチング実行（メール→会社+氏名→会社名の優先順で自動連携）。 */
export async function runCardMatchingAction(): Promise<MatchCardsResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("match_business_cards");
  if (error) return { ok: false, email: 0, companyContact: 0, company: 0, error: `マッチングに失敗しました: ${error.message}` };
  const d = (data ?? {}) as { email?: number; company_contact?: number; company?: number };
  await logAudit({
    tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
    action: "cards.match", meta: { email: d.email ?? 0, companyContact: d.company_contact ?? 0, company: d.company ?? 0 }, ip: clientIp(),
  });
  revalidatePath(LIST_PATH);
  return { ok: true, email: d.email ?? 0, companyContact: d.company_contact ?? 0, company: d.company ?? 0 };
}

/** 名刺取込の完了時に1回だけ監査記録（チャンク単位ではなく取込全体を1件で残すため）。 */
export async function logCardImportAudit(summary: { inserted: number; skipped: number; total: number }): Promise<void> {
  const ctx = await requireCtx();
  await logAudit({
    tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
    action: "cards.import", target: `新規${summary.inserted}/スキップ${summary.skipped}`,
    meta: { inserted: summary.inserted, skipped: summary.skipped, total: summary.total }, ip: clientIp(),
  });
}

/** 手動連携用の顧客検索（名前部分一致・上位10件）。 */
export async function searchAccountsForCardAction(q: string): Promise<{ id: string; name: string }[]> {
  await requireCtx();
  const kw = (q ?? "").trim();
  if (!kw) return [];
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("accounts")
    .select("id, name")
    .is("deleted_at", null)
    .ilike("name", `%${kw.replace(/[%_]/g, (m) => "\\" + m)}%`)
    .order("name")
    .limit(10);
  return (data ?? []) as { id: string; name: string }[];
}

/** 名刺を顧客へ手動連携（担当者一致があれば contact も連携）。 */
export async function linkCardToAccountAction(input: { cardId: string; accountId: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  // 同一顧客配下に氏名一致の担当者がいれば合わせて連携する
  const { data: card } = await sb.from("business_cards").select("full_name").eq("id", input.cardId).single();
  let contactId: string | null = null;
  if (card?.full_name) {
    const norm = (s: string) => s.replace(/[\s　]/g, "");
    const { data: contacts } = await sb.from("contacts").select("id, name").eq("account_id", input.accountId).limit(100);
    contactId = (contacts ?? []).find((c) => norm(c.name) === norm(card.full_name))?.id ?? null;
  }
  const { error } = await sb
    .from("business_cards")
    .update({ account_id: input.accountId, contact_id: contactId, match_type: "manual", matched_at: new Date().toISOString() })
    .eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** 連携解除。 */
export async function unlinkCardAction(input: { cardId: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("business_cards")
    .update({ account_id: null, contact_id: null, match_type: null, matched_at: null })
    .eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

// =====================================================================
// 編集・優先度/タグ・コメント（0132）
// =====================================================================

/** 編集可能なフィールド（スキャン誤り修正）。dedup_key は再取込時の重複防止のため変更しない。 */
export interface CardEditInput {
  company_name: string;
  department?: string;
  title?: string;
  full_name: string;
  email?: string;
  postal_code?: string;
  address?: string;
  tel_company?: string;
  tel_department?: string;
  tel_direct?: string;
  fax?: string;
  mobile_phone?: string;
  url?: string;
  exchanged_on?: string; // YYYY-MM-DD
  memo?: string;
}

/** 名刺の編集（変更履歴はDBの監査トリガーで自動記録）。 */
export async function updateBusinessCardAction(input: { cardId: string; fields: CardEditInput }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const f = input.fields;
  if (!(f.company_name ?? "").trim() && !(f.full_name ?? "").trim()) {
    return { ok: false, error: "会社名か氏名のどちらかは必須です" };
  }
  const t = (v?: string) => {
    const s = (v ?? "").trim();
    return s === "" ? null : s.slice(0, 500);
  };
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("business_cards")
    .update({
      company_name: (f.company_name ?? "").trim().slice(0, 300),
      department: t(f.department),
      title: t(f.title),
      full_name: (f.full_name ?? "").trim().slice(0, 200),
      email: t(f.email)?.toLowerCase() ?? null,
      postal_code: t(f.postal_code),
      address: t(f.address),
      tel_company: t(f.tel_company),
      tel_department: t(f.tel_department),
      tel_direct: t(f.tel_direct),
      fax: t(f.fax),
      mobile_phone: t(f.mobile_phone),
      url: t(f.url),
      exchanged_on: /^\d{4}-\d{2}-\d{2}$/.test(f.exchanged_on ?? "") ? f.exchanged_on : null,
      memo: t(f.memo) ? (f.memo ?? "").trim().slice(0, 2000) : null,
    })
    .eq("id", input.cardId);
  if (error) return { ok: false, error: `保存に失敗しました: ${error.message}` };
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${input.cardId}`);
  return { ok: true };
}

/** アクション優先度の設定（null=解除）。一覧・詳細のどちらからでも呼べる。 */
export async function setCardPriorityAction(input: { cardId: string; priority: "high" | "medium" | "low" | null }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  if (input.priority != null && !["high", "medium", "low"].includes(input.priority)) {
    return { ok: false, error: "不正な優先度です" };
  }
  const sb = getSupabaseServer();
  const { error } = await sb.from("business_cards").update({ priority: input.priority }).eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** 任意タグの更新（配列を丸ごと置き換え）。 */
export async function updateCardTagsAction(input: { cardId: string; tags: string[] }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  const sb = getSupabaseServer();
  const { error } = await sb.from("business_cards").update({ user_tags: tags }).eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** コメント投稿。 */
export async function addCardCommentAction(input: { cardId: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "コメントが空です" };
  const sb = getSupabaseServer();
  const { error } = await sb.from("business_card_comments").insert({
    tenant_id: ctx.tenantId,
    card_id: input.cardId,
    author_user_id: ctx.userId,
    body: body.slice(0, 2000),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${input.cardId}`);
  return { ok: true };
}

/** コメント削除（本人 or owner/admin。RLSでも担保）。 */
export async function deleteCardCommentAction(input: { commentId: string; cardId: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("business_card_comments").delete().eq("id", input.commentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${input.cardId}`);
  return { ok: true };
}
