import { NextResponse } from "next/server";
import { verifyChatRequest } from "@/lib/chat/verify";
import { handleChatInteraction } from "@/lib/chat/interactions";
import { textMessage } from "@/lib/chat/cards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // crypto(JWT検証) を使うため

/**
 * P2: Google Chat の Bot インタラクションイベント受信（HTTP endpoint 経路）。
 * @メンション / DM のメッセージ、スペース参加/退出を処理する。
 * ※ 配信経路が Cloud Pub/Sub の場合は /api/chat/pubsub 側で同じ処理を非同期実行する。
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

  try {
    const reply = await handleChatInteraction(event);
    return NextResponse.json(reply ?? {});
  } catch (e) {
    return NextResponse.json(
      textMessage(`処理中にエラーが発生しました: ${(e as Error).message}`),
    );
  }
}
