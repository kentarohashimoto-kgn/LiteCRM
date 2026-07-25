/**
 * P1 tenant_storage_connections の取得ヘルパー(サーバー専用)。
 * 資格情報を含むためテーブルのRLSは owner/admin 限定。
 * 添付フロー・バッチでは service role で読み、復号済み接続を返す。
 */

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import type { StorageConnection } from "@/lib/storage/provider";

export interface ConnectionRow {
  id: string;
  tenant_id: string;
  provider: string;
  display_name: string;
  credentials: string | null;
  config: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

/** テナントのアクティブな接続(復号済み)。未接続・鍵未設定なら null。 */
export async function getActiveConnection(tenantId: string, provider: string): Promise<StorageConnection | null> {
  if (!mailCredSecretConfigured()) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tenant_storage_connections")
    .select("id, tenant_id, provider, display_name, credentials, config, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as ConnectionRow | null;
  if (!row?.credentials) return null;
  try {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      refreshToken: decryptSecret(row.credentials),
      config: row.config ?? {},
    };
  } catch {
    return null; // 鍵変更等で復号不能 → 再接続が必要
  }
}

/** 接続の存在のみ確認(資格情報を復号しない軽量版)。UI表示の出し分けに使用。 */
export async function hasActiveConnection(tenantId: string, provider: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { count } = await admin
    .from("tenant_storage_connections")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("status", "active");
  return (count ?? 0) > 0;
}
