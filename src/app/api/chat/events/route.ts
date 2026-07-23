import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyChatRequest } from "@/lib/chat/verify";
import { resolveAndUpsertSender, type ChatSender } from "@/lib/chat/identities";
import { executeChatCommand } from "@/lib/chat/commands";
import { cardMessage, textMessage } from "@/lib/chat/cards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // crypto(JWT検証) を使うため

/** 【一時診断】署名検証せずに JWT の iss/aud/kid を覗く（原因切り分け用）。 */
function peekTokenClaims(authHeader: string | null): Record<string, unknown> {
  try {
    if (!authHeader?.startsWith("Bearer ")) return { note: "no-bearer" };
    const [h, p] = authHeader.slice(7).trim().split(".");
    const dec = (s: string) =>
      JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const header = dec(h);
    const claims = dec(p);
    return { iss: claims.iss, aud: claims.aud, kid: header.kid, alg: header.alg };
  } catch (e) {
    return { note: "decode-failed", err: (e as Error).message };
  }
}

/**
 * P2: Google Chat の Bot インタラクションイベント受信（HTTP endpoint）。
 * @メンション / DM のメッセージ、スペース参加/退出を処理する。
 *
 * 認証: Google 署名の Bearer JWT を検証（GOOGLE_CHAT_PROJECT_NUMBER 必須）。
 * 返信: 200 応答の body に Message(カード) を載せると同期返信になる。
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const verify = await verifyChatRequest(authHeader);

  // 【一時診断】受信のたびに検証結果と生クレームを記録（後で除去）。
  try {
    await getSupabaseAdmin()
      .from("chat_event_log")
      .insert({
        event_id: crypto.randomUUID(),
        event_type: "debug_inbound",
        space_name: null,
        payload: { ok: verify.ok, reason: verify.reason ?? null, ...peekTokenClaims(authHeader) },
      });
  } catch {
    /* 診断失敗は無視 */
  }

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
