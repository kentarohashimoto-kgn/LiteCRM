/** ダッシュボードの案件集計をサーバー(RPC dashboard_metrics)から取得。全案件フェッチを回避。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { OppView } from "@/lib/data/select";

export interface FcBucket { month_key: string; label: string; commit: number; bestcase: number; pipeline: number; weighted: number; }
export interface FiscalRow { month_key: string; revenue: number; deals: number; appts: number; wrevenue: number; }
export interface RepAgg { owner_user_id: string; name: string; weighted: number; }
export interface ProdAgg { product_id: string; name: string; open_amount: number; }
export interface MiniOpp {
  id: string; account_id: string | null; amount: number; probability: number; status: string; stage: string;
  forecast_category: string; next_action_date: string | null; last_activity_at: string | null;
  expected_close_date: string | null; owner_user_id: string | null; account_name: string; owner_name: string; owner_color: string | null;
}

export interface DashboardMetrics {
  forecast6: FcBucket[];
  fiscal12: FiscalRow[];
  reps: RepAgg[];
  products: ProdAgg[];
  no_next: MiniOpp[];
  stale: MiniOpp[];
  closing: MiniOpp[];
}

export async function getDashboardMetrics(fyStart: number): Promise<DashboardMetrics> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("dashboard_metrics", { p_fy_start: fyStart });
  const d = (data ?? {}) as Partial<DashboardMetrics>;
  return {
    forecast6: d.forecast6 ?? [],
    fiscal12: d.fiscal12 ?? [],
    reps: d.reps ?? [],
    products: d.products ?? [],
    no_next: d.no_next ?? [],
    stale: d.stale ?? [],
    closing: d.closing ?? [],
  };
}

/** RPCの軽量案件を OppMiniList 用の OppView 互換オブジェクトへ変換（必要フィールドのみ）。 */
export function miniToOppView(m: MiniOpp): OppView {
  return {
    id: m.id,
    account_id: m.account_id ?? "",
    owner_user_id: m.owner_user_id ?? "",
    amount: m.amount,
    probability: m.probability,
    status: m.status as OppView["status"],
    stage: m.stage as OppView["stage"],
    forecast_category: m.forecast_category as OppView["forecast_category"],
    next_action_date: m.next_action_date ?? undefined,
    last_activity_at: m.last_activity_at ?? undefined,
    expected_close_date: m.expected_close_date ?? undefined,
    account: { name: m.account_name } as OppView["account"],
    owner: { id: m.owner_user_id ?? "", name: m.owner_name, avatarColor: m.owner_color ?? "#008C8C" } as OppView["owner"],
    weighted: Math.round((m.amount * m.probability) / 100),
  } as OppView;
}
