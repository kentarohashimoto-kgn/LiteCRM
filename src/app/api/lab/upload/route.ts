import type { NextRequest } from "next/server";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  detectKind,
  normalizeMime,
  validateUpload,
} from "@/lib/ai-lab/attachments";
import { UPLOAD_BUCKET, createAttachment, labDb } from "@/lib/ai-lab/db";
import { getLabCtx } from "@/lib/ai-lab/session";

/**
 * 受講者の添付アップロード。
 *
 * 送信時ではなくファイル選択時に受け取り、Storage へ置いてIDだけ返す。
 * こうしておくと、チャット送信のリクエストが実ファイルで膨らまず、
 * 大きなPDFを添付しても送信操作自体は軽いままになる。
 * この時点では会話が未確定なので、会話・メッセージへの紐付けは送信時に行う。
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const slug = String(form.get("slug") ?? "");
  const ctx = await getLabCtx(slug);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "invalid_request" }, { status: 400 });
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return Response.json({ error: "attachment_rejected", message: "一度に添付できる件数を超えています" }, { status: 400 });
  }

  const db = labDb();
  const saved: { id: string; fileName: string; mime: string; sizeBytes: number; kind: string }[] = [];

  for (const file of files) {
    const mime = normalizeMime(file.type, file.name);
    const invalid = validateUpload({ fileName: file.name, mime, size: file.size });
    if (invalid) return Response.json({ error: "attachment_rejected", message: invalid }, { status: 400 });

    const detected = detectKind(mime, file.name);
    if (!detected) return Response.json({ error: "attachment_rejected" }, { status: 400 });
    // テキストは視覚入力ではなく本文へ差し込むが、保管と再表示の都合で document として持つ。
    const kind = detected === "image" ? "image" : "document";

    const path = `${ctx.company.id}/${ctx.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await db.storage
      .from(UPLOAD_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false });
    if (error) return Response.json({ error: "provider_error" }, { status: 500 });

    const row = await createAttachment({
      tenantId: ctx.company.tenant_id,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      origin: "upload",
      kind,
      fileName: file.name,
      mime,
      sizeBytes: file.size,
      storagePath: path,
    });
    if (!row) return Response.json({ error: "provider_error" }, { status: 500 });

    saved.push({ id: row.id, fileName: row.file_name, mime: row.mime, sizeBytes: row.size_bytes, kind: row.kind });
  }

  return Response.json({ attachments: saved });
}
