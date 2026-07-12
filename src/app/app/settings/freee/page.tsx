import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireFinanceCtx } from "@/lib/session";
import { getFreeeOverview } from "@/lib/data/freee";
import { PageHeader } from "@/components/ui/primitives";
import { FreeePanel } from "@/components/settings/freee-panel";

export const dynamic = "force-dynamic";

/**
 * freee 会計連携（設定）。接続・取引先の名寄せ承認・請求書一覧・連携ログ。
 * 経理(finance)/代表/管理者のみ。
 */
export default async function FreeeSettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireFinanceCtx();
  const overview = await getFreeeOverview();

  return (
    <div>
      <div className="print:hidden">
        <Link href="/app/settings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
          <ChevronLeft size={16} /> 設定へ戻る
        </Link>
      </div>
      <PageHeader
        title="freee 会計連携"
        subtitle="見積・請求（検収時）・入金消込を freee 会計と連携します。マスタの名称変更は都度確認、伝票は下書き→承認→発行の流れです。"
      />
      {searchParams.ok && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-4">{searchParams.ok}</p>}
      {searchParams.error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-4">{searchParams.error}</p>}
      <FreeePanel overview={overview} />
    </div>
  );
}
