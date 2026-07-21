import { getSupabaseServer } from "@/lib/supabase/server";

export interface AccountNote {
  id: string;
  account_id: string;
  author_user_id: string | null;
  title: string | null;
  body: string;
  kind: string; // 'general' | 'ai_research'
  satisfaction_score: number | null;
  potential_score: number | null;
  source_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** 顧客に紐づく顧客メモを新しい順で取得する。 */
export async function listAccountNotes(accountId: string): Promise<AccountNote[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("account_notes")
    .select(
      "id, account_id, author_user_id, title, body, kind, satisfaction_score, potential_score, source_summary, created_at, updated_at",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  return (data ?? []) as AccountNote[];
}
