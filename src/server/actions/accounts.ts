"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { AccountsPage, AccountPageFilter } from "@/lib/data/accounts-page";

/** 顧客一覧のページ取得(サーバーページング＋案件集計)。 */
export async function fetchAccountsPageAction(input: {
  filter: AccountPageFilter;
  sort: string;
  asc: boolean;
  offset: number;
  limit?: number;
}): Promise<AccountsPage> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("accounts_page", {
    p_filter: input.filter,
    p_sort: input.sort,
    p_asc: input.asc,
    p_limit: input.limit ?? 50,
    p_offset: input.offset,
  });
  const d = (data ?? {}) as Partial<AccountsPage>;
  return { rows: d.rows ?? [], total: d.total ?? 0 };
}

/** 顧客の rank/focus/担当営業 をその場更新(一覧の再取得なしでローカル反映するため値を返す)。 */
export async function setAccountFieldAction(input: {
  id: string;
  field: "rank" | "focus" | "owner_user_id";
  value: string | null;
}): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = { [input.field]: input.value || null };
  const { error } = await sb.from("accounts").update(patch).eq("id", input.id);
  return { ok: !error };
}
