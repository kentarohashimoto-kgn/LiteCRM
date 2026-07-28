"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isChatConfigured } from "@/lib/chat/client";
import { sendChatMessage, textMessage } from "@/lib/chat/send";

/**
 * Google Chat DM のテスト送信(通知トラブルシュート用)。
 * どの段階で止まっているか(資格情報/連携/DMスペース/送信)を段階別に返す。
 */
export interface ChatDmTestResult {
  ok: boolean;
  configured: boolean;        // GOOGLE_CHAT_SA_CREDENTIALS が設定されているか
  hasIdentity: boolean;       // chat_identities に自分の行があるか
  hasChatUserId: boolean;     // Chatユーザーへのマッピングが済んでいるか
  hasDmSpace: boolean;        // DMスペースが解決(キャッシュ)済みか
  sent: number;
  failed: number;
  skipped?: string;
  hint: string;
}

export async function sendTestChatDmAction(): Promise<ChatDmTestResult> {
  const ctx = await requireCtx();
  const configured = isChatConfigured();
  const admin = getSupabaseAdmin();
  const { data: ident } = await admin
    .from("chat_identities")
    .select("chat_user_id, dm_space_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const base: Omit<ChatDmTestResult, "sent" | "failed" | "skipped" | "ok" | "hint"> = {
    configured,
    hasIdentity: !!ident,
    hasChatUserId: !!ident?.chat_user_id,
    hasDmSpace: !!ident?.dm_space_name,
  };

  if (!configured) {
    return { ...base, ok: false, sent: 0, failed: 0, hint: "サーバーに GOOGLE_CHAT_SA_CREDENTIALS が未設定です(Vercelの環境変数を確認)。" };
  }
  if (!ident) {
    return { ...base, ok: false, sent: 0, failed: 0, hint: "Chat連携が未登録です。Google Chatで CATORCE のChatアプリに一度話しかけると自動登録されます。" };
  }
  if (!ident.chat_user_id) {
    return { ...base, ok: false, sent: 0, failed: 0, hint: "ChatユーザーIDが未取得です。Google ChatでCATORCEアプリにメッセージを送ると紐付きます。" };
  }

  const r = await sendChatMessage(
    { type: "dm", tenantId: ctx.tenantId, userId: ctx.userId },
    textMessage(`✅ CATORCE Sales OS からのテスト通知です（${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16)} JST）。\nホットリード通知はこのDMに届きます。`),
  );
  const hint = r.sent > 0
    ? "送信成功。届いていない場合は、Google Chat左メニューの「アプリ」欄にあるCATORCEアプリのDMスレッド(未読・ミュート含む)を確認してください。"
    : r.skipped
      ? `送信スキップ: ${r.skipped}`
      : "Chat APIへの送信が失敗しました。サービスアカウントの権限(chat.bot)とChatアプリの公開設定を確認してください。";
  return { ...base, ok: r.sent > 0, sent: r.sent, failed: r.failed, skipped: r.skipped, hint };
}
