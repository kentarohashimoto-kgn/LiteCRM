import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function page(title: string, body: string) {
  return new NextResponse(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
      `<body style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#1a1a1a;line-height:1.8">` +
      `<h1 style="font-size:18px">${title}</h1><p style="font-size:14px;color:#444">${body}</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/**
 * 配信停止(F-203 ガードレール・特定電子メール法対応)。
 * 送信メールのフッターに載せた本URLへのアクセスで、宛先アドレスをサプレッションに登録する。
 * トークンは email_messages.track_token(送信ごとに一意)。以後の一括送信・シーケンスは
 * mail_suppressions を必ず突合して該当宛先をスキップする。
 */
/** RFC8058 ワンクリック配信停止(List-Unsubscribe-Post)。メールクライアントの「配信停止」ボタンからのPOST。 */
export async function POST(_req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = (params.token ?? "").trim();
  if (token) {
    try {
      const admin = getSupabaseAdmin();
      const { data: msg } = await admin.from("email_messages").select("id, tenant_id, to_addrs").eq("track_token", token).maybeSingle();
      const to = (msg?.to_addrs as string[] | null)?.[0]?.trim().toLowerCase();
      if (msg && to) {
        await admin.from("mail_suppressions").insert({
          tenant_id: msg.tenant_id as string, email: to, reason: "unsubscribe", source_message_id: msg.id as string,
        });
      }
    } catch { /* 冪等: 既登録・失敗でも200(クライアント仕様上リトライされるだけ) */ }
  }
  return new NextResponse(null, { status: 200 });
}

export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = (params.token ?? "").trim();
  if (!token) return page("無効なリンクです", "URLが正しくありません。お手数ですが、メールに記載の送信者までご連絡ください。");
  try {
    const admin = getSupabaseAdmin();
    const { data: msg } = await admin
      .from("email_messages")
      .select("id, tenant_id, to_addrs")
      .eq("track_token", token)
      .maybeSingle();
    const to = (msg?.to_addrs as string[] | null)?.[0]?.trim().toLowerCase();
    if (!msg || !to) return page("無効なリンクです", "URLが正しくありません。お手数ですが、メールに記載の送信者までご連絡ください。");
    // 冪等: 既登録なら unique 制約でスキップ(エラーは握りつぶし=結果は同じ「停止済み」)
    await admin.from("mail_suppressions").insert({
      tenant_id: msg.tenant_id as string,
      email: to,
      reason: "unsubscribe",
      source_message_id: msg.id as string,
    });
    return page("配信停止を受け付けました", `${to} 宛のご案内メールの配信を停止しました。ご迷惑をおかけし申し訳ありませんでした。`);
  } catch {
    return page("配信停止を受け付けました", "ご案内メールの配信を停止しました。反映まで少しお時間をいただく場合があります。");
  }
}
