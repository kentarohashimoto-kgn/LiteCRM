import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * 監査イベントの記録（適度な粒度）。
 * ログインと「重い処理」のみを記録する軽量ロガー。
 * - 書き込みは service role（RLSバイパス）で行い、ユーザーからの改ざんを防ぐ。
 * - 失敗しても本処理は止めない（try/catch）。SERVICE_ROLE_KEY 未設定時は静かにno-op。
 * - メタは小さく保つ（件数・条件など。ペイロード全文は入れない）。
 */
export interface AuditEntry {
  tenantId?: string | null;
  userId?: string | null;
  email?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** リクエストヘッダからクライアントIPを推定（取得できなければ null）。 */
export function clientIp(): string | null {
  try {
    const h = headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim().slice(0, 64);
    return h.get("x-real-ip")?.slice(0, 64) ?? null;
  } catch {
    return null;
  }
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_events").insert({
      tenant_id: entry.tenantId ?? null,
      user_id: entry.userId ?? null,
      actor_email: entry.email ?? null,
      action: entry.action.slice(0, 80),
      target: entry.target ? String(entry.target).slice(0, 300) : null,
      meta: entry.meta ?? {},
      ip: entry.ip ?? null,
    });
  } catch {
    // 監査ログの失敗は本処理に影響させない
  }
}
