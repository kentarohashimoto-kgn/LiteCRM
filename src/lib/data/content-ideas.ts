import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * B8 マーケ記事パイプラインのデータ取得。ネタ→選定→ドラフト→公開の状態管理。
 */

export type ContentStatus = "idea" | "selected" | "drafting" | "published";

export type ContentIdea = {
  id: string;
  theme: string | null;
  title: string;
  angle: string | null;
  target_keyword: string | null;
  source: "manual" | "sales_need" | "web_trend";
  status: ContentStatus;
  note: string | null;
  scheduled_date: string | null;
  created_at: string;
};

export const CONTENT_STATUS_ORDER: ContentStatus[] = ["idea", "selected", "drafting", "published"];

export async function listContentIdeas(status: string): Promise<ContentIdea[]> {
  const sb = getSupabaseServer();
  let query = sb
    .from("content_ideas")
    .select("id,theme,title,angle,target_keyword,source,status,note,scheduled_date,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status && CONTENT_STATUS_ORDER.includes(status as ContentStatus)) {
    query = query.eq("status", status);
  }
  const { data } = await query;
  return (data ?? []) as ContentIdea[];
}

/** ステータス別の件数(絞り込みに依らない全体)。 */
export async function contentStatusCounts(): Promise<Record<string, number>> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("content_ideas").select("status").limit(1000);
  const counts: Record<string, number> = { all: 0 };
  for (const r of (data ?? []) as { status: string }[]) {
    counts.all += 1;
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return counts;
}
