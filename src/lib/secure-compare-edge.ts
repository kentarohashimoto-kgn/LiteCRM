/**
 * Edgeランタイム用の定数時間比較(node:crypto に非依存)。
 * secure-compare.ts は `import { timingSafeEqual } from "crypto"` を持つため
 * Edgeランタイムのルート(cron/models・cron/recordings/audio 等)では読み込めない。
 * ここは TextEncoder のみを使い、Edge/Node どちらでも動く。
 */
export function secureCompareEdge(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(actual);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Bearer トークン検証(Edge安全)。secret 未設定なら常に不合格(fail-closed)。 */
export function checkBearerEdge(req: Request, secret: string | undefined): boolean {
  return secureCompareEdge(req.headers.get("authorization"), secret ? `Bearer ${secret}` : null);
}
