import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { getActiveConnection } from "@/lib/storage/connections";
import { deleteDriveFile } from "@/lib/storage/gdrive";
import { buildTranscriptBody, isBlankBody } from "@/lib/memo";

export const dynamic = "force-dynamic";

/**
 * 商談録音の文字起こし処理キュー（夜間バッチ＝Claude Codeコンテナから叩く）。
 *  - GET  : 未処理の録音を最大 limit 件返す（署名DL URL＋要約用コンテキスト付き）。
 *           あわせて期限切れ(30日)の音声実体を掃除する。返した録音は transcribing に遷移。
 *  - POST : 文字起こし＋要約の結果を書き戻す（done/failed）。
 * 認可: Authorization: Bearer <CRON_SECRET>。
 */

const BUCKET = "recordings";

function auth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return null;
}

export async function GET(req: Request) {
  const bad = auth(req);
  if (bad) return bad;
  const admin = getSupabaseAdmin();
  const url = new URL(req.url);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));

  // 期限切れ音声の掃除（transcript/summary は残す。storage_path/drive_file_id を null に）
  let cleaned = 0;
  try {
    const { data: expired } = await admin
      .from("meeting_recordings")
      .select("id, tenant_id, storage_path, drive_file_id")
      .or("storage_path.not.is.null,drive_file_id.not.is.null")
      .lt("expires_at", new Date().toISOString())
      .limit(200);
    const rows = (expired ?? []) as { id: string; tenant_id: string; storage_path: string | null; drive_file_id: string | null }[];
    if (rows.length) {
      const sbPaths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
      if (sbPaths.length) await admin.storage.from(BUCKET).remove(sbPaths);
      // ドライブ保存分はテナント毎の組織接続で削除(P1.6)
      const connCache = new Map<string, Awaited<ReturnType<typeof getActiveConnection>>>();
      for (const r of rows) {
        if (!r.drive_file_id) continue;
        if (!connCache.has(r.tenant_id)) connCache.set(r.tenant_id, await getActiveConnection(r.tenant_id, "gdrive"));
        const conn = connCache.get(r.tenant_id);
        if (conn) await deleteDriveFile(conn, r.drive_file_id).catch(() => ({ ok: false }));
      }
      await admin.from("meeting_recordings").update({ storage_path: null, drive_file_id: null }).in("id", rows.map((r) => r.id));
      cleaned = rows.length;
    }
  } catch {
    /* 掃除失敗は無視 */
  }

  // 未処理を取得（uploaded 優先、詰まった transcribing(2h超)も回収）。音声実体はSupabase/ドライブどちらでも可
  const cols = "id, storage_path, drive_file_id, mime_type, title, duration_sec, meeting_id, opportunity_id, account_id, memo_page_id";
  const hasAudio = "storage_path.not.is.null,drive_file_id.not.is.null";
  const { data: a } = await admin
    .from("meeting_recordings")
    .select(cols)
    .eq("status", "uploaded")
    .or(hasAudio)
    .order("created_at", { ascending: true })
    .limit(limit);
  let picked = (a ?? []) as any[]; /* eslint-disable-line @typescript-eslint/no-explicit-any */
  if (picked.length < limit) {
    const staleIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data: b } = await admin
      .from("meeting_recordings")
      .select(cols)
      .eq("status", "transcribing")
      .lt("updated_at", staleIso)
      .or(hasAudio)
      .order("created_at", { ascending: true })
      .limit(limit - picked.length);
    picked = picked.concat((b ?? []) as any[]); /* eslint-disable-line @typescript-eslint/no-explicit-any */
  }

  if (picked.length === 0) return NextResponse.json({ ok: true, cleaned, items: [] });

  // 要約用コンテキスト（商談名/顧客名/案件名）
  const meetingIds = Array.from(new Set(picked.map((r) => r.meeting_id).filter(Boolean)));
  const oppIds = Array.from(new Set(picked.map((r) => r.opportunity_id).filter(Boolean)));
  const accIds = Array.from(new Set(picked.map((r) => r.account_id).filter(Boolean)));
  const memoIds = Array.from(new Set(picked.map((r) => r.memo_page_id).filter(Boolean)));
  const [mR, oR, aR, pR] = await Promise.all([
    meetingIds.length ? admin.from("meetings").select("id, title, meeting_date").in("id", meetingIds) : Promise.resolve({ data: [] as any[] }),
    oppIds.length ? admin.from("opportunities").select("id, name").in("id", oppIds) : Promise.resolve({ data: [] as any[] }),
    accIds.length ? admin.from("accounts").select("id, name").in("id", accIds) : Promise.resolve({ data: [] as any[] }),
    memoIds.length ? admin.from("memo_pages").select("id, title").in("id", memoIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const mMap = new Map((mR.data ?? []).map((m: any) => [m.id, m])); /* eslint-disable-line @typescript-eslint/no-explicit-any */
  const oMap = new Map((oR.data ?? []).map((o: any) => [o.id, o.name])); /* eslint-disable-line @typescript-eslint/no-explicit-any */
  const aMap = new Map((aR.data ?? []).map((x: any) => [x.id, x.name])); /* eslint-disable-line @typescript-eslint/no-explicit-any */
  const pMap = new Map((pR.data ?? []).map((x: any) => [x.id, x.title])); /* eslint-disable-line @typescript-eslint/no-explicit-any */

  // 音声DLはアプリ経由のプロキシで配信する（CCR実行環境は supabase.co へ直接到達できないため）。
  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
  const items = [];
  for (const r of picked) {
    const audioUrl = `${base}/api/cron/recordings/audio?id=${encodeURIComponent(r.id)}`;
    const m = r.meeting_id ? mMap.get(r.meeting_id) : null;
    items.push({
      id: r.id,
      audioUrl,
      mimeType: r.mime_type ?? "audio/webm",
      durationSec: r.duration_sec ?? null,
      title: r.title ?? m?.title ?? (r.memo_page_id ? pMap.get(r.memo_page_id) ?? null : null) ?? "商談",
      meetingTitle: m?.title ?? null,
      meetingDate: m?.meeting_date ?? null,
      accountName: r.account_id ? aMap.get(r.account_id) ?? null : null,
      oppName: r.opportunity_id ? oMap.get(r.opportunity_id) ?? null : null,
      memoPageTitle: r.memo_page_id ? pMap.get(r.memo_page_id) ?? null : null,
    });
  }
  // 二重処理防止に transcribing へ
  await admin.from("meeting_recordings").update({ status: "transcribing" }).in("id", picked.map((r) => r.id));

  return NextResponse.json({ ok: true, cleaned, items });
}

export async function POST(req: Request) {
  const bad = auth(req);
  if (bad) return bad;
  const admin = getSupabaseAdmin();
  let body: any; /* eslint-disable-line @typescript-eslint/no-explicit-any */
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  if (body.ok === false) {
    await admin.from("meeting_recordings").update({ status: "failed", error: String(body.error ?? "処理に失敗").slice(0, 500), processed_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 200000) : null;
  const summary = typeof body.summary === "string" ? body.summary.slice(0, 20000) : null;
  const source = ["whisper", "tldv"].includes(body.source) ? body.source : "whisper";

  const { data: rec, error } = await admin
    .from("meeting_recordings")
    .update({ status: "done", transcript, summary, transcript_source: source, error: null, processed_at: new Date().toISOString() })
    .eq("id", id)
    .select("meeting_id, memo_page_id")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 商談へ非破壊で反映（空欄のときだけ埋める）
  const meetingId = (rec as { meeting_id: string | null } | null)?.meeting_id ?? null;
  if (meetingId && (summary || transcript)) {
    try {
      const { data: mt } = await admin.from("meetings").select("ai_summary, minutes_detail").eq("id", meetingId).maybeSingle();
      const patch: Record<string, unknown> = {};
      if (summary && !((mt as any)?.ai_summary ?? "").trim()) { patch.ai_summary = summary; patch.ai_summary_at = new Date().toISOString(); } /* eslint-disable-line @typescript-eslint/no-explicit-any */
      if (transcript && !((mt as any)?.minutes_detail ?? "").trim()) patch.minutes_detail = transcript; /* eslint-disable-line @typescript-eslint/no-explicit-any */
      if (Object.keys(patch).length) await admin.from("meetings").update(patch).eq("id", meetingId);
    } catch {
      /* 商談反映失敗は無視（録音側には保存済み） */
    }
  }

  // メモ・議事録ページへ非破壊で反映（本文が空のときだけ埋める）
  const memoPageId = (rec as { memo_page_id: string | null } | null)?.memo_page_id ?? null;
  if (memoPageId && (summary || transcript)) {
    try {
      const { data: page } = await admin.from("memo_pages").select("body").eq("id", memoPageId).maybeSingle();
      if (isBlankBody((page as { body?: string | null } | null)?.body)) {
        const body = buildTranscriptBody({ summary, transcript });
        if (body) await admin.from("memo_pages").update({ body }).eq("id", memoPageId);
      }
    } catch {
      /* ページ反映失敗は無視（録音側には保存済み） */
    }
  }
  return NextResponse.json({ ok: true });
}
