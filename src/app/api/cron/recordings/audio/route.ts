export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * 録音音声のプロキシ配信（夜間バッチ用）。
 * CCR実行環境は supabase.co への直接接続が許可されていない一方、アプリ(Vercel)経由なら到達できる。
 * Supabase保存分は署名URL、ドライブ保存分(P1.6)は組織接続のトークンで取得し、そのままストリームで返す。
 * Edgeランタイムを使うのは、Node Functionの4.5MB応答上限を避け大きな音声も流せるようにするため。
 * ※Edgeでは node:crypto が使えないため、資格情報の復号は WebCrypto で行う(crypto-mail.ts と同形式)。
 * 認可: Authorization: Bearer <CRON_SECRET>。
 */

import { decryptSecretEdge } from "@/lib/crypto-mail-edge";
import { checkBearerEdge } from "@/lib/secure-compare-edge";

export async function GET(req: Request): Promise<Response> {
  if (!checkBearerEdge(req, process.env.CRON_SECRET)) return new Response("unauthorized", { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return new Response("id required", { status: 400 });

  const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!SB || !SRK) return new Response("not configured", { status: 503 });
  const h = { apikey: SRK, authorization: `Bearer ${SRK}` };

  // 保存先(Supabase or ドライブ)を取得
  const rowRes = await fetch(
    `${SB}/rest/v1/meeting_recordings?id=eq.${encodeURIComponent(id)}&select=storage_path,drive_file_id,tenant_id`,
    { headers: h, cache: "no-store" },
  );
  if (!rowRes.ok) return new Response("lookup failed", { status: 502 });
  const rows = (await rowRes.json()) as { storage_path: string | null; drive_file_id: string | null; tenant_id: string }[];
  const row = rows?.[0];
  if (!row) return new Response("not found", { status: 404 });

  // ---- P1.6: ドライブ保存分 ----
  if (row.drive_file_id) {
    const credSecret = process.env.MAIL_CRED_SECRET ?? "";
    const cid = process.env.GOOGLE_CLIENT_ID ?? "";
    const csec = process.env.GOOGLE_CLIENT_SECRET ?? "";
    if (!credSecret || !cid || !csec) return new Response("gdrive not configured", { status: 503 });

    const connRes = await fetch(
      `${SB}/rest/v1/tenant_storage_connections?tenant_id=eq.${encodeURIComponent(row.tenant_id)}&provider=eq.gdrive&status=eq.active&select=credentials&order=created_at.desc&limit=1`,
      { headers: h, cache: "no-store" },
    );
    if (!connRes.ok) return new Response("conn lookup failed", { status: 502 });
    const conns = (await connRes.json()) as { credentials: string | null }[];
    const enc = conns?.[0]?.credentials;
    if (!enc) return new Response("gdrive not connected", { status: 503 });

    let refreshToken: string;
    try {
      refreshToken = await decryptSecretEdge(enc, credSecret);
    } catch {
      return new Response("decrypt failed", { status: 502 });
    }
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: cid, client_secret: csec, grant_type: "refresh_token" }),
    });
    const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokRes.ok || !tok.access_token) return new Response("token refresh failed", { status: 502 });

    const audioRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.drive_file_id)}?alt=media&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${tok.access_token}` }, cache: "no-store" },
    );
    if (!audioRes.ok || !audioRes.body) return new Response("drive fetch failed", { status: 502 });
    return new Response(audioRes.body, {
      status: 200,
      headers: {
        "content-type": audioRes.headers.get("content-type") ?? "audio/webm",
        "cache-control": "no-store",
      },
    });
  }

  // ---- 従来: Supabase保存分 ----
  const path = row.storage_path;
  if (!path) return new Response("no audio", { status: 404 });

  // 署名URLを発行
  const encPath = path.split("/").map(encodeURIComponent).join("/");
  const signRes = await fetch(`${SB}/storage/v1/object/sign/recordings/${encPath}`, {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
    cache: "no-store",
  });
  if (!signRes.ok) return new Response("sign failed", { status: 502 });
  const { signedURL } = (await signRes.json()) as { signedURL: string };

  // 実体を取得してストリーム返却
  const audioRes = await fetch(`${SB}/storage/v1${signedURL}`, { cache: "no-store" });
  if (!audioRes.ok || !audioRes.body) return new Response("fetch failed", { status: 502 });
  return new Response(audioRes.body, {
    status: 200,
    headers: {
      "content-type": audioRes.headers.get("content-type") ?? "audio/webm",
      "cache-control": "no-store",
    },
  });
}
