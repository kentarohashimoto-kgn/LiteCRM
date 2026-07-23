import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyPubsubPush } from "@/lib/chat/pubsub-verify";
import { handleReactionCreated } from "@/lib/chat/reactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * P3: Cloud Pub/Sub Push の受信（Workspace Events → リアクション等）。
 * Push購読の OIDC を検証し、冪等性を確保して処理する。
 * Pub/Sub は at-least-once なので、成功時は必ず 200 を返して再送を止める。
 */
export async function POST(req: Request) {
  const verify = await verifyPubsubPush(req.headers.get("authorization"));
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

  const eventType: string = event?.eventType ?? "unknown";
  const admin = getSupabaseAdmin();

  // 冪等性: Pub/Sub messageId をキーに記録。重複なら即終了。
  const { error: dupErr } = await admin.from("chat_event_log").insert({
    event_id: messageId,
    event_type: eventType,
    space_name: null,
    payload: event,
  });
  if (dupErr) {
    // unique(event_id) 違反 = 既処理。
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
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
