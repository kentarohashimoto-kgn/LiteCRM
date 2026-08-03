/**
 * middleware(Edge)から会社のBasic認証情報を引くための最小アクセサ。
 *
 * middleware は全リクエストで通るため、supabase-js を持ち込まず REST を直接叩き、
 * 結果を短時間メモリキャッシュする。キャッシュTTLぶんは
 * 「Basic認証の変更が反映されるまでの遅れ」になるので短く保つこと。
 */

export interface EdgeCompany {
  id: string;
  slug: string;
  is_active: boolean;
  basic_user: string;
  basic_secret_hash: string;
}

/**
 * 「会社が無い」と「環境変数が無い」を区別する。
 * どちらも入場は拒むが、後者は運用側のミスなので、切り分けできる形で返す
 * (両方 404 にすると、デプロイ設定漏れが「会社未登録」に見えて原因究明が遅れる)。
 */
export type EdgeCompanyResult =
  | { kind: "ok"; company: EdgeCompany }
  | { kind: "not_found" }
  | { kind: "not_configured" };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: EdgeCompany | null }>();

export function clearEdgeCompanyCache(): void {
  cache.clear();
}

export async function getEdgeCompany(slug: string): Promise<EdgeCompanyResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // 未設定時に通してしまうと無防備な環境ができるので、拒否したうえで理由を返す。
  if (!url || !key) return { kind: "not_configured" };

  const hit = cache.get(slug);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) {
    return hit.value ? { kind: "ok", company: hit.value } : { kind: "not_found" };
  }

  let value: EdgeCompany | null = null;
  try {
    const res = await fetch(
      `${url}/rest/v1/ai_lab_companies?slug=eq.${encodeURIComponent(slug)}` +
        `&select=id,slug,is_active,basic_user,basic_secret_hash&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (res.ok) {
      const rows = (await res.json()) as EdgeCompany[];
      value = rows?.[0] ?? null;
    }
  } catch {
    // ネットワーク断はキャッシュせず、次のリクエストで再試行させる。
    const prev = hit?.value ?? null;
    return prev ? { kind: "ok", company: prev } : { kind: "not_found" };
  }

  cache.set(slug, { at: now, value });
  return value ? { kind: "ok", company: value } : { kind: "not_found" };
}
