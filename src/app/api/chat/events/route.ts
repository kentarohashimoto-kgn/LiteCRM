import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyChatRequest } from "@/lib/chat/verify";
import { resolveAndUpsertSender, type ChatSender } from "@/lib/chat/identities";
import { executeChatCommand } from "@/lib/chat/commands";
import { cardMessage, textMessage } from "@/lib/chat/cards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // crypto(JWT検証) を使うため

/**
 * P2: Google Chat の Bot インタラクションイベント受信（HTTP endpoint）。
 * @メンション / DM のメッセージ、スペース参加/退出を処理する。
 *
 * 認証: Google 署名の Bearer JWT を検証（GOOGLE_CHAT_PROJECT_NUMBER 必須）。
 * 返信: 200 応答の body に Message(カード) を載せると同期返信になる。
 */
export async function POST(req: Request) {
  const verify = await verifyChatRequest(req.headers.get("authorization"));
  if (!verify.ok) {
    return NextResponse.json({ error: `unauthorized: ${verify.reason}` }, { status: 401 });
  }

  let event: any;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const type = event?.type as string | undefined;
  const admin = getSupabaseAdmin();

  try {
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
      return NextResponse.json(
        cardMessage({
          title: "CATORCE CRM を追加しました",
          lines: [
            "このスペースでメンションすると操作できます。",
            "例）<b>@CATORCE CRM 商談 近代美術</b> / <b>@CATORCE CRM 今日</b>",
          ],
        }),
      );
    }

    if (type === "REMOVED_FROM_SPACE") {
      const spaceName = event.space?.name as string | undefined;
      if (spaceName) {
        await admin
          .from("chat_space_bindings")
          .update({ is_active: false })
          .eq("space_name", spaceName);
      }
      return NextResponse.json({});
    }

    if (type === "MESSAGE") {
      const msg = event.message ?? {};
      const senderRaw = (msg.sender ?? event.user ?? {}) as ChatSender;
      const sender = await resolveAndUpsertSender(senderRaw);
      if (!sender) {
        return NextResponse.json(
          textMessage(
            "あなたのアカウントが CRM ユーザーと紐付いていません。管理者に連絡してください。",
          ),
        );
      }
      const argumentText = (msg.argumentText ?? msg.text ?? "") as string;
      const reply = await executeChatCommand(argumentText, sender);
      return NextResponse.json(reply);
    }

    // その他イベント（CARD_CLICKED 等）は現状 no-op。
    return NextResponse.json({});
  } catch (e) {
    return NextResponse.json(
      textMessage(`処理中にエラーが発生しました: ${(e as Error).message}`),
    );
  }
}
