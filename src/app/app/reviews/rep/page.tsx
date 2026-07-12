import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { getRepReport } from "@/lib/data/rep-report";
import { RepReportView } from "@/components/reviews/rep-report-view";
import { mondayJst } from "@/lib/data/weekly-snapshot";

export const dynamic = "force-dynamic";

/**
 * 営業マン別 週報。自動集計(目標/実績/見込み/パイプライン/担当案件)＋
 * 先週コメント・来週予定・1ヶ月先予定のナラティブ入力を、型に沿って作成する。
 */
export default async function RepReportPage({
  searchParams,
}: {
  searchParams: { owner?: string; week?: string };
}) {
  const ctx = await requireCtx();
  const owner = searchParams.owner || ctx.userId;
  const week = searchParams.week || mondayJst(new Date());
  const report = await getRepReport(owner, week);

  return (
    <div>
      <PageHeader
        title="営業マン別 週報"
        subtitle="担当ごとの目標・実績・見込み・案件を自動集計。先週の差分と来週/1ヶ月先の予定を型に沿って記入します。"
      />
      <RepReportView report={report} weekStart={week} />
    </div>
  );
}
