import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { SubTabs } from "@/components/ui/sub-tabs";
import { REP_TABS } from "@/components/reviews/rep-nav";
import { ActionNotice } from "@/components/ui/action-notice";
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
  searchParams: { owner?: string; week?: string; saved?: string; error?: string };
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
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-semibold">
            <Link href="/app/reviews/yomi-history" className="text-teal-primary hover:underline">ヨミ変更履歴 →</Link>
            <Link href="/app/reviews/snapshots" className="text-teal-primary hover:underline">週報スナップショット →</Link>
          </div>
        }
      />
      <SubTabs tabs={REP_TABS} />
      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          report: "週報を保存しました（自動集計サマリーもスナップショットしました）。",
          opp: "案件の読み・メモを保存しました。",
          target: "個人目標を保存しました。上部の「今月 目標」に反映されています。",
        }}
        errorMessages={{
          invalid_month: "月の形式が不正で保存できませんでした。",
          invalid_amount: "金額が不正で保存できませんでした。",
          save_failed: "保存に失敗しました。もう一度お試しください。",
        }}
      />
      <RepReportView report={report} weekStart={week} />
    </div>
  );
}
