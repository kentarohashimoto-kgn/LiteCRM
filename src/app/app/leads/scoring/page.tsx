import Link from "next/link";
import { ChevronLeft, BookOpen } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { ScoringDesigner, type AxisRow, type RuleRow } from "@/components/leads/scoring-designer";

export const dynamic = "force-dynamic";

/**
 * リードスコア設計(F-201): Fitスコアの軸(上限点)とルール(条件→点数)を編集する。
 * 保存すると全リードを再スコアし、ランク分布を表示する。閲覧は全員・編集は管理職。
 */
export default async function LeadScoringPage() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [{ data: axes }, { data: rules }] = await Promise.all([
    sb.from("lead_scoring_axes").select("axis, label, cap, agg, sort_order").order("sort_order"),
    sb.from("lead_scoring_rules").select("id, axis, label, match_kind, match_value, points, sort_order, is_active").order("sort_order"),
  ]);
  const canEdit = ["owner", "admin", "sales_manager"].includes(ctx.role);

  return (
    <div>
      <PageHeader
        title="リードスコア設計"
        subtitle="優先順位付け(Fitスコア)の判断基準を編集します。保存すると全リードが新しいルールで再スコアされます。"
        action={
          <div className="flex items-center gap-2">
            <a href="/help/lead-mail.html#score" target="_blank" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
              <BookOpen size={14} /> ロジックの解説（マニュアル）
            </a>
            <Link href="/app/leads" className="btn-ghost inline-flex items-center gap-1 text-sm">
              <ChevronLeft size={15} /> リード一覧へ
            </Link>
          </div>
        }
      />
      <ScoringDesigner
        axes={(axes ?? []) as AxisRow[]}
        rules={(rules ?? []) as RuleRow[]}
        canEdit={canEdit}
      />
    </div>
  );
}
