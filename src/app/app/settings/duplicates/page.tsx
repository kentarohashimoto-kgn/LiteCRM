import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { DedupePanel } from "@/components/settings/dedupe-panel";
import { fetchDupAccountsAction, fetchDupLeadsAction } from "@/server/actions/dedupe";

export const dynamic = "force-dynamic";

/** B-3 重複検出・マージ: 会社名(正規化)一致の顧客、メール一致のリードを名寄せする。 */
export default async function DuplicatesPage() {
  const ctx = await requireCtx();
  const [accountGroups, leadGroups] = await Promise.all([fetchDupAccountsAction(), fetchDupLeadsAction()]);
  const canMerge = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div>
      <Link href="/app/settings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 設定
      </Link>
      <PageHeader
        title="重複の検出とマージ"
        subtitle="顧客は会社名(正規化)一致、リードはメールアドレス一致で重複候補を提示します。マージすると関連データは残す側へ付け替えられ、重複側はゴミ箱(30日)へ移動します。"
      />
      <DedupePanel accountGroups={accountGroups} leadGroups={leadGroups} canMerge={canMerge} />
    </div>
  );
}
