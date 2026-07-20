import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * D-1 Webフォーム→リード自動生成(公開エンドポイント)。
 * HPの問い合わせ/資料請求フォームから直接リードを作成する。
 *
 * 認可: ヘッダー `x-intake-token` (または body の `token`) が LEAD_INTAKE_SECRET と一致すること。
 * スパム対策: ハニーポット欄 `website`(人間には見えない入力欄)が埋まっていたら成功を装って破棄。
 *
 * 受け付けるフィールド(JSON または form-encoded):
 *   company(必須) / name / email / phone / message / event(獲得イベント名。既定 "Webフォーム")
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.LEAD_INTAKE_ALLOW_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-intake-token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const secret = process.env.LEAD_INTAKE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "intake not configured" }, { status: 503, headers: CORS_HEADERS });
  }

  // JSON / form-encoded の両対応
  let body: Record<string, string> = {};
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      body = (await req.json()) as Record<string, string>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) body[k] = String(v);
    }
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: CORS_HEADERS });
  }

  const token = req.headers.get("x-intake-token") ?? body.token ?? "";
  if (token !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  // ハニーポット: botが埋めがちな隠し欄。埋まっていたら成功を装って捨てる
  if ((body.website ?? "").trim() !== "") {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  const company = (body.company ?? "").trim().slice(0, 200);
  const name = (body.name ?? "").trim().slice(0, 100);
  const email = (body.email ?? "").trim().slice(0, 200);
  const phone = (body.phone ?? "").trim().slice(0, 50);
  const message = (body.message ?? "").trim().slice(0, 2000);
  const rawEvent = (body.event ?? "Webフォーム").trim().slice(0, 100);
  if (!company && !email) {
    return NextResponse.json({ ok: false, error: "company or email is required" }, { status: 400, headers: CORS_HEADERS });
  }

  const admin = getSupabaseAdmin();
  // 実テナントのみ。デモテナントに実リードが流入するのを防ぐ。
  const { data: tenant } = await admin.from("tenants").select("id").eq("is_demo", false).limit(1).maybeSingle();
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "no tenant" }, { status: 500, headers: CORS_HEADERS });
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      tenant_id: tenant.id as string,
      title: [company || "(会社名未入力)", name].filter(Boolean).join(" "),
      company_name: company || "(会社名未入力)",
      contact_name: name || null,
      email: email || null,
      phone: phone || null,
      notes: message || null,
      raw_event: rawEvent,
      acquired_at: new Date().toISOString().slice(0, 10),
      status: "new",
    })
    .select("id")
    .maybeSingle();
  if (error || !lead) {
    return NextResponse.json({ ok: false, error: "insert failed" }, { status: 500, headers: CORS_HEADERS });
  }

  // アプリ内通知(A-1): owner/admin へ新規リードを知らせる(失敗しても成功扱い)
  try {
    const { data: admins } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenant.id as string)
      .eq("status", "active")
      .in("role", ["owner", "admin", "sales_manager"]);
    if (admins && admins.length > 0) {
      await admin.from("notifications").insert(
        admins.map((a) => ({
          tenant_id: tenant.id as string,
          user_id: a.user_id as string,
          kind: "lead",
          title: `Webフォームから新しいリード（${rawEvent}）`,
          body: `${company || "(会社名未入力)"}${name ? `｜${name}` : ""}${message ? `\n${message.slice(0, 120)}` : ""}`,
          href: `/app/leads/${lead.id as string}`,
        })),
      );
    }
  } catch {
    /* 通知失敗は無視 */
  }

  // Slack通知(未設定なら送らない・失敗しても成功扱い)
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    try {
      const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app"}/app/leads/${lead.id as string}`;
      const text =
        `:inbox_tray: *Webフォームから新しいリード*（${rawEvent}）\n` +
        `<${url}|${company || "(会社名未入力)"}${name ? `｜${name}` : ""}>` +
        (message ? `\n> ${message.slice(0, 200)}` : "");
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch {
      /* 通知失敗は無視 */
    }
  }

  return NextResponse.json({ ok: true, id: lead.id }, { headers: CORS_HEADERS });
}
