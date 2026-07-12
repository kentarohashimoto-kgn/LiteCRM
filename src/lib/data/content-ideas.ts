import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * B8 マーケ記事パイプラインのデータ取得。ネタ→選定→ドラフト→公開の状態管理。
 */

export type ContentStatus = "idea" | "selected" | "drafting" | "published";
export type DesignStatus = "none" | "ready" | "linked" | "manual";

export type ContentIdea = {
  id: string;
  theme: string | null;
  title: string;
  angle: string | null;
  target_keyword: string | null;
  source: "manual" | "sales_need" | "web_trend";
  status: ContentStatus;
  design_status: DesignStatus;
  hasDraft: boolean;
  note: string | null;
  scheduled_date: string | null;
  created_at: string;
};

export type ContentIdeaFull = ContentIdea & { body_md: string | null };

export const CONTENT_STATUS_ORDER: ContentStatus[] = ["idea", "selected", "drafting", "published"];

type ListRow = Omit<ContentIdea, "hasDraft"> & { body_md: string | null };

export async function listContentIdeas(status: string): Promise<ContentIdea[]> {
  const sb = getSupabaseServer();
  let query = sb
    .from("content_ideas")
    .select("id,theme,title,angle,target_keyword,source,status,design_status,body_md,note,scheduled_date,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status && CONTENT_STATUS_ORDER.includes(status as ContentStatus)) {
    query = query.eq("status", status);
  }
  const { data } = await query;
  return ((data ?? []) as ListRow[]).map(({ body_md, ...rest }) => ({
    ...rest,
    hasDraft: !!body_md?.trim(),
  }));
}

/** 記事詳細(本文込み)。 */
export async function getContentIdea(id: string): Promise<ContentIdeaFull | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("content_ideas")
    .select("id,theme,title,angle,target_keyword,source,status,design_status,body_md,note,scheduled_date,created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as ListRow;
  return { ...row, hasDraft: !!row.body_md?.trim() };
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
