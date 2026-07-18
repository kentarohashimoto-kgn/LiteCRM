/**
 * WO-22 SMTP送信(F-101b/c)。nodemailer で本人アカウントのSMTPから送信する。
 * サーバー専用(資格情報を扱うため)。呼び出しは Server Action / Route(認証済)からのみ。
 */

import "server-only";
import nodemailer from "nodemailer";

export interface SmtpAccount {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string; // 復号済み平文
  fromEmail: string;
  fromName?: string | null;
}

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  bcc?: string | null;
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

function transport(acc: SmtpAccount) {
  return nodemailer.createTransport({
    host: acc.host,
    port: acc.port,
    secure: acc.secure,
    auth: { user: acc.username, pass: acc.password },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

/** 接続テスト(verify)。資格情報が正しいか、送信前に確認する。 */
export async function verifySmtp(acc: SmtpAccount): Promise<SendResult> {
  try {
    await transport(acc).verify();
    return { ok: true, messageId: "verified" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 実送信。From は本人アドレス。GmailはSMTP送信でSentに自動保存。 */
export async function sendMail(acc: SmtpAccount, input: SendInput): Promise<SendResult> {
  try {
    const from = acc.fromName ? `${acc.fromName} <${acc.fromEmail}>` : acc.fromEmail;
    const info = await transport(acc).sendMail({
      from,
      to: input.to,
      bcc: input.bcc || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
