import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSystemMail, diagnoseSystemMailer } from "@/lib/mail-system";
import { buildClientAutoReply, buildInternalNotify, type InquiryFields } from "@/lib/inquiry-emails";

export const dynamic = "force-dynamic";

/**
 * D-1 Webフォーム→リード自動生成(公開エンドポイント)。
 * HPの問い合わせ/資料請求フォームから直接リードを作成する。
 *
 * 認可: ヘッダー `x-intake-token` (または body の `token`) が LEAD_INTAKE_SECRET と一致すること。
 * スパム対策: ハニーポット欄 `website`(人間には見えない入力欄)が埋まっていたら成功を装って破棄。
 *
 * 受け付けるフィールド(JSON または form-encoded):
 *   company(必須) / name / email / phone / message
 *   source(流入元ラベル。既定 "HP問合せ"。旧 `event` も後方互換で受ける)
 *
 * 通知:
 *   - アプリ内通知(owner/admin/sales_manager)
 *   - Slack通知(SLACK_WEBHOOK_URL 設定時)
 *   - メール通知(SYSTEM_SMTP_* 設定時): 問い合わせ元クライアントへ自動返信 + 社内関係者へ通知
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.LEAD_INTAKE_ALLOW_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-intake-token",
};

// 既定の流入元ラベル。0159 のマイグレーションで lead_sources に事前投入済み。
const DEFAULT_SOURCE = "HP問合せ";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // 診断モード(トークン保護): メール送信設定の確認とSMTP接続テスト。リードは作成しない。
  if (body.diag) {
    const diag = await diagnoseSystemMailer();
    let send: { ok: boolean; error?: string } | undefined;
    const to = (body.email ?? "").trim();
    if (diag.configured && to) {
      const r = await sendSystemMail({
        to,
        subject: "【CATORCE】メール送信テスト",
        text: "これはメール送信設定の確認用テストです。届いていれば設定成功です。",
        html: "<p>これはメール送信設定の確認用テストです。届いていれば設定成功です。</p>",
      });
      send = r.ok ? { ok: true } : { ok: false, error: "error" in r ? r.error : "skipped" };
    }
    return NextResponse.json({ ok: true, diag, send }, { headers: CORS_HEADERS });
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
  // 流入詳細(種別/資料名)。`source` を優先し、旧 `event` は後方互換、いずれも無ければ "HP問合せ"。
  const source = (body.source ?? body.event ?? DEFAULT_SOURCE).trim().slice(0, 100) || DEFAULT_SOURCE;
  // 流入元メディア(どのサイト/媒体か。例: カトルセHP / キャリプラ / Aicafe)。任意。
  const media = (body.media ?? "").trim().slice(0, 100);
  // 集計用タグ(カンマ区切り→配列)。例: "資料請求,生成AI"
  const tagsRaw = (body.tags ?? "").trim();
  const tags = tagsRaw
    ? Array.from(new Set(tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 40)))).slice(0, 20)
    : [];
  if (!company && !email) {
    return NextResponse.json({ ok: false, error: "company or email is required" }, { status: 400, headers: CORS_HEADERS });
  }

  const admin = getSupabaseAdmin();
  // 実テナントのみ。デモテナントに実リードが流入するのを防ぐ。
  const { data: tenant } = await admin.from("tenants").select("id").eq("is_demo", false).limit(1).maybeSingle();
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "no tenant" }, { status: 500, headers: CORS_HEADERS });
  }
  const tenantId = tenant.id as string;

  // 流入元(lead_sources)を解決。無ければ作成(マイグレーション未適用でも動くように)。
  let leadSourceId: string | null = null;
  try {
    const { data: existing } = await admin
      .from("lead_sources")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", source)
      .maybeSingle();
    if (existing) {
      leadSourceId = existing.id as string;
    } else {
      const { data: created } = await admin
        .from("lead_sources")
        .insert({ tenant_id: tenantId, name: source, description: "HPの問い合わせフォームからの流入(/api/lead-intake)", status: "active" })
        .select("id")
        .maybeSingle();
      leadSourceId = (created?.id as string) ?? null;
    }
  } catch {
    /* 流入元の解決に失敗してもリード作成は続行(raw_event で識別可能) */
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      tenant_id: tenantId,
      lead_source_id: leadSourceId,
      title: [company || "(会社名未入力)", name].filter(Boolean).join(" "),
      company_name: company || "(会社名未入力)",
      contact_name: name || null,
      email: email || null,
      phone: phone || null,
      notes: message || null,
      raw_event: source,
      inquiry_media: media || null,
      inquiry_tags: tags.length ? tags : null,
      acquired_at: new Date().toISOString().slice(0, 10),
      status: "new",
    })
    .select("id")
    .maybeSingle();
  if (error || !lead) {
    return NextResponse.json({ ok: false, error: "insert failed" }, { status: 500, headers: CORS_HEADERS });
  }
  const leadId = lead.id as string;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app";
  const leadUrl = `${appUrl}/app/leads/${leadId}`;

  // アプリ内通知(A-1): owner/admin/sales_manager へ新規リードを知らせる(失敗しても成功扱い)
  try {
    const { data: admins } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "sales_manager"]);
    if (admins && admins.length > 0) {
      await admin.from("notifications").insert(
        admins.map((a) => ({
          tenant_id: tenantId,
          user_id: a.user_id as string,
          kind: "lead",
          title: `Webフォームから新しいリード（${source}）`,
          body: `${company || "(会社名未入力)"}${name ? `｜${name}` : ""}${message ? `\n${message.slice(0, 120)}` : ""}`,
          href: `/app/leads/${leadId}`,
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
      const text =
        `:inbox_tray: *Webフォームから新しいリード*（${source}）\n` +
        `<${leadUrl}|${company || "(会社名未入力)"}${name ? `｜${name}` : ""}>` +
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

  // メール通知(SYSTEM_SMTP_* 未設定なら sendSystemMail が skipped を返す・失敗しても成功扱い)
  const fields: InquiryFields = { company, name, email, phone, message, source, media: media || undefined };
  const orgName = process.env.INQUIRY_ORG_NAME ?? process.env.SYSTEM_MAIL_FROM_NAME ?? "株式会社カトルセ";
  try {
    // 1) 問い合わせ元クライアントへ自動返信(有効なメールが入力されている時のみ)
    if (email && EMAIL_RE.test(email)) {
      const reply = buildClientAutoReply(fields, orgName);
      await sendSystemMail({
        to: email,
        subject: reply.subject,
        text: reply.text,
        html: reply.html,
        replyTo: process.env.INQUIRY_REPLY_TO || null,
      });
    }
    // 2) 社内関係者へ通知。宛先は INQUIRY_NOTIFY_EMAILS(カンマ区切り)を優先、
    //    未設定なら owner/admin/sales_manager のプロフィールメールにフォールバック。
    const internalRecipients = await resolveInternalRecipients(admin, tenantId);
    if (internalRecipients.length > 0) {
      const notify = buildInternalNotify(fields, orgName, leadUrl);
      await sendSystemMail({
        to: internalRecipients,
        subject: notify.subject,
        text: notify.text,
        html: notify.html,
        replyTo: email && EMAIL_RE.test(email) ? email : null,
      });
    }
  } catch {
    /* メール通知失敗はリード作成の成功を妨げない */
  }

  return NextResponse.json({ ok: true, id: leadId }, { headers: CORS_HEADERS });
}

/** 社内通知メールの宛先を解決する。env優先 → メンバーのプロフィールメールにフォールバック。 */
async function resolveInternalRecipients(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
): Promise<string[]> {
  const envList = (process.env.INQUIRY_NOTIFY_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
  if (envList.length > 0) return Array.from(new Set(envList));

  try {
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "sales_manager"]);
    const ids = (members ?? []).map((m) => m.user_id as string);
    if (ids.length === 0) return [];
    const { data: profiles } = await admin.from("profiles").select("email").in("id", ids);
    const emails = (profiles ?? [])
      .map((p) => (p.email as string | null) ?? "")
      .filter((e) => EMAIL_RE.test(e));
    return Array.from(new Set(emails));
  } catch {
    return [];
  }
}
