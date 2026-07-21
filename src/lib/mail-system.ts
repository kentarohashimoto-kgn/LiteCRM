/**
 * D-1b システム(no-reply)メール送信。
 *
 * 問い合わせフォーム(/api/lead-intake)のような「ログインユーザーが存在しない」
 * 公開エンドポイントから、自動返信・社内通知メールを送るための送信手段。
 * 個々のユーザーのSMTPアカウント(user_mail_accounts)ではなく、環境変数で設定した
 * 共有のシステムメールボックス(例: no-reply@catorce.jp)を使う。
 *
 * サーバー専用。未設定なら送信せず {ok:false, skipped:true} を返す(Slack通知と同じ思想:
 * 設定されていなければ静かにスキップし、本処理(リード作成)は成功扱いのまま)。
 */

import "server-only";
import nodemailer from "nodemailer";

export interface SystemMailInput {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
  bcc?: string | string[] | null;
}

export type SystemMailResult =
  | { ok: true; messageId: string }
  | { ok: false; skipped: true }
  | { ok: false; error: string };

interface SystemMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

/** 環境変数からシステムSMTP設定を読む。必須項目が欠けていれば null。 */
function readConfig(): SystemMailerConfig | null {
  const host = process.env.SYSTEM_SMTP_HOST;
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;
  const fromEmail = process.env.SYSTEM_MAIL_FROM ?? user;
  if (!host || !user || !pass || !fromEmail) return null;

  const port = Number(process.env.SYSTEM_SMTP_PORT ?? "465");
  // secure 明示指定が無ければポートから推定(465=SSL / それ以外=STARTTLS)
  const secure =
    process.env.SYSTEM_SMTP_SECURE != null
      ? process.env.SYSTEM_SMTP_SECURE === "true"
      : port === 465;

  return {
    host,
    port: Number.isFinite(port) ? port : 465,
    secure,
    user,
    pass,
    fromEmail,
    fromName: process.env.SYSTEM_MAIL_FROM_NAME ?? process.env.INQUIRY_ORG_NAME ?? "",
  };
}

/** システムメール送信が設定済みか。指示書・UIの説明用にも使える。 */
export function isSystemMailerConfigured(): boolean {
  return readConfig() != null;
}

/**
 * 診断用: 設定の有無とSMTP接続(verify)結果を、パスワードを伏せて返す。
 * 公開レスポンスに載せないこと(トークン保護されたルートからのみ使用)。
 */
export async function diagnoseSystemMailer(): Promise<{
  configured: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  fromName?: string;
  verify?: { ok: true } | { ok: false; error: string };
}> {
  const cfg = readConfig();
  if (!cfg) return { configured: false };
  const base = {
    configured: true,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.fromEmail,
    fromName: cfg.fromName,
  };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    await transport.verify();
    return { ...base, verify: { ok: true } };
  } catch (e) {
    return { ...base, verify: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

/** システムメールボックスから送信。未設定なら skipped で静かに返す。 */
export async function sendSystemMail(input: SystemMailInput): Promise<SystemMailResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    const from = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;
    const info = await transport.sendMail({
      from,
      to: Array.isArray(input.to) ? input.to.join(", ") : input.to,
      bcc: input.bcc
        ? Array.isArray(input.bcc)
          ? input.bcc.join(", ")
          : input.bcc
        : undefined,
      replyTo: input.replyTo || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
