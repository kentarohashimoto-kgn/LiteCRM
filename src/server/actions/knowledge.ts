"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const KINDS = ["knowhow", "win_reason", "loss_reason", "case_study"] as const;
const BUCKET = "attachments";
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export type SaveKnowledgeResult = { ok: true } | { ok: false; error: string };

/** フォームの ref_url[] / ref_label[] を {url,label}[] に整形。 */
function parseRefLinks(fd: FormData): { url: string; label: string | null }[] {
  const urls = fd.getAll("ref_url").map((v) => String(v).trim());
  const labels = fd.getAll("ref_label").map((v) => String(v).trim());
  const links: { url: string; label: string | null }[] = [];
  for (let i = 0; i < urls.length; i++) {
    let u = urls[i];
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    links.push({ url: u.slice(0, 2000), label: labels[i] ? labels[i].slice(0, 200) : null });
  }
  return links.slice(0, 20);
}

/**
 * B7 ノウハウ・事例の作成/更新(id があれば更新)。
 * 参考URL(複数・説明付き)と添付ファイル1件(差し替え/削除・説明付き)に対応。
 * 連続編集できるようリダイレクトせず結果を返す。
 */
export async function saveKnowledgeAction(fd: FormData): Promise<SaveKnowledgeResult> {
  const ctx = await requireCtx();
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "タイトルを入力してください" };

  const id = String(fd.get("id") ?? "").trim();
  const kindRaw = String(fd.get("kind") ?? "knowhow");
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "knowhow";
  const tags = String(fd.get("tags") ?? "")
    .split(/[,、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const base = {
    kind,
    title,
    body: String(fd.get("body") ?? "").trim(),
    is_own_company: fd.get("is_own_company") != null,
    industry: String(fd.get("industry") ?? "").trim() || null,
    competitor: String(fd.get("competitor") ?? "").trim() || null,
    tags,
    reference_links: parseRefLinks(fd),
    attachment_note: String(fd.get("attachment_note") ?? "").trim() || null,
  };

  const sb = getSupabaseServer();
  const file = fd.get("file") as File | null;
  const hasNewFile = !!file && file.size > 0;
  const removeAttachment = fd.get("remove_attachment") != null;
  if (hasNewFile && file!.size > MAX_SIZE) return { ok: false, error: "ファイルは10MBまでです" };

  // RETURNINGを避けるため作成時はUUIDを先行採番(RLS対策)
  const entryId = id || randomUUID();

  // 既存の添付パス(差し替え/削除時の掃除用)
  let oldPath: string | null = null;
  if (id) {
    const { data: cur } = await sb.from("knowledge_entries").select("attachment_path").eq("id", id).maybeSingle();
    oldPath = (cur as { attachment_path: string | null } | null)?.attachment_path ?? null;
  }

  // 添付の処理(新規アップロード/削除)
  let attachmentPatch: Record<string, unknown> = {};
  if (hasNewFile) {
    const admin = getSupabaseAdmin();
    // 表示用の元ファイル名(日本語も保持)。ストレージのキーはASCIIのみ許容のため別に生成する。
    const displayName = file!.name.replace(/[\r\n\\/]+/g, " ").trim().slice(0, 200) || "file";
    const ext = (displayName.match(/\.([A-Za-z0-9]{1,10})$/)?.[1] ?? "").toLowerCase();
    const path = `${ctx.tenantId}/knowledge/${entryId}/${randomUUID()}${ext ? `.${ext}` : ""}`;
    const buf = Buffer.from(await file!.arrayBuffer());
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: file!.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) return { ok: false, error: "ファイルのアップロードに失敗しました" };
    attachmentPatch = { attachment_path: path, attachment_name: displayName, attachment_type: file!.type || null, attachment_size: file!.size };
  } else if (removeAttachment) {
    attachmentPatch = { attachment_path: null, attachment_name: null, attachment_type: null, attachment_size: null };
  }

  const newPath = attachmentPatch.attachment_path as string | undefined;
  let dbError: { message: string } | null = null;
  if (id) {
    const { error } = await sb.from("knowledge_entries").update({ ...base, ...attachmentPatch }).eq("id", id);
    dbError = error;
  } else {
    const { error } = await sb.from("knowledge_entries").insert({
      id: entryId,
      tenant_id: ctx.tenantId,
      ...base,
      ...attachmentPatch,
      source: "manual",
      status: "approved",
      created_by: ctx.userId,
    });
    dbError = error;
  }

  if (dbError) {
    if (hasNewFile && newPath) {
      try {
        await getSupabaseAdmin().storage.from(BUCKET).remove([newPath]);
      } catch {
        /* 掃除失敗は許容 */
      }
    }
    return { ok: false, error: dbError.message };
  }

  // 古い添付を掃除(差し替え or 削除)
  if (oldPath && (hasNewFile || removeAttachment)) {
    try {
      await getSupabaseAdmin().storage.from(BUCKET).remove([oldPath]);
    } catch {
      /* 孤児ファイルは許容 */
    }
  }

  revalidatePath("/app/knowledge");
  return { ok: true };
}

/** ノウハウ・事例を削除(添付があれば実体も削除)。 */
export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  const { data: cur } = await sb.from("knowledge_entries").select("attachment_path").eq("id", id).maybeSingle();
  const { error } = await sb.from("knowledge_entries").delete().eq("id", id);
  if (!error) {
    const p = (cur as { attachment_path: string | null } | null)?.attachment_path;
    if (p) {
      try {
        await getSupabaseAdmin().storage.from(BUCKET).remove([p]);
      } catch {
        /* 実体削除失敗は許容 */
      }
    }
  }
  revalidatePath("/app/knowledge");
}
