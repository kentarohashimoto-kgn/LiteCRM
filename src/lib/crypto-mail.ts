/**
 * WO-22 SMTP資格情報の暗号化(F-101)。
 *
 * アプリパスワードをDBに平文で置かないため、AES-256-GCM で暗号化して保存する。
 * 鍵は環境変数 MAIL_CRED_SECRET から SHA-256 で 32byte に導出(DBには鍵を置かない)。
 * 保存形式: base64(iv[12] || authTag[16] || ciphertext) 。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const secret = process.env.MAIL_CRED_SECRET;
  if (!secret) throw new Error("MAIL_CRED_SECRET が未設定です（メール資格情報の暗号化に必要）");
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

/** 平文を AES-256-GCM で暗号化し base64 で返す。 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** encryptSecret で作った base64 を復号して平文に戻す。 */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** MAIL_CRED_SECRET が設定済みか(UI/アクションの事前チェック用)。 */
export function mailCredSecretConfigured(): boolean {
  return !!process.env.MAIL_CRED_SECRET;
}
