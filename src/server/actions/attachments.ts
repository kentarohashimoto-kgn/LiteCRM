"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "attachments";
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export interface AttachmentView {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  url: string | null; // 署名URL(1時間有効)
}

/**
 * C-3 ファイル添付: 対象(案件/顧客)の添付一覧＋署名URL。
 * メタデータの可視性はRLS、実体は非公開バケット(署名URLのみでアクセス)。
 */
export async function listAttachments(targetType: "opportunity" | "account" | "candidate", targetId: string): Promise<AttachmentView[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("attachments")
    .select("id, file_name, content_type, size_bytes, uploaded_by, created_at, storage_path")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as (AttachmentView & { storage_path: string })[];
  if (rows.length === 0) return [];

  // service role キー未設定環境では一覧のみ(ダウンロード不可)
  let urls = new Map<string, string>();
  try {
    const admin = getSupabaseAdmin();
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path), 3600);
    urls = new Map(
      (signed ?? [])
        .filter((s): s is typeof s & { signedUrl: string; path: string } => Boolean(s.signedUrl && s.path))
        .map((s) => [s.path, s.signedUrl]),
    );
  } catch {
    /* SUPABASE_SERVICE_ROLE_KEY 未設定 */
  }
  return rows.map(({ storage_path, ...r }) => ({ ...r, url: urls.get(storage_path) ?? null }));
}

/** ファイル(複数可)をアップロードして対象に添付。 */
export async function uploadAttachmentAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const targetType = String(formData.get("target_type")) as "opportunity" | "account" | "candidate";
  const targetId = String(formData.get("target_id"));
  const revalidate = String(formData.get("revalidate") || "");
  if (files.length === 0) return;

  const admin = getSupabaseAdmin();
  const sb = getSupabaseServer();
  for (const file of files) {
    if (file.size > MAX_SIZE) continue; // 10MB超はUI側の注意書きで案内。他ファイルは続行。
    const safeName = file.name.replace(/[\\/]/g, "_").slice(0, 150);
    const path = `${ctx.tenantId}/${targetType}/${targetId}/${randomUUID()}_${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) continue;

    // メタデータはユーザー権限で挿入(RLSが編集/HRロールを担保)
    const { error: insErr } = await sb.from("attachments").insert({
      tenant_id: ctx.tenantId,
      target_type: targetType,
      target_id: targetId,
      file_name: safeName,
      storage_path: path,
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: ctx.userId,
    });
    if (insErr) {
      // メタ挿入に失敗したら実体も掃除
      await admin.storage.from(BUCKET).remove([path]);
    }
  }
  if (revalidate) revalidatePath(revalidate);
}

/** 添付を削除(本人 or 管理者。RLSが担保)。 */
export async function deleteAttachmentAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id"));
  const revalidate = String(formData.get("revalidate") || "");
  const sb = getSupabaseServer();
  const { data: row } = await sb.from("attachments").select("storage_path").eq("id", id).maybeSingle();
  if (!row) return;
  const { error, count } = await sb.from("attachments").delete({ count: "exact" }).eq("id", id);
  if (!error && (count ?? 0) > 0) {
    try {
      const admin = getSupabaseAdmin();
      await admin.storage.from(BUCKET).remove([(row as { storage_path: string }).storage_path]);
    } catch {
      /* 実体削除失敗は許容(孤児ファイル) */
    }
  }
  if (revalidate) revalidatePath(revalidate);
}
