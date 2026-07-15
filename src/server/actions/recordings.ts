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

/** 署名アップロードURLを発行し、保存先パスをレコードに記録。 */
export async function getRecordingUploadUrlAction(input: { id: string; ext: string }): Promise<Ok<{ path: string; token: string; signedUrl: string }> | Err> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("meeting_recordings").select("id").eq("id", input.id).maybeSingle();
  if (!row) return { ok: false, error: "録音が見つかりません（権限がない可能性）" };

  const safeExt = /^[a-z0-9]{1,8}$/i.test(input.ext) ? input.ext.toLowerCase() : "webm";
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
  return { ok: true, path: data.path, token: data.token, signedUrl };
}

/** アップロード完了を記録（処理待ちキューへ）。 */
export async function finishRecordingAction(input: { id: string; durationSec?: number | null; sizeBytes?: number | null; mimeType?: string | null }): Promise<{ ok: boolean; error?: string }> {
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

/** 録音の削除（音声実体も削除）。 */
export async function deleteRecordingAction(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("meeting_recordings").select("storage_path").eq("id", input.id).maybeSingle();
  const { error } = await sb.from("meeting_recordings").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  const path = (row as { storage_path: string | null } | null)?.storage_path;
  if (path) {
    try {
      await getSupabaseAdmin().storage.from(BUCKET).remove([path]);
    } catch {
      /* 実体削除失敗は許容 */
    }
  }
  revalidatePath("/app/opportunities", "layout");
  return { ok: true };
}
