"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getProvider } from "@/lib/storage/provider";
import { getActiveConnection, hasActiveConnection } from "@/lib/storage/connections";
import "@/lib/storage/gdrive"; // アダプタ登録(副作用import)
import { logAudit, clientIp } from "@/lib/audit-events";

export type DocumentTargetType = "opportunity" | "account" | "project" | "knowledge" | "library";

export interface DocumentView {
  id: string;
  title: string;
  provider: string;
  source_type: string;
  web_url: string | null;
  mime_type: string | null;
  category: string | null;
  tags: string[];
  link_status: string;
  created_at: string;
  created_by: string | null;
}

/** P1 統合ドキュメント台帳: 対象に紐づくリンク一覧(RLSで可視性担保)。 */
export async function listDocuments(targetType: DocumentTargetType, targetId: string): Promise<DocumentView[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("documents")
    .select("id, title, provider, source_type, web_url, mime_type, category, tags, link_status, created_at, created_by")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as DocumentView[];
}

/** ドライブ接続の有無(セクションUIの出し分け用。資格情報には触れない)。 */
export async function gdriveConnected(): Promise<boolean> {
  const ctx = await requireCtx();
  return hasActiveConnection(ctx.tenantId, "gdrive");
}

/**
 * GoogleドライブのURL(または fileId)をリンクとして対象に添付する。
 * 実体はコピーせず、メタデータ(ID・リビジョン・カテゴリ)のみ台帳に登録する。
 * 失敗時は ?attach_error= を付けてリダイレクト(フォームアクション規約: Promise<void>)。
 */
export async function attachDriveLinkAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const input = String(formData.get("drive_url") || "");
  const targetType = String(formData.get("target_type")) as DocumentTargetType;
  const targetId = String(formData.get("target_id"));
  const revalidate = String(formData.get("revalidate") || "");

  const provider = getProvider("gdrive");
  if (!provider) return;
  const fileId = provider.parseFileId(input);
  if (!fileId) {
    if (revalidate) revalidatePath(revalidate);
    return;
  }
  const conn = await getActiveConnection(ctx.tenantId, "gdrive");
  if (!conn) {
    if (revalidate) revalidatePath(revalidate);
    return;
  }

  const resolved = await provider.resolveFile(conn, fileId);
  const sb = getSupabaseServer();

  if (!resolved.ok) {
    // 接続アカウントから見えないファイル等。台帳には登録しない。
    if (revalidate) revalidatePath(revalidate);
    return;
  }

  const category = provider.inferCategory(conn, resolved.file.parentId);
  // 同一対象への二重登録はスキップ(external_idで判定)
  const { data: dup } = await sb
    .from("documents")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("provider", "gdrive")
    .eq("external_id", resolved.file.externalId)
    .maybeSingle();
  if (dup) {
    if (revalidate) revalidatePath(revalidate);
    return;
  }

  await sb.from("documents").insert({
    tenant_id: ctx.tenantId,
    source_type: "link",
    provider: "gdrive",
    external_id: resolved.file.externalId,
    external_rev: resolved.file.revision,
    web_url: resolved.file.webUrl,
    title: resolved.file.title,
    mime_type: resolved.file.mimeType,
    size_bytes: resolved.file.sizeBytes,
    category,
    tags: category ? [category] : [],
    target_type: targetType,
    target_id: targetId,
    link_status: "ok",
    health_checked_at: new Date().toISOString(),
    created_by: ctx.userId,
  });
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "document.link.attach", target: resolved.file.title, meta: { targetType, targetId, fileId: resolved.file.externalId }, ip: clientIp() });
  if (revalidate) revalidatePath(revalidate);
}

/** リンクを台帳から外す(元ファイルには触れない。RLS: 本人 or 管理者)。 */
export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const id = String(formData.get("id"));
  const revalidate = String(formData.get("revalidate") || "");
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("documents").select("title").eq("id", id).maybeSingle();
  const { error, count } = await sb.from("documents").delete({ count: "exact" }).eq("id", id);
  if (!error && (count ?? 0) > 0 && row) {
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "document.link.detach", target: (row as { title: string }).title, meta: { id }, ip: clientIp() });
  }
  if (revalidate) revalidatePath(revalidate);
}
