"use server";

import Anthropic from "@anthropic-ai/sdk";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { embedQuery, embeddingsConfigured } from "@/lib/ai/embeddings";
import { logAudit, clientIp } from "@/lib/audit-events";

/**
 * P4 AIヘルプ: 社内資料(営業資料・技術資料)を根拠にAIが回答する。
 * 検索は search_document_chunks(ベクトル+日本語キーワードのハイブリッド)。
 * 回答には必ず出典(資料名+ドライブリンク)を添え、資料に無いことは「分からない」と答えさせる。
 */

export interface AssistantSource {
  documentId: string;
  title: string;
  category: string | null;
  url: string | null;
}

export interface AssistantResult {
  ok: boolean;
  answer?: string;
  sources?: AssistantSource[];
  error?: string;
}

interface ChunkHit {
  chunk_id: string;
  document_id: string;
  content: string;
  title: string;
  category: string | null;
  web_url: string | null;
  score: number;
}

export async function askAssistantAction(input: { question: string; categories?: string[] }): Promise<AssistantResult> {
  const ctx = await requireCtx();
  const question = (input.question ?? "").trim();
  if (question.length < 3) return { ok: false, error: "質問を入力してください" };
  if (!embeddingsConfigured()) return { ok: false, error: "OPENAI_API_KEY が未設定です（資料検索の索引に必要）。Vercelの環境変数に設定してください。" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY が未設定です（回答生成に必要）。" };

  const embedding = await embedQuery(question);
  if (!embedding) return { ok: false, error: "検索用のベクトル生成に失敗しました" };

  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("search_document_chunks", {
    p_embedding: JSON.stringify(embedding),
    p_query: question,
    p_limit: 12,
    p_categories: input.categories && input.categories.length > 0 ? input.categories : null,
  });
  if (error) return { ok: false, error: `資料検索に失敗しました: ${error.message.slice(0, 150)}` };

  const hits = (data ?? []) as ChunkHit[];
  if (hits.length === 0) {
    return {
      ok: true,
      answer: "関連する社内資料が見つかりませんでした。資料がCRMに紐付けられていないか、まだ索引化されていない可能性があります（索引は夜間に更新されます）。",
      sources: [],
    };
  }

  // 出典は資料単位で重複排除(チャンクは同一資料から複数ヒットする)
  const sourceMap = new Map<string, AssistantSource>();
  for (const h of hits) {
    if (!sourceMap.has(h.document_id)) {
      sourceMap.set(h.document_id, { documentId: h.document_id, title: h.title, category: h.category, url: h.web_url });
    }
  }
  const sources = Array.from(sourceMap.values());
  const context = hits
    .map((h, i) => `【資料${i + 1}: ${h.title}${h.category ? `（${h.category}）` : ""}】\n${h.content}`)
    .join("\n\n---\n\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system:
        "あなたは株式会社カトルセの営業を支援するアシスタントです。渡された社内資料の抜粋だけを根拠に、日本語で簡潔に答えてください。" +
        "資料に書かれていないことは推測せず「資料には記載がありません」と伝えます。" +
        "回答の中で参照した資料は【資料N】の形式で示してください。営業がそのまま使える具体性を優先します。",
      messages: [
        {
          role: "user",
          content: `以下は社内資料の抜粋です。\n\n${context}\n\n---\n\n上記を根拠に質問へ回答してください。\n\n質問: ${question}`,
        },
      ],
    });
    const answer = msg.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId, action: "assistant.ask",
      target: question.slice(0, 100), meta: { hits: hits.length, sources: sources.length }, ip: await clientIp(),
    });
    return { ok: true, answer, sources };
  } catch (e) {
    return { ok: false, error: `回答生成に失敗しました: ${e instanceof Error ? e.message.slice(0, 150) : "unknown"}` };
  }
}

/** インデックスの整備状況(画面の案内表示用)。 */
export async function fetchIndexStatus(): Promise<{ indexed: number; pending: number; excluded: number; configured: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const [i, p, e] = await Promise.all([
    sb.from("documents").select("id", { count: "exact", head: true }).eq("index_status", "indexed"),
    sb.from("documents").select("id", { count: "exact", head: true }).eq("index_status", "pending"),
    sb.from("documents").select("id", { count: "exact", head: true }).eq("index_status", "excluded"),
  ]);
  return {
    indexed: i.count ?? 0,
    pending: p.count ?? 0,
    excluded: e.count ?? 0,
    configured: embeddingsConfigured() && !!process.env.ANTHROPIC_API_KEY,
  };
}
