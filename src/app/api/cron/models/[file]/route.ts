export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * faster-whisper モデルファイルのアプリ経由配信（夜間バッチ用）。
 * 夜間バッチ(CCR実行環境)は huggingface.co へ直接到達できない一方、アプリ(Vercel)は到達できる。
 * ここで HuggingFace の該当ファイルを取得し、そのバイト列をそのままストリームで返す。
 * バッチはこの4ファイルをローカルへ落とし WhisperModel(ローカルパス) として読み込む（HF不要）。
 * Edgeランタイムを使うのは、Node Functionの4.5MB応答上限を避け大きな model.bin を流せるようにするため。
 * 認可: Authorization: Bearer <CRON_SECRET>。
 */

// 既定は base（正確性とサイズのバランス）。将来 small 等へ差し替えたくなったら repo を増やす。
const REPO: Record<string, string> = {
  base: "Systran/faster-whisper-base",
  small: "Systran/faster-whisper-small",
};
// faster-whisper がローカル読み込みで必要とするファイルのみ許可（任意パス取得は禁止）。
const ALLOWED = new Set(["config.json", "model.bin", "tokenizer.json", "vocabulary.txt", "preprocessor_config.json", "vocabulary.json"]);

export async function GET(req: Request, { params }: { params: { file: string } }): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get("authorization") ?? "";
  if (!secret || authz !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const file = params.file;
  if (!ALLOWED.has(file)) return new Response("not allowed", { status: 400 });

  const modelKey = new URL(req.url).searchParams.get("model") ?? "base";
  const repo = REPO[modelKey];
  if (!repo) return new Response("unknown model", { status: 400 });

  const hfUrl = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const hfRes = await fetch(hfUrl, { redirect: "follow", cache: "no-store" });
  if (!hfRes.ok || !hfRes.body) return new Response(`hf fetch failed (${hfRes.status})`, { status: 502 });

  const headers: Record<string, string> = {
    "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
    "cache-control": "no-store",
  };
  const len = hfRes.headers.get("content-length");
  if (len) headers["content-length"] = len;

  return new Response(hfRes.body, { status: 200, headers });
}
