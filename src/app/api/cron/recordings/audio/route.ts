export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * 録音音声のプロキシ配信（夜間バッチ用）。
 * CCR実行環境は supabase.co への直接接続が許可されていない一方、アプリ(Vercel)経由なら到達できる。
 * ここで Storage の署名URLをサーバー側で発行して取得し、そのバイト列をそのままストリームで返す。
 * Edgeランタイムを使うのは、Node Functionの4.5MB応答上限を避け大きな音声も流せるようにするため。
 * 認可: Authorization: Bearer <CRON_SECRET>。
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return new Response("id required", { status: 400 });

  const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!SB || !SRK) return new Response("not configured", { status: 503 });
  const h = { apikey: SRK, authorization: `Bearer ${SRK}` };

  // storage_path を取得
  const rowRes = await fetch(`${SB}/rest/v1/meeting_recordings?id=eq.${encodeURIComponent(id)}&select=storage_path`, { headers: h, cache: "no-store" });
  if (!rowRes.ok) return new Response("lookup failed", { status: 502 });
  const rows = (await rowRes.json()) as { storage_path: string | null }[];
  const path = rows?.[0]?.storage_path;
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
