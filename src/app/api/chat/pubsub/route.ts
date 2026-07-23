import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyPubsubPush } from "@/lib/chat/pubsub-verify";
import { handleReactionCreated } from "@/lib/chat/reactions";
import { handleChatInteraction, isChatInteractionEvent } from "@/lib/chat/interactions";
import { createMessage } from "@/lib/chat/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cloud Pub/Sub Push の受信。2種類のイベントを扱う:
 *   - P2: Chat アプリの接続設定を Cloud Pub/Sub にした場合のインタラクション
 *         イベント（MESSAGE / ADDED_TO_SPACE 等、payload に type を持つ）。
 *         同期応答ができないため、返信は Chat API で非同期投稿する。
 *   - P3: Workspace Events のリアクションイベント（payload に eventType を持つ）。
 * Push購読の OIDC を検証し、冪等性を確保して処理する。
 * Pub/Sub は at-least-once なので、成功時は必ず 200 を返して再送を止める。
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const verify = await verifyPubsubPush(authHeader);

  // 【一時診断】受信のたびに検証結果とトークン概要を記録（原因特定後に除去）。
  try {
    let peek: Record<string, unknown> = { note: "no-bearer" };
    if (authHeader?.startsWith("Bearer ")) {
      const [h, p] = authHeader.slice(7).trim().split(".");
      const dec = (s: string) =>
        JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      try {
        const header = dec(h);
        const claims = dec(p);
        peek = { iss: claims.iss, aud: claims.aud, email: claims.email, kid: header.kid };
      } catch {
        peek = { note: "decode-failed" };
      }
    }
    await getSupabaseAdmin().from("chat_event_log").insert({
      event_id: crypto.randomUUID(),
      event_type: "debug_pubsub_inbound",
      space_name: null,
      payload: { ok: verify.ok, reason: verify.reason ?? null, ...peek },
    });
  } catch {
    /* 診断失敗は無視 */
  }

  if (!verify.ok) {
    return NextResponse.json({ error: `unauthorized: ${verify.reason}` }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const pubsubMsg = body?.message;
  const messageId: string | undefined = pubsubMsg?.messageId;
  if (!pubsubMsg?.data || !messageId) {
    // 不正な形式でも 200 で握りつぶす（再送させない）。
    return NextResponse.json({ ok: true, skipped: "no data" });
  }

  let event: any;
  try {
    event = JSON.parse(Buffer.from(pubsubMsg.data, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true, skipped: "undecodable data" });
  }

  const eventType: string = event?.eventType ?? event?.type ?? "unknown";
  const admin = getSupabaseAdmin();

  // 冪等性: Pub/Sub messageId をキーに記録。重複なら即終了。
  const { error: dupErr } = await admin.from("chat_event_log").insert({
    event_id: messageId,
    event_type: eventType,
    space_name: (event?.space?.name as string | undefined) ?? null,
    payload: event,
  });
  if (dupErr) {
    // unique(event_id) 違反 = 既処理。
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // P2: インタラクションイベント（接続設定=Cloud Pub/Sub のとき）。
    if (isChatInteractionEvent(event?.type)) {
      const reply = await handleChatInteraction(event);
      const spaceName = event?.space?.name as string | undefined;
      if (reply && spaceName) {
        // 元メッセージのスレッドに返信（無ければ新規スレッドにフォールバック）。
        const threadName = event?.message?.thread?.name as string | undefined;
        const payload = threadName ? { ...reply, thread: { name: threadName } } : reply;
        await createMessage(spaceName, payload, {
          messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
        });
      }
      return NextResponse.json({ ok: true, interaction: event?.type, replied: !!reply });
    }

    // P3: リアクションイベント。
    if (eventType === "google.workspace.chat.reaction.v1.created") {
      const r = await handleReactionCreated(event);
      return NextResponse.json({ ok: true, ...r });
    }
    // 他イベント（reaction.deleted, message.created 等）は現状 no-op。
    return NextResponse.json({ ok: true, ignored: eventType });
  } catch (e) {
    // 処理失敗でも 200（再送で二重実行を避ける。詳細はログで追う）。
    return NextResponse.json({ ok: true, error: (e as Error).message });
  }
}
