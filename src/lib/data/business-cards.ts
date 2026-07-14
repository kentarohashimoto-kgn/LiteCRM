/**
 * 名刺情報の参照ヘルパー（RLSスコープ済みのサーバークライアントを使用）。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { BusinessCard } from "@/lib/types";

export interface BusinessCardListRow extends BusinessCard {
  accounts: { id: string; name: string } | null;
  contacts: { id: string; name: string } | null;
}

export interface CardListFilters {
  q: string;
  link: "all" | "linked" | "unlinked";
  page: number;
  pageSize: number;
}

const SELECT_COLS =
  "id, tenant_id, owner_user_id, company_name, department, title, full_name, email, postal_code, address, tel_company, tel_department, tel_direct, fax, mobile_phone, url, exchanged_on, eight_connected, rank, memo, tags, source, account_id, contact_id, match_type, matched_at, created_at, updated_at, accounts(id, name), contacts(id, name)";

/** 一覧＋検索＋ページング。検索は 会社名/氏名/部署/役職/メール/メモ の部分一致。 */
export async function queryBusinessCards(f: CardListFilters): Promise<{ rows: BusinessCardListRow[]; total: number }> {
  const sb = getSupabaseServer();
  let q = sb.from("business_cards").select(SELECT_COLS, { count: "exact" });
  const kw = f.q.trim();
  if (kw) {
    const esc = kw.replace(/[%_,()]/g, (m) => "\\" + m);
    q = q.or(
      `company_name.ilike.%${esc}%,full_name.ilike.%${esc}%,department.ilike.%${esc}%,title.ilike.%${esc}%,email.ilike.%${esc}%,memo.ilike.%${esc}%`,
    );
  }
  if (f.link === "linked") q = q.not("account_id", "is", null);
  if (f.link === "unlinked") q = q.is("account_id", null);
  const from = (f.page - 1) * f.pageSize;
  const { data, count, error } = await q
    .order("exchanged_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + f.pageSize - 1);
  if (error) throw new Error(`名刺一覧の取得に失敗しました: ${error.message}`);
  return { rows: (data ?? []) as unknown as BusinessCardListRow[], total: count ?? 0 };
}

/** 件数サマリ（全体/連携済み/未連携）。 */
export async function getCardStats(): Promise<{ total: number; linked: number; contactLinked: number }> {
  const sb = getSupabaseServer();
  const [totalR, linkedR, contactR] = await Promise.all([
    sb.from("business_cards").select("id", { count: "exact", head: true }),
    sb.from("business_cards").select("id", { count: "exact", head: true }).not("account_id", "is", null),
    sb.from("business_cards").select("id", { count: "exact", head: true }).not("contact_id", "is", null),
  ]);
  return { total: totalR.count ?? 0, linked: linkedR.count ?? 0, contactLinked: contactR.count ?? 0 };
}

/** 顧客詳細ページ用: この顧客に連携された名刺。 */
export async function getCardsByAccount(accountId: string): Promise<BusinessCard[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("business_cards")
    .select("id, owner_user_id, company_name, department, title, full_name, email, mobile_phone, exchanged_on, rank, memo, tags, match_type, contact_id")
    .eq("account_id", accountId)
    .order("exchanged_on", { ascending: false, nullsFirst: false })
    .limit(50);
  return (data ?? []) as unknown as BusinessCard[];
}
