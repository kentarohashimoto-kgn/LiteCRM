import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * B7 ノウハウ・事例ナレッジのデータ取得。
 * v1は全件(RLSで自テナント)を取得し、テキスト部分一致はJS側で行う(日本語対応・PostgREST or注入回避)。
 */

export type KnowledgeKind = "knowhow" | "win_reason" | "loss_reason" | "case_study";

export type KnowledgeEntry = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  is_own_company: boolean;
  industry: string | null;
  competitor: string | null;
  tags: string[];
  created_at: string;
};

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("knowledge_entries")
    .select("id,kind,title,body,is_own_company,industry,competitor,tags,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as KnowledgeEntry[];
}

/** テキスト(タイトル/本文/タグ/業種/競合)への部分一致フィルタ。 */
export function filterKnowledge(entries: KnowledgeEntry[], q: string, kind: string): KnowledgeEntry[] {
  const needle = q.trim().toLowerCase();
  return entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (!needle) return true;
    const hay = [e.title, e.body, e.industry ?? "", e.competitor ?? "", (e.tags ?? []).join(" ")]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}
