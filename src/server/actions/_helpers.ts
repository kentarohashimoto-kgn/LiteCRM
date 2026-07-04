/**
 * Server Action 共通ヘルパー。
 * ※ これは "use server" ファイルではない（アクションから呼ばれる純サーバーユーティリティ）。
 */
import { getSupabaseServer } from "@/lib/supabase/server";

export type CasResult =
  | { ok: true; updated_at: string }
  | { ok: false; error: string; conflict?: boolean };

/**
 * 楽観ロック更新(compare-and-set)。読込時の updated_at と一致する行だけを更新する。
 * 0行更新 = 他者が先に更新した(競合)。成功時はトリガーで更新された新しい updated_at を返す。
 * 複数営業の同時編集で「後勝ちによる上書き消失」を防ぐ。
 */
export async function casUpdate(
  table: string,
  id: string,
  clientUpdatedAt: string | null | undefined,
  patch: Record<string, unknown>,
): Promise<CasResult> {
  const sb = getSupabaseServer();
  let q = sb.from(table).update(patch).eq("id", id);
  if (clientUpdatedAt) q = q.eq("updated_at", clientUpdatedAt);
  const { data, error } = await q.select("updated_at").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      conflict: true,
      error: "他のメンバーが先に更新した可能性があります。再読み込みしてください。",
    };
  }
  return { ok: true, updated_at: (data as { updated_at: string }).updated_at };
}
