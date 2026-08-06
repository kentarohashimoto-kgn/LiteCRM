/**
 * 顧客分析マトリクス(セグメント × ランク)のデータ取得。
 * 集計は RPC account_segment_matrix に寄せている(複数テーブルJOINのため。GUARDRAILS §3-2)。
 * 絞り込み条件も RPC に渡す。セル集計とセル明細で条件がずれないよう、
 * 条件の解釈は DB 側(account_matrix_base)に一本化している。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  DEFAULT_RANK_SETTINGS,
  MAX_ACCOUNTS_PER_CELL,
  type AccountMatrix,
  type MatrixCell,
  type MatrixFilter,
  type MatrixMatch,
  type MatrixSegment,
  type RankSettings,
} from "@/lib/account-matrix";

export async function getAccountMatrix(
  filter: MatrixFilter = {},
  maxPerCell = MAX_ACCOUNTS_PER_CELL
): Promise<AccountMatrix> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("account_segment_matrix", {
    p_max_per_cell: maxPerCell,
    p_filter: filter,
  });
  const raw = (data ?? {}) as Partial<AccountMatrix>;
  return {
    // 閾値行が無いテナントでも既定値で動く
    settings: { ...DEFAULT_RANK_SETTINGS, ...((raw.settings ?? {}) as Partial<RankSettings>) },
    segments: (raw.segments ?? []) as MatrixSegment[],
    cells: (raw.cells ?? []) as MatrixCell[],
    matches: (raw.matches ?? []) as MatrixMatch[],
  };
}
