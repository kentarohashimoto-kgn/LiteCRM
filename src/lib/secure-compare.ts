import { timingSafeEqual } from "crypto";

/**
 * シークレットの定数時間比較(タイミング攻撃対策)。
 * Authorization: Bearer <secret> 形式のヘッダ検証に使う。
 * 期待値が未設定(null/空)の場合は常に false(fail-closed)。
 */
export function secureCompare(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Bearer トークン検証。secret 未設定なら常に不合格(fail-closed)。 */
export function checkBearer(req: Request, secret: string | undefined): boolean {
  return secureCompare(req.headers.get("authorization"), secret ? `Bearer ${secret}` : null);
}
