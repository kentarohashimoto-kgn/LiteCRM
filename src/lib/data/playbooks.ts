import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * B1 カトルセの型(営業プレイブック)のデータ取得。
 * v1は全件(RLSで自テナント)取得＋JS側で部分一致/属性フィルタ。
 */

export type Playbook = {
  id: string;
  title: string;
  industry: string | null;
  employee_size_band: string | null;
  target_role: string | null;
  hypothesis_issues: string | null;
  value_props: string | null;
  key_questions: string | null;
  proposal_flow: string | null;
  objections: string | null;
  decision_tips: string | null;
  status: "draft" | "active" | "archived";
  win_count: number;
  loss_count: number;
  created_at: string;
};

export async function listPlaybooks(): Promise<Playbook[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("sales_playbooks")
    .select(
      "id,title,industry,employee_size_band,target_role,hypothesis_issues,value_props,key_questions,proposal_flow,objections,decision_tips,status,win_count,loss_count,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as Playbook[];
}

export function filterPlaybooks(items: Playbook[], q: string, industry: string): Playbook[] {
  const needle = q.trim().toLowerCase();
  return items.filter((p) => {
    if (p.status === "archived") return false;
    if (industry && (p.industry ?? "") !== industry) return false;
    if (!needle) return true;
    const hay = [
      p.title,
      p.industry ?? "",
      p.target_role ?? "",
      p.hypothesis_issues ?? "",
      p.value_props ?? "",
      p.key_questions ?? "",
      p.objections ?? "",
      p.decision_tips ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}
