"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { verifySmtp } from "@/lib/mail-smtp";
import { MAIL_PROVIDER_MAP } from "@/lib/email";

const SEND_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner"];

/**
 * WO-22 メール送信アカウント(SMTP)の接続・保存・切断(F-101)。本人のみ。
 * パスワードはAES-256-GCMで暗号化して保存(MAIL_CRED_SECRET が鍵)。
 */
export async function saveMailAccountAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/account?${q}`);
  if (!SEND_ROLES.includes(ctx.role)) back("error=forbidden");
  if (!mailCredSecretConfigured()) back("error=no_secret");

  const provider = String(formData.get("provider") ?? "other").trim();
  const preset = MAIL_PROVIDER_MAP[provider];
  const fromEmail = String(formData.get("from_email") ?? "").trim();
  const fromName = String(formData.get("from_name") ?? "").trim() || null;
  const host = (String(formData.get("smtp_host") ?? "").trim() || preset?.host || "").trim();
  const port = parseInt(String(formData.get("smtp_port") ?? "") || String(preset?.port ?? 465), 10);
  const secure = String(formData.get("smtp_secure") ?? (preset?.secure ? "on" : "")) === "on";
  const username = (String(formData.get("smtp_username") ?? "").trim() || fromEmail).trim();
  const password = String(formData.get("smtp_password") ?? "");
  const bccSelf = String(formData.get("bcc_self") ?? "") === "on";
  const imapHost = (String(formData.get("imap_host") ?? "").trim() || preset?.imapHost || "").trim();
  const imapPort = parseInt(String(formData.get("imap_port") ?? "") || String(preset?.imapPort ?? 993), 10);
  const inboundEnabled = String(formData.get("inbound_enabled") ?? "") === "on";

  if (!fromEmail || !host || !port) back("error=invalid");

  const sb = getSupabaseServer();
  const { data: existing } = await sb
    .from("user_mail_accounts")
    .select("id, smtp_password_enc")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  // パスワード未入力(更新時)は既存の暗号文を維持
  let passwordEnc: string | null = existing?.smtp_password_enc ?? null;
  if (password) passwordEnc = encryptSecret(password);
  if (!passwordEnc) back("error=need_password");

  // 送信前に接続テスト(verify)。失敗しても保存はするが未検証扱いにする。
  let verified = false;
  let verifyErr = "";
  try {
    const plain = password || decryptSecret(passwordEnc!);
    const r = await verifySmtp({ host, port, secure, username, password: plain, fromEmail, fromName });
    verified = r.ok;
    if (!r.ok) verifyErr = r.error;
  } catch (e) {
    verifyErr = e instanceof Error ? e.message : String(e);
  }

  const row = {
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    provider,
    from_email: fromEmail,
    from_name: fromName,
    smtp_host: host,
    smtp_port: port,
    smtp_secure: secure,
    smtp_username: username,
    smtp_password_enc: passwordEnc!,
    bcc_self: bccSelf,
    imap_host: imapHost || null,
    imap_port: Number.isFinite(imapPort) ? imapPort : 993,
    inbound_enabled: inboundEnabled,
    status: "active",
    verified_at: verified ? new Date().toISOString() : null,
  };

  const up = existing
    ? await sb.from("user_mail_accounts").update(row).eq("id", existing.id).select("id")
    : await sb.from("user_mail_accounts").insert(row).select("id");
  if (up.error) back("error=save_failed");

  revalidatePath("/app/email/account");
  if (verified) back("saved=connected");
  back(`error=unverified&detail=${encodeURIComponent(verifyErr.slice(0, 120))}`);
}

/** 保存済みアカウントの接続テスト(再検証)。 */
export async function testMailAccountAction(): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/account?${q}`);
  if (!mailCredSecretConfigured()) back("error=no_secret");
  const sb = getSupabaseServer();
  const { data: acc } = await sb
    .from("user_mail_accounts")
    .select("id, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, from_email, from_name")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!acc) back("error=no_account");

  try {
    const r = await verifySmtp({
      host: acc!.smtp_host as string,
      port: acc!.smtp_port as number,
      secure: acc!.smtp_secure as boolean,
      username: acc!.smtp_username as string,
      password: decryptSecret(acc!.smtp_password_enc as string),
      fromEmail: acc!.from_email as string,
      fromName: acc!.from_name as string | null,
    });
    if (!r.ok) {
      back(`error=unverified&detail=${encodeURIComponent(r.error.slice(0, 120))}`);
      return;
    }
    await sb.from("user_mail_accounts").update({ verified_at: new Date().toISOString() }).eq("id", acc!.id);
    back("saved=verified");
  } catch (e) {
    back(`error=unverified&detail=${encodeURIComponent((e instanceof Error ? e.message : String(e)).slice(0, 120))}`);
  }
}

/** 接続解除(行を削除)。 */
export async function disconnectMailAccountAction(): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("user_mail_accounts").delete().eq("user_id", ctx.userId);
  revalidatePath("/app/email/account");
  redirect("/app/email/account?saved=disconnected");
}
