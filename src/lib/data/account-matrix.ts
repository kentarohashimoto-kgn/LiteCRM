/**
 * 顧客分析マトリクス(セグメント × ランク)のデータ取得。
 * 集計は RPC account_segment_matrix に寄せている(複数テーブルJOINのため。GUARDRAILS §3-2)。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  DEFAULT_RANK_SETTINGS,
  MAX_ACCOUNTS_PER_CELL,
  type AccountMatrix,
  type MatrixCell,
  type MatrixSegment,
  type RankSettings,
} from "@/lib/account-matrix";

export async function getAccountMatrix(maxPerCell = MAX_ACCOUNTS_PER_CELL): Promise<AccountMatrix> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("account_segment_matrix", { p_max_per_cell: maxPerCell });
  const raw = (data ?? {}) as Partial<AccountMatrix>;
  return {
    // 閾値行が無いテナントでも既定値で動く
    settings: { ...DEFAULT_RANK_SETTINGS, ...((raw.settings ?? {}) as Partial<RankSettings>) },
    segments: (raw.segments ?? []) as MatrixSegment[],
    cells: (raw.cells ?? []) as MatrixCell[],
  };
}
