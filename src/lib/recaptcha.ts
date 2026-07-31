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

/**
 * 検証に使うシークレット一覧。
 * サイト(キーペア)ごとにシークレットが異なるため、複数サイトのフォームが
 * 同じエンドポイントに投げる構成では複数シークレットを順に試す。
 * 例: キャリプラ=旧v2キー(RECAPTCHA_SECRET) / カトルセHP=新v3キー(RECAPTCHA_SECRET_2)
 */
function recaptchaSecrets(): string[] {
  return [process.env.RECAPTCHA_SECRET, process.env.RECAPTCHA_SECRET_2]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

/** シークレットが1つでも設定されていれば有効。 */
export function isRecaptchaEnabled(): boolean {
  return recaptchaSecrets().length > 0;
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
  const secrets = recaptchaSecrets();
  if (secrets.length === 0) return { ok: true }; // 未設定なら検証しない(無効)
  if (!token) return { ok: false, error: "missing token" };

  // v3 のスコア閾値(既定 0.5)。v2 では score が無いので判定に使われない。
  const minScore = Number(process.env.RECAPTCHA_MIN_SCORE ?? "0.5");

  // トークンはキーペア固有。どのサイトのフォームか区別せず受けるため、
  // 登録済みシークレットを順に試し、最初に success したもので判定する。
  let last: RecaptchaResult = { ok: false, error: "verification failed" };
  for (const secret of secrets) {
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
        last = { ok: false, error: (data["error-codes"] ?? ["verification failed"]).join(","), score: data.score };
        continue; // 別サイトのキーの可能性があるので次のシークレットを試す
      }
      // v3: スコアが返る場合は閾値で足切り
      if (typeof data.score === "number" && data.score < (Number.isFinite(minScore) ? minScore : 0.5)) {
        return { ok: false, error: "low score", score: data.score };
      }
      return { ok: true, score: data.score };
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return last;
}
