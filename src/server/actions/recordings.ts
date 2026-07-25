"use server";

/**
 * 商談録音（フェーズ1: 録音の保存＋処理キュー）。
 * 音声は非公開バケット recordings に「署名アップロードURL」で直接アップロードする
 * （大きな音声をアプリサーバー経由にしないための方式）。文字起こし/要約は夜間バッチ（フェーズ2）。
 */
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, clientIp } from "@/lib/audit-events";
import { getActiveConnection } from "@/lib/storage/connections";
import { GDRIVE_WRITE_SCOPE, createResumableUploadSession, resolveRecordingsFolder, deleteDriveFile } from "@/lib/storage/gdrive";

const BUCKET = "recordings";
const RETENTION_DAYS = 30;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

/** 録音レコードを作成（録音開始時）。RETURNINGを避けUUID先行採番。 */
export async function createRecordingAction(input: {
  opportunityId?: string | null;
  meetingId?: string | null;
  accountId?: string | null;
  title?: string | null;
}): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = randomUUID();
  const { error } = await sb.from("meeting_recordings").insert({
    id,
    tenant_id: ctx.tenantId,
    opportunity_id: input.opportunityId ?? null,
    meeting_id: input.meetingId ?? null,
    account_id: input.accountId ?? null,
    owner_user_id: ctx.userId,
    created_by: ctx.userId,
    title: (input.title ?? "").slice(0, 200) || null,
    status: "recording",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

/**
 * アップロードURLを発行し、保存先をレコードに記録。
 * P1.6: ドライブ接続(書込可)があれば Drive resumable セッション(kind='gdrive')を返し、
 * 音声はブラウザ→Drive直送(容量制限なし・30日自動削除もDrive側で実施)。
 * 未接続/読み取り専用接続の環境は従来のSupabase署名URL(kind='supabase')へフォールバック。
 */
export async function getRecordingUploadUrlAction(input: { id: string; ext: string }): Promise<Ok<{ kind: "gdrive" | "supabase"; signedUrl: string }> | Err> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("meeting_recordings").select("id, title").eq("id", input.id).maybeSingle();
  if (!row) return { ok: false, error: "録音が見つかりません（権限がない可能性）" };
  const safeExt = /^[a-z0-9]{1,8}$/i.test(input.ext) ? input.ext.toLowerCase() : "webm";

  // ドライブ優先
  const conn = await getActiveConnection(ctx.tenantId, "gdrive");
  const canWrite = !!conn && String(conn.config?.scopes ?? "").includes(GDRIVE_WRITE_SCOPE);
  if (conn && canWrite) {
    const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    const title = ((row as { title?: string | null }).title ?? "").slice(0, 60) || "商談録音";
    const session = await createResumableUploadSession(conn, {
      fileName: `${date}_${title}_${input.id.slice(0, 8)}.${safeExt}`,
      mimeType: `audio/${safeExt === "mp3" ? "mpeg" : safeExt}`,
      parentId: resolveRecordingsFolder(conn),
    });
    if (session.ok) {
      await getSupabaseAdmin().from("meeting_recordings").update({ status: "uploading" }).eq("id", input.id);
      return { ok: true, kind: "gdrive", signedUrl: session.sessionUrl };
    }
    // ドライブ側の失敗はSupabaseへフォールバック(録音を失わせない)
  }

  const path = `${ctx.tenantId}/${input.id}.${safeExt}`;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "アップロードURLの発行に失敗しました" };
  await admin.from("meeting_recordings").update({ storage_path: path, status: "uploading" }).eq("id", input.id);
  // supabase-js のバージョンにより signedUrl が相対の場合があるので絶対URLに正規化
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const signedUrl = data.signedUrl.startsWith("http")
    ? data.signedUrl
    : `${base}${data.signedUrl.startsWith("/") ? "" : "/"}${data.signedUrl}`;
  return { ok: true, kind: "supabase", signedUrl };
}

/** アップロード完了を記録（処理待ちキューへ）。driveFileId はドライブ直送時のみ。 */
export async function finishRecordingAction(input: { id: string; durationSec?: number | null; sizeBytes?: number | null; mimeType?: string | null; driveFileId?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const admin = getSupabaseAdmin();
  const expires = new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const { error } = await admin
    .from("meeting_recordings")
    .update({
      status: "uploaded",
      duration_sec: input.durationSec != null ? Math.round(input.durationSec) : null,
      size_bytes: input.sizeBytes != null ? Math.round(input.sizeBytes) : null,
      mime_type: input.mimeType ?? null,
      drive_file_id: input.driveFileId ?? null,
      expires_at: expires,
    })
    .eq("id", input.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
    action: "meeting.record", target: input.id,
    meta: { durationSec: input.durationSec ?? null, sizeBytes: input.sizeBytes ?? null }, ip: clientIp(),
  });
  revalidatePath("/app/opportunities", "layout");
  return { ok: true };
}

/** 録音失敗をマーク。 */
export async function failRecordingAction(input: { id: string; error?: string }): Promise<void> {
  const ctx = await requireCtx();
  const admin = getSupabaseAdmin();
  await admin
    .from("meeting_recordings")
    .update({ status: "failed", error: (input.error ?? "").slice(0, 500) })
    .eq("id", input.id)
    .eq("tenant_id", ctx.tenantId);
}

/** 録音の削除（音声実体も削除。Supabase/ドライブ両対応）。 */
export async function deleteRecordingAction(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("meeting_recordings").select("storage_path, drive_file_id").eq("id", input.id).maybeSingle();
  const { error } = await sb.from("meeting_recordings").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  const r = row as { storage_path: string | null; drive_file_id: string | null } | null;
  if (r?.storage_path) {
    try {
      await getSupabaseAdmin().storage.from(BUCKET).remove([r.storage_path]);
    } catch {
      /* 実体削除失敗は許容 */
    }
  }
  if (r?.drive_file_id) {
    try {
      const conn = await getActiveConnection(ctx.tenantId, "gdrive");
      if (conn) await deleteDriveFile(conn, r.drive_file_id);
    } catch {
      /* 実体削除失敗は許容 */
    }
  }
  revalidatePath("/app/opportunities", "layout");
  return { ok: true };
}
