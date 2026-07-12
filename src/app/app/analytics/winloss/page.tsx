import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { getWinLossAnalysis } from "@/lib/data/win-loss";
import { WinLossView } from "@/components/analytics/win-loss-view";

export const dynamic = "force-dynamic";

/**
 * C-4 失注/成約 分析。なぜ勝ったか・負けたかを 理由コード/競合/カテゴリ で可視化し、
 * 自由記述の失注理由は生記録として振り返れるようにする。
 */
export default async function WinLossPage() {
  await requireCtx();
  const data = await getWinLossAnalysis();

  return (
    <div>
      <PageHeader
        title="失注/成約 分析"
        subtitle="なぜ勝ったか・負けたかを理由・競合・カテゴリで可視化。負け筋を見つけ、型(プレイブック)やノウハウに還元します。"
      />
      <WinLossView data={data} />
    </div>
  );
}
