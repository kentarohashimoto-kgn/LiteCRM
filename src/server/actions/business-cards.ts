"use server";

/**
 * 名刺情報のServer Actions: Eight CSV取込・CRMマッチング・手動連携。
 */
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { cardDedupKey, type BusinessCardInput } from "@/lib/card-import";

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
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("match_business_cards");
  if (error) return { ok: false, email: 0, companyContact: 0, company: 0, error: `マッチングに失敗しました: ${error.message}` };
  const d = (data ?? {}) as { email?: number; company_contact?: number; company?: number };
  revalidatePath(LIST_PATH);
  return { ok: true, email: d.email ?? 0, companyContact: d.company_contact ?? 0, company: d.company ?? 0 };
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
