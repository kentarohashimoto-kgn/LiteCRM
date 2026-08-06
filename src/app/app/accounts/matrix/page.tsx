import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { getAccountMatrix } from "@/lib/data/account-matrix";
import { PageHeader } from "@/components/ui/primitives";
import { SegmentRankMatrix } from "@/components/accounts/segment-rank-matrix";

export const dynamic = "force-dynamic";

/**
 * 顧客分析マトリクス(セグメント × ランク)。
 * 「どの業界の、どのランクの顧客を何社持っているか」を一覧し、顧客名から詳細に降りる。
 * 権限は顧客一覧(/app/accounts)と同じ requireCtx。取得行は RLS でスコープ済み。
 */
export default async function AccountMatrixPage() {
  await requireCtx();
  const matrix = await getAccountMatrix();

  return (
    <div>
      <PageHeader
        title="顧客分析マトリクス"
        subtitle="セグメント（業界）×ランクで顧客の分布を把握。顧客名をクリックすると右側に顧客・案件の詳細が開きます。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <Link href="/app/accounts" className="text-xs font-semibold text-teal-primary hover:underline">顧客一覧 →</Link>
            <Link href="/app/srank" className="text-xs font-semibold text-teal-primary hover:underline">Sランク攻略 →</Link>
          </div>
        }
      />
      <SegmentRankMatrix matrix={matrix} />
    </div>
  );
}
