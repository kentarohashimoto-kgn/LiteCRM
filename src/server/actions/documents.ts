"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/storage/provider";
import { getActiveConnection, hasActiveConnection } from "@/lib/storage/connections";
import {
  GDRIVE_WRITE_SCOPE,
  createResumableUploadSession,
  downloadDriveFile,
  resolveUploadFolder,
} from "@/lib/storage/gdrive";
import { INDEX_EXCLUDED, SNAPSHOT_FORCED, SNAPSHOT_MAX_BYTES, DOC_CATEGORIES, type DocCategory } from "@/lib/storage/doc-categories";
import { logAudit, clientIp } from "@/lib/audit-events";
import { asciiStorageKey } from "@/lib/storage-key";

export type DocumentTargetType = "opportunity" | "account" | "lead" | "candidate" | "project" | "knowledge" | "library";

const SNAPSHOT_BUCKET = "attachments"; // 凍結コピーの保存先(既存の非公開バケットを流用)

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
  has_snapshot: boolean;
  created_at: string;
  created_by: string | null;
}

/** P1 統合ドキュメント台帳: 対象に紐づくリンク一覧(RLSで可視性担保)。 */
export async function listDocuments(targetType: DocumentTargetType, targetId: string): Promise<DocumentView[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("documents")
    .select("id, title, provider, source_type, web_url, mime_type, category, tags, link_status, storage_path, created_at, created_by")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as (Omit<DocumentView, "has_snapshot"> & { storage_path: string | null })[];
  return rows.map(({ storage_path, ...r }) => ({ ...r, has_snapshot: !!storage_path }));
}

/** ドライブ接続の状態(セクションUIの出し分け用)。canWrite=アップロード可(書込スコープあり)。 */
export async function gdriveConnectionStatus(): Promise<{ connected: boolean; canWrite: boolean }> {
  const ctx = await requireCtx();
  const connected = await hasActiveConnection(ctx.tenantId, "gdrive");
  if (!connected) return { connected: false, canWrite: false };
  const conn = await getActiveConnection(ctx.tenantId, "gdrive");
  const scopes = String(conn?.config?.scopes ?? "");
  return { connected: true, canWrite: scopes.includes(GDRIVE_WRITE_SCOPE) };
}

/**
 * P1.5 アップロード開始: 種別から保存先フォルダを決め、ブラウザが直接PUTする
 * resumableセッションURLを返す(ファイル本体はVercelを経由しない=サイズ制限なし)。
 */
export async function createDriveUploadAction(input: {
  category: string;
  fileName: string;
  mimeType: string;
}): Promise<{ ok: true; sessionUrl: string } | { ok: false; error: string }> {
  const ctx = await requireCtx();
  if (!(DOC_CATEGORIES as readonly string[]).includes(input.category)) return { ok: false, error: "種別が不正です" };
  const conn = await getActiveConnection(ctx.tenantId, "gdrive");
  if (!conn) return { ok: false, error: "Googleドライブ未接続です(設定画面から接続)" };
  const parentId = resolveUploadFolder(conn, input.category);
  if (!parentId) return { ok: false, error: `種別「${input.category}」の保存先フォルダが未設定です` };
  const safeName = input.fileName.replace(/[\\/]/g, "_").slice(0, 150);
  return createResumableUploadSession(conn, { fileName: safeName, mimeType: input.mimeType, parentId });
}

/**
 * P1.5 アップロード確定: Driveに置かれたファイルを台帳登録し、
 * 種別が証跡固定(契約書類等) or 指定ありなら Supabase に凍結コピー(静止点)を保存する。
 */
export async function finalizeDriveUploadAction(input: {
  fileId: string;
  category: string;
  targetType: DocumentTargetType;
  targetId: string;
  snapshot: boolean;
  revalidate?: string;
}): Promise<{ ok: true; snapshotSaved: boolean; warning?: string } | { ok: false; error: string }> {
  const ctx = await requireCtx();
  const provider = getProvider("gdrive");
  const conn = await getActiveConnection(ctx.tenantId, "gdrive");
  if (!provider || !conn) return { ok: false, error: "Googleドライブ未接続です" };

  const resolved = await provider.resolveFile(conn, input.fileId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const category = (DOC_CATEGORIES as readonly string[]).includes(input.category) ? (input.category as DocCategory) : null;
  const wantSnapshot = input.snapshot || (category !== null && SNAPSHOT_FORCED.includes(category));

  // 静止点(凍結コピー): マスターはドライブ、Supabase側は「その時点の状態」の保管のみ
  let storagePath: string | null = null;
  let warning: string | undefined;
  if (wantSnapshot) {
    const dl = await downloadDriveFile(conn, resolved.file.externalId, SNAPSHOT_MAX_BYTES);
    if (dl.ok) {
      try {
        const admin = getSupabaseAdmin();
        // キーはASCII限定(日本語名は"Invalid key"で拒否される)。元の名前はdocuments.titleが保持
        const path = `${ctx.tenantId}/snapshots/${asciiStorageKey(resolved.file.title)}`;
        const { error: upErr } = await admin.storage.from(SNAPSHOT_BUCKET).upload(path, dl.data, {
          contentType: dl.contentType ?? resolved.file.mimeType ?? "application/octet-stream",
          upsert: false,
        });
        if (!upErr) storagePath = path;
        else warning = `静止点の保存に失敗: ${upErr.message.slice(0, 120)}`;
      } catch (e) {
        warning = `静止点の保存に失敗: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`;
      }
    } else {
      warning = `静止点の保存に失敗: ${dl.error}`;
    }
  }

  const sb = getSupabaseServer();
  const { error: insErr } = await sb.from("documents").insert({
    tenant_id: ctx.tenantId,
    source_type: "link",
    provider: "gdrive",
    external_id: resolved.file.externalId,
    external_rev: resolved.file.revision,
    storage_path: storagePath,
    web_url: resolved.file.webUrl,
    title: resolved.file.title,
    mime_type: resolved.file.mimeType,
    size_bytes: resolved.file.sizeBytes,
    category,
    tags: category ? [category] : [],
    target_type: input.targetType,
    target_id: input.targetId,
    index_status: category !== null && INDEX_EXCLUDED.includes(category) ? "excluded" : "pending",
    link_status: "ok",
    health_checked_at: new Date().toISOString(),
    retention: storagePath ? "keep" : null,
    created_by: ctx.userId,
  });
  if (insErr) return { ok: false, error: `台帳登録に失敗: ${insErr.message.slice(0, 120)}` };

  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "document.upload", target: resolved.file.title, meta: { category, targetType: input.targetType, targetId: input.targetId, fileId: resolved.file.externalId, snapshot: !!storagePath }, ip: await clientIp() });
  if (input.revalidate) revalidatePath(input.revalidate);
  return { ok: true, snapshotSaved: !!storagePath, warning };
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
    index_status: category !== null && INDEX_EXCLUDED.includes(category as DocCategory) ? "excluded" : "pending",
    link_status: "ok",
    health_checked_at: new Date().toISOString(),
    created_by: ctx.userId,
  });
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "document.link.attach", target: resolved.file.title, meta: { targetType, targetId, fileId: resolved.file.externalId }, ip: await clientIp() });
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
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "document.link.detach", target: (row as { title: string }).title, meta: { id }, ip: await clientIp() });
  }
  if (revalidate) revalidatePath(revalidate);
}
