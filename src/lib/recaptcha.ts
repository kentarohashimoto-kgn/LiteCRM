/**
 * D-1d reCAPTCHA サーバー検証。
 * 問い合わせフォーム(/api/lead-intake)のトークン露出対策の上乗せとして、
 * フォームから送られた reCAPTCHA トークンを Google に問い合わせて人間性を検証する。
 *
 * シークレットは環境変数 `RECAPTCHA_SECRET`(サーバー専用/秘匿)から読む。
 * 未設定なら検証は無効(スキップ)。設定されている場合のみ有効化される。
 * v3(スコア)にも v2(チェックボックス)にも対応: success を必須、score があれば閾値判定。
 */

import "server-only";

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

/** RECAPTCHA_SECRET が設定されていれば有効。 */
export function isRecaptchaEnabled(): boolean {
  return !!process.env.RECAPTCHA_SECRET;
}

export type RecaptchaResult =
  | { ok: true; score?: number }
  | { ok: false; error: string; score?: number };

/**
 * reCAPTCHA トークンを検証する。
 * @param token フォームが取得した g-recaptcha-response トークン
 * @param remoteip 任意。クライアントIP(あれば精度向上)
 */
export async function verifyRecaptcha(token: string, remoteip?: string | null): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { ok: true }; // 未設定なら検証しない(無効)
  if (!token) return { ok: false, error: "missing token" };

  // v3 のスコア閾値(既定 0.5)。v2 では score が無いので判定に使われない。
  const minScore = Number(process.env.RECAPTCHA_MIN_SCORE ?? "0.5");

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteip) params.set("remoteip", remoteip);
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as {
      success?: boolean;
      score?: number;
      action?: string;
      "error-codes"?: string[];
    };
    if (!data.success) {
      return { ok: false, error: (data["error-codes"] ?? ["verification failed"]).join(","), score: data.score };
    }
    // v3: スコアが返る場合は閾値で足切り
    if (typeof data.score === "number" && data.score < (Number.isFinite(minScore) ? minScore : 0.5)) {
      return { ok: false, error: "low score", score: data.score };
    }
    return { ok: true, score: data.score };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
