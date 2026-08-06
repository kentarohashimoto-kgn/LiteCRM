import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
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
  // 初期表示は絞り込みなし。営業担当・エリアの選択肢だけ併せて取る(顧客一覧と同じ作り)
  const sb = getSupabaseServer();
  const [matrix, ownersR, areaR] = await Promise.all([
    getAccountMatrix(),
    sb.from("profiles").select("id,display_name,email"),
    sb.from("accounts").select("area"),
  ]);
  const owners = (ownersR.data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.display_name as string) ?? (p.email as string) ?? "—",
  }));
  const areas = Array.from(
    new Set((areaR.data ?? []).map((a) => a.area as string | null).filter((a): a is string => !!a))
  ).sort((a, b) => a.localeCompare(b, "ja"));

  return (
    <div>
      <PageHeader
        title="顧客分析マトリクス"
        subtitle="セグメント（業界）×ランクで顧客の分布を把握。営業担当・会社規模・取引額・取引時期で絞り込み、会社名検索でどのセルに居るかを確認できます。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <Link href="/app/accounts" className="text-xs font-semibold text-teal-primary hover:underline">顧客一覧 →</Link>
            <Link href="/app/srank" className="text-xs font-semibold text-teal-primary hover:underline">Sランク攻略 →</Link>
          </div>
        }
      />
      <SegmentRankMatrix matrix={matrix} owners={owners} areas={areas} />
    </div>
  );
}
