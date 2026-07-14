/**
 * Cloudflare Turnstile（CAPTCHA）のサーバー検証。
 * ロボット/自動化ツールによるログイン試行を抑止する。
 * 段階導入のため、環境変数が未設定なら検証をスキップ（no-op）する。
 *   - NEXT_PUBLIC_TURNSTILE_SITE_KEY : ウィジェット表示用（公開）
 *   - TURNSTILE_SECRET_KEY           : サーバー検証用（秘匿）
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** CAPTCHAが有効か（サイトキーが設定されているか）。 */
export function captchaEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

/**
 * Turnstileトークンを検証。true=通過。
 * - シークレット未設定: スキップ（true）＝段階導入
 * - トークン無し: false
 * - Cloudflare到達不可(例外): 可用性優先でtrue（フェイルオープン）
 */
export async function verifyTurnstile(token: string, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // 未設定＝検証スキップ
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    // Cloudflareに到達できないときはログインを止めない（誤ロックアウト回避）
    return true;
  }
}
