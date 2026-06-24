/** セミナー攻略リストのデータ取得(RPC seminar_followup / seminar_list、RLS準拠)。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { scoreFollowup, type FollowupParticipant, type FollowupScore } from "@/lib/seminar-followup";

export interface SeminarOption {
  name: string;
  participants: number;
  last_at: string | null;
}
export interface FollowupRow extends FollowupParticipant {
  score: FollowupScore;
}

export async function listSeminars(): Promise<SeminarOption[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("seminar_list");
  return (data ?? []) as SeminarOption[];
}

export async function getSeminarFollowup(seminar: string): Promise<FollowupRow[]> {
  const sb = getSupabaseServer();
  // セミナー名はUnicode正規化(NFC)で突合。URLパラメータ等で結合文字(NFD)が混入しても一致させる。
  const key = (seminar ?? "").normalize("NFC");
  const { data, error } = await sb.rpc("seminar_followup", { p_seminar: key });
  if (error) {
    // 失敗を握りつぶさず可視化(タイムアウト等の早期検知)。
    console.error("seminar_followup RPC error:", error.message, { seminar: key });
  }
  const rows = (data ?? []) as FollowupParticipant[];
  const scored = rows.map((r) => ({ ...r, score: scoreFollowup(r) }));
  // 優先度(スコア)降順。同点は回答日時の新しい順。
  scored.sort((a, b) => b.score.total - a.score.total || (b.responded_at ?? "").localeCompare(a.responded_at ?? ""));
  return scored;
}
