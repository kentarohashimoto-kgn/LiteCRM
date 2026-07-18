import { getSupabaseServer } from "@/lib/supabase/server";

/** 監査イベントの参照（RLSで owner/admin かつ自テナントのみ可視）。 */
export interface AuditFilters {
  action?: string;
  userId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD（当日を含む）
  page: number;
  pageSize: number;
}

export interface AuditRow {
  id: number;
  user_id: string | null;
  actor_email: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

/** アクションの表示ラベル。 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: "ログイン",
  "leads.export_csv": "リードCSV書き出し",
  "leads.import": "リード取込",
  "leads.merge": "リード名寄せ",
  "accounts.merge": "顧客名寄せ",
  "cards.import": "名刺取込",
  "cards.match": "名刺CRMマッチング",
  // メール連携(F-101)の機微操作
  "mail.account.connect": "メール送信アカウント接続(SMTP)",
  "mail.account.google_connect": "メール送信アカウント接続(Google)",
  "mail.account.disconnect": "メール送信アカウント解除",
  "mail.send": "メール送信",
  // ワークフロー自動化(F-102)
  "automation.rule.create": "自動化ルール作成",
  "automation.rule.toggle": "自動化ルール 有効/停止",
  "automation.rule.delete": "自動化ルール削除",
  // メールシーケンス(F-101b)
  "sequence.create": "シーケンス作成/更新",
  "sequence.enroll": "シーケンス投入",
  "sequence.stop": "シーケンス停止",
};

export function auditActionLabel(a: string): string {
  return AUDIT_ACTION_LABELS[a] ?? a;
}

function applyFilters<T>(q: T, f: AuditFilters): T {
  // supabase-js のクエリビルダに順次条件を適用
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let qq = q as any;
  if (f.action) qq = qq.eq("action", f.action);
  if (f.userId) qq = qq.eq("user_id", f.userId);
  if (f.from) qq = qq.gte("created_at", `${f.from}T00:00:00+09:00`);
  if (f.to) qq = qq.lte("created_at", `${f.to}T23:59:59+09:00`);
  return qq as T;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function queryAuditEvents(f: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  const sb = getSupabaseServer();
  const base = sb.from("audit_events").select("id,user_id,actor_email,action,target,meta,ip,created_at", { count: "exact" });
  const q = applyFilters(base, f);
  const from = (f.page - 1) * f.pageSize;
  const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, from + f.pageSize - 1);
  if (error) throw new Error(`監査ログの取得に失敗しました: ${error.message}`);
  return { rows: (data ?? []) as unknown as AuditRow[], total: count ?? 0 };
}

/** CSV抽出用（フィルタ適用・上限つき）。 */
export async function queryAuditEventsForExport(f: Omit<AuditFilters, "page" | "pageSize">, limit = 5000): Promise<AuditRow[]> {
  const sb = getSupabaseServer();
  const base = sb.from("audit_events").select("id,user_id,actor_email,action,target,meta,ip,created_at");
  const q = applyFilters(base, { ...f, page: 1, pageSize: limit });
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`監査ログの抽出に失敗しました: ${error.message}`);
  return (data ?? []) as unknown as AuditRow[];
}
