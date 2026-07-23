import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findDirectMessage, setupDirectMessage } from "./client";

/**
 * 送信ターゲット → Google Chat Space 名の解決。
 * DM は chat_identities、エンティティ紐付けは chat_space_bindings を参照する。
 * インフラ的な参照/キャッシュ更新なので内部で service role クライアントを用い、
 * クエリ側で tenant_id を明示フィルタしてテナント越境を防ぐ。
 */

export type ChatTarget =
  | { type: "dm"; tenantId: string; userId: string }
  | { type: "space"; spaceName: string }
  | { type: "entity"; tenantId: string; entityType: "deal" | "account" | "team"; entityId: string };

/** DM Space を解決（キャッシュ→検索→作成）。不可なら null。 */
async function resolveDmSpace(tenantId: string, userId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data: ident } = await admin
    .from("chat_identities")
    .select("id, chat_user_id, dm_space_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!ident) return null;
  if (ident.dm_space_name) return ident.dm_space_name as string;

  const chatUserId = ident.chat_user_id as string | null;
  if (!chatUserId) return null; // Chatユーザー未マッピング → DMは送れない

  // 既存DMを検索、無ければ作成。
  const found = (await findDirectMessage(chatUserId)) ?? (await setupDirectMessage(chatUserId));
  const spaceName = found?.name ?? null;
  if (spaceName) {
    // 解決結果をキャッシュ（次回以降のAPI往復を省く）。
    await admin
      .from("chat_identities")
      .update({ dm_space_name: spaceName, updated_at: new Date().toISOString() })
      .eq("id", ident.id as string);
  }
  return spaceName;
}

/** エンティティに紐づく Space 群を解決。 */
async function resolveEntitySpaces(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<string[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("chat_space_bindings")
    .select("space_name")
    .eq("tenant_id", tenantId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("is_active", true);
  return (data ?? []).map((r) => r.space_name as string);
}

/** ChatTarget を宛先 Space 名の配列に解決。 */
export async function resolveTargetSpaces(target: ChatTarget): Promise<string[]> {
  switch (target.type) {
    case "space":
      return [target.spaceName];
    case "dm": {
      const s = await resolveDmSpace(target.tenantId, target.userId);
      return s ? [s] : [];
    }
    case "entity":
      return resolveEntitySpaces(target.tenantId, target.entityType, target.entityId);
  }
}
