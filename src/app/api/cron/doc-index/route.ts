import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { getActiveConnection } from "@/lib/storage/connections";
import { extractText, isExtractableMime } from "@/lib/storage/gdrive";
import { embedTexts, embeddingsConfigured, chunkText } from "@/lib/ai/embeddings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DOCS_PER_RUN = 8;      // 1回の実行で処理する資料数(Drive変換とAPI費の平準化)
const EMBED_BATCH = 64;      // 埋め込みAPIの1リクエストあたりチャンク数
const MAX_CHUNKS_PER_DOC = 120;

/**
 * P4 AI学習インデックス(夜間)。documents から未処理/更新済みの資料を選び、
 * 本文抽出 → チャンク化 → 埋め込み生成 → document_chunks へ保存する。
 * 対象は index_status='pending'(新規)と、リンク先が更新された資料(external_rev ≠ indexed_rev)。
 * 契約書類/請求/人事は 'excluded' のため対象外。
 * 認可: Bearer CRON_SECRET。設計: docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §5
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });
  if (!embeddingsConfigured()) return NextResponse.json({ ok: true, skipped: "OPENAI_API_KEY未設定のためインデックスは無効" });

  const admin = getSupabaseAdmin();

  // 未処理を優先し、次に「リンク先が更新された」資料を拾う
  const cols = "id, tenant_id, provider, external_id, external_rev, indexed_rev, mime_type, title, category, index_status";
  const { data: pendingRows } = await admin
    .from("documents")
    .select(cols)
    .eq("source_type", "link")
    .eq("link_status", "ok")
    .eq("index_status", "pending")
    .not("external_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(DOCS_PER_RUN);

  let targets = (pendingRows ?? []) as Record<string, string | null>[];
  if (targets.length < DOCS_PER_RUN) {
    const { data: staleRows } = await admin
      .from("documents")
      .select(cols)
      .eq("source_type", "link")
      .eq("link_status", "ok")
      .eq("index_status", "indexed")
      .not("external_id", "is", null)
      .limit(200);
    const stale = ((staleRows ?? []) as Record<string, string | null>[])
      .filter((d) => (d.external_rev ?? "") !== (d.indexed_rev ?? ""))
      .slice(0, DOCS_PER_RUN - targets.length);
    targets = targets.concat(stale);
  }
  if (targets.length === 0) return NextResponse.json({ ok: true, indexed: 0, note: "対象なし" });

  const connCache = new Map<string, Awaited<ReturnType<typeof getActiveConnection>>>();
  let indexed = 0, skipped = 0, failed = 0, chunkTotal = 0;

  for (const d of targets) {
    const tenantId = d.tenant_id as string;
    const docId = d.id as string;

    if (!isExtractableMime(d.mime_type)) {
      await admin.from("documents").update({ index_status: "skipped", indexed_rev: d.external_rev }).eq("id", docId);
      skipped++;
      continue;
    }
    const cacheKey = `${tenantId}|${d.provider}`;
    if (!connCache.has(cacheKey)) connCache.set(cacheKey, await getActiveConnection(tenantId, d.provider as string));
    const conn = connCache.get(cacheKey);
    if (!conn) { failed++; continue; }

    const ext = await extractText(conn, d.external_id as string, d.mime_type).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!ext.ok) {
      await admin.from("documents").update({ index_status: "failed" }).eq("id", docId);
      failed++;
      continue;
    }

    const chunks = chunkText(ext.text).slice(0, MAX_CHUNKS_PER_DOC);
    if (chunks.length === 0) {
      await admin.from("documents").update({ index_status: "skipped", indexed_rev: d.external_rev }).eq("id", docId);
      skipped++;
      continue;
    }

    // 再インデックス時は既存チャンクを置き換える
    await admin.from("document_chunks").delete().eq("document_id", docId);

    let ok = true;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const emb = await embedTexts(slice);
      if (!emb.ok) { ok = false; break; }
      const rows = slice.map((content, j) => ({
        tenant_id: tenantId,
        document_id: docId,
        chunk_no: i + j,
        content,
        embedding: JSON.stringify(emb.vectors[j]), // pgvectorは文字列リテラルを受け付ける
        meta: { title: d.title, category: d.category },
      }));
      const { error } = await admin.from("document_chunks").insert(rows);
      if (error) { ok = false; break; }
      chunkTotal += rows.length;
    }

    if (ok) {
      await admin.from("documents").update({ index_status: "indexed", indexed_rev: d.external_rev }).eq("id", docId);
      indexed++;
    } else {
      await admin.from("document_chunks").delete().eq("document_id", docId);
      await admin.from("documents").update({ index_status: "failed" }).eq("id", docId);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, indexed, skipped, failed, chunks: chunkTotal });
}
