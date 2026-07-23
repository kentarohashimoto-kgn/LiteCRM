import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAndUpsertSender, type ChatSender } from "./identities";
import { executeChatCommand } from "./commands";
import { cardMessage, textMessage } from "./cards";
import type { ChatMessagePayload } from "./client";

/**
 * P2: Chat インタラクションイベント（MESSAGE / ADDED_TO_SPACE / REMOVED_FROM_SPACE）の共通処理。
 * 配信経路が2系統あるため、処理本体をここに集約する:
 *   - HTTP エンドポイント（/api/chat/events）… 同期応答（200 body に Message）
 *   - Cloud Pub/Sub（/api/chat/pubsub）……………… 非同期応答（Chat API で投稿）
 * 返り値は「返信すべき Message」。null は返信不要。
 */

export function isChatInteractionEvent(type: unknown): type is string {
  return type === "MESSAGE" || type === "ADDED_TO_SPACE" || type === "REMOVED_FROM_SPACE";
}

export async function handleChatInteraction(event: any): Promise<ChatMessagePayload | null> {
  const type = event?.type as string | undefined;
  const admin = getSupabaseAdmin();

  if (type === "ADDED_TO_SPACE") {
    const adder = await resolveAndUpsertSender(event.user as ChatSender);
    const space = event.space ?? {};
    const spaceName = space.name as string | undefined;
    if (adder && spaceName) {
      // Bot が居るスペースとして記録（entity 紐付けは後から管理者が設定）。
      await admin.from("chat_space_bindings").upsert(
        {
          tenant_id: adder.tenantId,
          space_name: spaceName,
          space_type: space.type === "DM" ? "dm" : "group",
          label: (space.displayName as string | undefined) ?? null,
          is_active: true,
        },
        { onConflict: "tenant_id,space_name" },
      );
    }
    return cardMessage({
      title: "CATORCE CRM を追加しました",
      lines: [
        "このスペースでメンションすると操作できます。",
        "例）<b>@CATORCE CRM 商談 近代美術</b> / <b>@CATORCE CRM 今日</b>",
      ],
    });
  }

  if (type === "REMOVED_FROM_SPACE") {
    const spaceName = event.space?.name as string | undefined;
    if (spaceName) {
      await admin
        .from("chat_space_bindings")
        .update({ is_active: false })
        .eq("space_name", spaceName);
    }
    return null;
  }

  if (type === "MESSAGE") {
    const msg = event.message ?? {};
    const senderRaw = (msg.sender ?? event.user ?? {}) as ChatSender;
    const sender = await resolveAndUpsertSender(senderRaw);
    if (!sender) {
      return textMessage(
        "あなたのアカウントが CRM ユーザーと紐付いていません。管理者に連絡してください。",
      );
    }
    const argumentText = (msg.argumentText ?? msg.text ?? "") as string;
    return executeChatCommand(argumentText, sender);
  }

  return null;
}
