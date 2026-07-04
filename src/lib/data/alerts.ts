/** 営業アラート(要件書8章)の取得。RPC sales_alerts を呼ぶ。 */
import { getSupabaseServer } from "@/lib/supabase/server";

export type AlertSeverity = "high" | "mid" | "low";

export interface SalesAlert {
  kind: string;
  severity: AlertSeverity;
  account_id: string | null;
  account_name: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  owner_user_id: string | null;
  due_date: string | null;
}

export const ALERT_LABEL: Record<string, string> = {
  ac_overdue: "次回AC期限超過",
  ac_missing: "次回AC未設定",
  proposal_followup_7d: "提案後フォロー期限超過",
  budget_unknown_b: "B以上で予算未確認",
  no_proposal_a: "A以上で提案書なし",
  lost_no_reason: "失注理由未入力",
  no_reapproach: "再アプローチ日未設定",
  s_account_stale: "S顧客 未接触(30日+)",
  a_account_stale: "A顧客 未接触(60日+)",
};

/** アラートの遷移先（現状は一覧へ。将来は絞込URLへ）。 */
export const ALERT_LINK: Record<string, string> = {
  ac_overdue: "/app/opportunities",
  ac_missing: "/app/opportunities",
  proposal_followup_7d: "/app/tasks",
  budget_unknown_b: "/app/opportunities",
  no_proposal_a: "/app/opportunities",
  lost_no_reason: "/app/opportunities",
  no_reapproach: "/app/opportunities",
  s_account_stale: "/app/accounts",
  a_account_stale: "/app/accounts",
};

export async function getSalesAlerts(): Promise<SalesAlert[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("sales_alerts");
  return (data ?? []) as SalesAlert[];
}

export interface AlertSummaryRow {
  kind: string;
  label: string;
  count: number;
  severity: AlertSeverity;
  link: string;
}

/** 種別ごとに件数を集計（重要度順）。owner指定時は自分担当のみ。 */
export function summarizeAlerts(alerts: SalesAlert[], ownerId?: string): AlertSummaryRow[] {
  const scoped = ownerId ? alerts.filter((a) => a.owner_user_id === ownerId) : alerts;
  const byKind = new Map<string, { count: number; severity: AlertSeverity }>();
  for (const a of scoped) {
    const cur = byKind.get(a.kind);
    if (cur) cur.count += 1;
    else byKind.set(a.kind, { count: 1, severity: a.severity });
  }
  const rank: Record<AlertSeverity, number> = { high: 0, mid: 1, low: 2 };
  return Array.from(byKind.entries())
    .map(([kind, v]) => ({ kind, label: ALERT_LABEL[kind] ?? kind, count: v.count, severity: v.severity, link: ALERT_LINK[kind] ?? "/app/opportunities" }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}
