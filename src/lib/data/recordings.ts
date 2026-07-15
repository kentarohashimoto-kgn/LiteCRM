import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "recordings";

export type RecordingRow = {
  id: string;
  title: string | null;
  status: string;
  duration_sec: number | null;
  size_bytes: number | null;
  transcript: string | null;
  transcript_source: string | null;
  summary: string | null;
  error: string | null;
  created_at: string;
  audioUrl: string | null; // 署名URL(1時間・再生用)。音声が削除済み/未設定なら null。
};

/** 商談に紐づく録音一覧（新しい順）。RLSで参照権限を担保。 */
export async function listMeetingRecordings(meetingId: string): Promise<RecordingRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("meeting_recordings")
    .select("id,title,status,duration_sec,size_bytes,transcript,transcript_source,summary,error,storage_path,created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data ?? []) as any[];
  const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[];
  let urls = new Map<string, string>();
  if (paths.length) {
    try {
      const admin = getSupabaseAdmin();
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
      urls = new Map(
        (signed ?? [])
          .filter((s): s is typeof s & { signedUrl: string; path: string } => Boolean(s.signedUrl && s.path))
          .map((s) => [s.path, s.signedUrl]),
      );
    } catch {
      /* service role 未設定時は再生URLなし */
    }
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? null,
    status: r.status,
    duration_sec: r.duration_sec ?? null,
    size_bytes: r.size_bytes ?? null,
    transcript: r.transcript ?? null,
    transcript_source: r.transcript_source ?? null,
    summary: r.summary ?? null,
    error: r.error ?? null,
    created_at: r.created_at,
    audioUrl: r.storage_path ? urls.get(r.storage_path) ?? null : null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
