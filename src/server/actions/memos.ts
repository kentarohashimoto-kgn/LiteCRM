"use server";

/**
 * メモ・議事録ページ（Notionライクな自由ページ）のサーバーアクション。
 * すべて requireCtx() ＋ RLS（テナント内共有）の二重ガード。
 *  - 作成は1クリック（タイトル未入力で白紙ページを作り、すぐ編集画面へ）
 *  - 本文はクライアントからのデバウンス自動保存
 *  - 案件・商談への紐付けは後から（ページの録音にも伝播させ、文字起こしをCRM側へ流す）
 */
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getActiveConnection } from "@/lib/storage/connections";
import { deleteDriveFile } from "@/lib/storage/gdrive";
import {
  defaultMemoTitle,
  isMemoKind,
  normalizeMemoBody,
  normalizeMemoTitle,
  MEMO_MAX_TITLE,
} from "@/lib/memo";

const BUCKET = "recordings";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** ページを作成して編集画面へ（Notion的に「まず白紙を開く」）。 */
export async function createMemoPageAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const kindRaw = formData.get("kind");
  const kind = isMemoKind(kindRaw) ? kindRaw : "memo";
  const parentId = String(formData.get("parent_id") ?? "").trim() || null;
  const titleRaw = String(formData.get("title") ?? "").trim();
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const title = titleRaw ? titleRaw.slice(0, MEMO_MAX_TITLE) : defaultMemoTitle(kind, jstNow);

  const id = randomUUID();
  const { error } = await sb.from("memo_pages").insert({
    id,
    tenant_id: ctx.tenantId,
    parent_id: parentId,
    title,
    kind,
    owner_user_id: ctx.userId,
    created_by: ctx.userId,
  });
  if (error) redirect(`/app/memos?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app/memos", "layout");
  redirect(`/app/memos/${id}`);
}

/** タイトル・本文の自動保存（クライアントからデバウンスで呼ぶ）。 */
export async function updateMemoPageAction(input: {
  id: string;
  title?: string;
  body?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = normalizeMemoTitle(input.title);
  if (input.body !== undefined) patch.body = normalizeMemoBody(input.body);
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await sb.from("memo_pages").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 案件・商談への紐付け（後から）。opportunity_id を空にすると解除。
 * ページ配下の録音にも紐付けを伝播し、以後の文字起こし結果が商談側にも反映されるようにする。
 */
export async function linkMemoPageAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/memos");

  const oppId = String(formData.get("opportunity_id") ?? "").trim() || null;
  let meetingId = String(formData.get("meeting_id") ?? "").trim() || null;
  let accountId: string | null = null;

  if (oppId) {
    const { data: opp } = await sb.from("opportunities").select("id,account_id").eq("id", oppId).maybeSingle();
    if (!opp) redirect(`/app/memos/${id}?error=${encodeURIComponent("案件が見つかりません")}`);
    accountId = (opp as any).account_id ?? null;
    if (meetingId) {
      // 商談は選択中の案件配下のものだけ許可（画面の作り変え中の取り違えを防ぐ）
      const { data: mt } = await sb
        .from("meetings")
        .select("id")
        .eq("id", meetingId)
        .eq("opportunity_id", oppId)
        .maybeSingle();
      if (!mt) meetingId = null;
    }
  } else {
    meetingId = null;
  }

  const { error } = await sb
    .from("memo_pages")
    .update({ opportunity_id: oppId, meeting_id: meetingId, account_id: accountId })
    .eq("id", id);
  if (error) redirect(`/app/memos/${id}?error=${encodeURIComponent(error.message)}`);

  // ページの録音にも伝播（解除時は録音側の紐付けも外す）
  await sb
    .from("meeting_recordings")
    .update({ opportunity_id: oppId, meeting_id: meetingId, account_id: accountId })
    .eq("memo_page_id", id);

  revalidatePath("/app/memos", "layout");
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`, "layout");
  redirect(`/app/memos/${id}`);
}

/** ページ削除。サブページは残す(トップ階層へ)。ページ専属の録音は実体ごと削除。 */
export async function deleteMemoPageAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/memos");

  // ページに紐づく録音（音声実体の後始末のため先に取得）
  const { data: recs } = await sb
    .from("meeting_recordings")
    .select("id,storage_path,drive_file_id")
    .eq("memo_page_id", id);
  const recRows = (recs ?? []) as { id: string; storage_path: string | null; drive_file_id: string | null }[];

  const { error } = await sb.from("memo_pages").delete().eq("id", id);
  if (error) redirect(`/app/memos/${id}?error=${encodeURIComponent(error.message)}`);

  if (recRows.length) {
    try {
      const admin = getSupabaseAdmin();
      const paths = recRows.map((r) => r.storage_path).filter((p): p is string => !!p);
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);
      const driveIds = recRows.map((r) => r.drive_file_id).filter((f): f is string => !!f);
      if (driveIds.length) {
        const conn = await getActiveConnection(ctx.tenantId, "gdrive");
        if (conn) await Promise.all(driveIds.map((f) => deleteDriveFile(conn, f).catch(() => ({ ok: false }))));
      }
      await sb.from("meeting_recordings").delete().in("id", recRows.map((r) => r.id));
    } catch {
      /* 実体削除失敗は許容（行は on delete set null で残っても参照不能なだけ） */
    }
  }

  revalidatePath("/app/memos", "layout");
  redirect("/app/memos");
}
