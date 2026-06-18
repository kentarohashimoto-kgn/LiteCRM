import { buildTrends } from "@/lib/data/trends";
import { TREND_SCOPES } from "@/lib/trends";
import { PageHeader } from "@/components/ui/primitives";
import { TrendsWorkspace } from "@/components/analytics/trends-workspace";

export default async function TrendsPage({ searchParams }: { searchParams: { scope?: string } }) {
  const scope = TREND_SCOPES.some((s) => s.key === searchParams.scope) ? (searchParams.scope as string) : "all";
  const data = await buildTrends(scope);
  return (
    <div>
      <PageHeader
        title="トレンド分析"
        subtitle="対象範囲（受注/Aヨミ/Bヨミ等）を絞り込み、エリア・業種・規模・部署・ABC・コホート・流入で顧客分布を可視化します。"
      />
      <TrendsWorkspace data={data} scope={scope} />
    </div>
  );
}

export const dynamic = "force-dynamic";
