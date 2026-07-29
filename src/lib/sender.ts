/**
 * 差出人(送信者)に依存するテンプレ変数の解決 — 純関数。
 *
 * 同じテンプレでも送信者ごとに変わる部分を差し込みで吸収する:
 *   {sender}       差出人名(フルネーム)          例: 橋本　健太郎
 *   {sender_last}  差出人の姓                    例: 橋本   ← 件名の「カトルセ橋本です」用
 *   {sender_email} 差出人のメールアドレス
 *   {signature}    送信者ごとの署名ブロック(メール設定で編集)
 *
 * 差出人名は from_name(メール設定) → profiles.display_name の順に採用する。
 * Google OAuth接続では from_name が空・from_email がプレースホルダのことがあるため、
 * アドレスは oauth_email を優先し、正しい形式でない方は捨てる。
 */

import { isValidEmail } from "@/lib/email";

export interface SenderSource {
  fromName?: string | null;
  /** profiles.display_name (from_name 未設定時のフォールバック) */
  displayName?: string | null;
  fromEmail?: string | null;
  oauthEmail?: string | null;
  authMethod?: string | null;
  signature?: string | null;
}

export interface SenderVars {
  sender: string;
  sender_last: string;
  sender_email: string;
  signature: string;
}

/** 姓(最初の空白まで)。全角空白にも対応。空白がなければ全体を返す。 */
export function lastName(fullName: string): string {
  const t = (fullName ?? "").trim();
  if (!t) return "";
  return t.split(/[\s　]+/)[0];
}

/** 送信者アカウント情報から差し込み変数を作る。 */
export function resolveSender(s: SenderSource): SenderVars {
  const name = (s.fromName ?? "").trim() || (s.displayName ?? "").trim();
  // OAuthは oauth_email が実アドレス。SMTPは from_email。どちらも形式が不正なら他方を使う
  const primary = s.authMethod === "google_oauth" ? s.oauthEmail : s.fromEmail;
  const secondary = s.authMethod === "google_oauth" ? s.fromEmail : s.oauthEmail;
  const email = isValidEmail(primary) ? (primary as string) : isValidEmail(secondary) ? (secondary as string) : "";
  return {
    sender: name,
    sender_last: lastName(name),
    sender_email: email,
    signature: (s.signature ?? "").trim(),
  };
}

/** プレビュー・サンプル用のダミー差出人(未接続時に「空欄だらけ」にしない)。 */
export function placeholderSender(): SenderVars {
  return { sender: "(差出人名未設定)", sender_last: "(姓)", sender_email: "(メールアドレス)", signature: "(署名未設定)" };
}
