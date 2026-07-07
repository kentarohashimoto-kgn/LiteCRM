import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { listXraySnapshotsAction } from "@/server/actions/xray";
import { XrayHistoryList } from "@/components/analytics/xray-history-list";

export const dynamic = "force-dynamic";

/** 営業レントゲンの保存済みスナップショット一覧。過去に遡って診断結果を参照できる。 */
export default async function XrayHistoryPage() {
  const items = await listXraySnapshotsAction();

  return (
    <div>
      <Link href="/app/analytics/xray" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 営業レントゲンへ戻る
      </Link>
      <PageHeader
        title="分析履歴（営業レントゲン）"
        subtitle="保存された診断結果の一覧。毎月1日に前月分が自動保存されるほか、任意のタイミングで手動保存できます。行をクリックすると保存時点の診断を表示します。"
      />
      <XrayHistoryList items={items} />
    </div>
  );
}
