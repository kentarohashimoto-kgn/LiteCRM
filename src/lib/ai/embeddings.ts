/**
 * P4 埋め込み生成(OpenAI text-embedding-3-small / 1024次元)。
 * ChatGPTのサブスクとは別に platform.openai.com のAPIキーが必要。
 * OPENAI_API_KEY 未設定なら null を返し、AI検索機能は安全に無効化される。
 * ※次元は document_chunks.embedding vector(1024) と一致させること。
 */

import "server-only";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1024;

export function embeddingsConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** 複数テキストをまとめて埋め込む(APIの1リクエスト上限に配慮し呼び出し側で分割する)。 */
export async function embedTexts(texts: string[]): Promise<{ ok: true; vectors: number[][] } | { ok: false; error: string }> {
  if (!embeddingsConfigured()) return { ok: false, error: "OPENAI_API_KEY が未設定です" };
  if (texts.length === 0) return { ok: true, vectors: [] };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: body.error?.message ?? `埋め込み生成に失敗(${res.status})` };
  }
  const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
  const sorted = (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (sorted.length !== texts.length) return { ok: false, error: "埋め込みの数が一致しません" };
  return { ok: true, vectors: sorted };
}

/** 単一テキスト(検索クエリ)用。 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const res = await embedTexts([text]);
  return res.ok ? res.vectors[0] : null;
}

/**
 * 抽出テキストを検索単位に分割する。
 * 段落境界を優先しつつ、1チャンク≒800字・100字オーバーラップ(文脈の切れ目対策)。
 */
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t.length > 0) chunks.push(t);
    buf = "";
  };

  for (const p of paragraphs) {
    if (p.length > size) {
      flush();
      for (let i = 0; i < p.length; i += size - overlap) {
        chunks.push(p.slice(i, i + size).trim());
      }
      continue;
    }
    if (buf.length + p.length + 2 > size) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return chunks.filter((c) => c.length >= 20); // ノイズ(見出しのみ等)は捨てる
}
