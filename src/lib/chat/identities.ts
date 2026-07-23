import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Chat イベントの送信者情報（イベントペイロードの user / message.sender）。 */
export interface ChatSender {
  name?: string; // "users/1234567890"
  email?: string;
  displayName?: string;
}

export interface ResolvedSender {
  chatUserId: string;
  tenantId: string;
  userId: string; // CRM(auth.users)側 ID
  displayName?: string;
}

/**
 * 送信者を CRM ユーザーに解決し、chat_identities を自動登録/更新する。
 * メール一致で profiles → memberships(active/非デモ) を引く。
 * マッピングできなければ null（＝未登録ユーザー）。
 */
export async function resolveAndUpsertSender(sender: ChatSender): Promise<ResolvedSender | null> {
  const chatUserId = sender.name;
  if (!chatUserId) return null;
  const admin = getSupabaseAdmin();

  // 1) 既存の identity があればそれを優先（メール未提供の再訪でも解決できる）。
  const { data: existing } = await admin
    .from("chat_identities")
    .select("tenant_id, user_id")
    .eq("chat_user_id", chatUserId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      chatUserId,
      tenantId: existing.tenant_id as string,
      userId: existing.user_id as string,
      displayName: sender.displayName,
    };
  }

  // 2) メールで CRM ユーザーを特定 → 非デモテナントの membership を確認して登録。
  if (!sender.email) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email")
    .eq("email", sender.email)
    .limit(1)
    .maybeSingle();
  if (!profile) return null;

  const { data: membership } = await admin
    .from("memberships")
    .select("tenant_id, tenants!inner(is_demo)")
    .eq("user_id", profile.id as string)
    .eq("status", "active")
    .eq("tenants.is_demo", false)
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const tenantId = membership.tenant_id as string;
  const userId = profile.id as string;

  // upsert（tenant_id+user_id ユニーク）。chat_user_id を紐付け。
  await admin
    .from("chat_identities")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        chat_user_id: chatUserId,
        email: sender.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id" },
    );

  return { chatUserId, tenantId, userId, displayName: sender.displayName };
}
