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
  const { data } = await sb.rpc("seminar_followup", { p_seminar: seminar });
  const rows = (data ?? []) as FollowupParticipant[];
  const scored = rows.map((r) => ({ ...r, score: scoreFollowup(r) }));
  // 優先度(スコア)降順。同点は回答日時の新しい順。
  scored.sort((a, b) => b.score.total - a.score.total || (b.responded_at ?? "").localeCompare(a.responded_at ?? ""));
  return scored;
}
