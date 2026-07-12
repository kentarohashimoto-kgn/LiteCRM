import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { getBatchDashboard } from "@/lib/data/batch-runs";
import { BatchDashboardView } from "@/components/exec/batch-dashboard";

export const dynamic = "force-dynamic";

/**
 * AIバッチ運用ダッシュボード。
 * 夜間バッチ(方針A / Claude Code方式・従量課金ゼロ)の運用ログを可視化し、
 * 週次でトークン利用枠への到達・処理量・夜間割合を振り返って調整する(要望c)。
 */
export default async function BatchOpsPage() {
  await requireCtx();
  const data = await getBatchDashboard();

  return (
    <div>
      <PageHeader
        title="AIバッチ運用"
        subtitle="夜間バッチ(03:00 JST)がClaudeサブスク枠で生成した下書きの実績。利用枠への到達回数・処理量・夜間割合を見て、1晩の上限や実行時刻を調整します。"
      />
      <BatchDashboardView data={data} />
    </div>
  );
}
