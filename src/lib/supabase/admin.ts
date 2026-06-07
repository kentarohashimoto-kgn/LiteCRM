import { createClient } from "@supabase/supabase-js";

/**
 * サービスロール(管理者)用クライアント。RLSをバイパスする。
 * メンバー(社員アカウント)発行など、管理操作のみで使用する。
 * 必ずサーバー側でのみ利用すること(SUPABASE_SERVICE_ROLE_KEY は秘匿)。
 */
export function getSupabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY が未設定です。メンバー発行には service role key が必要です。",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
