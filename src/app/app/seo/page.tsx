import Link from "next/link";
import { Search, Settings2, AlertTriangle } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { listSeoSites, getSeoFunnel, getCrmRates } from "@/lib/data/seo";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const num = (n: number) => n.toLocaleString("ja-JP");
const pct = (n: number | null, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

/**
 * SEO集客サマリー（WO-30）。
 *
 * 「表示回数 → クリック → セッション → 問合せ → 有効リード」のKPIツリーを
 * 実測値で1本に並べる。順位やCTRではなく、最後は必ず件数と金額に着地させる。
 */
export default async function SeoPage({ searchParams }: { searchParams: { site?: string } }) {
  await requireCtx();
  const sites = await listSeoSites();
  const active = sites.filter((s) => s.status === "active");

  if (!sites.length) {
    return (
      <div>
        <PageHeader title="SEO集客" subtitle="検索からの集客を、問合せ・商談・売上まで一本で追跡します。" />
        <EmptyState message="計測サイトが未登録です。マイグレーション 0180 を適用してください。" />
      </div>
    );
  }

  const current = active.find((s) => s.id === searchParams.site) ?? active[0] ?? sites[0];
  const [funnel, rates] = await Promise.all([getSeoFunnel(current.id, 30), getCrmRates()]);
  const connected = current.gscStatus === "ok";
  const hasData = funnel.impressions > 0 || funnel.sessions > 0 || funnel.inquiries > 0;

  // 有効リード → 商談 → 受注 の期待値（CRM実績のレートを使う）
  const expectedRevenue =
    rates.winRate != null && rates.medianDealAmount != null
      ? funnel.leadsValid * 0.25 * rates.winRate * rates.medianDealAmount
      : null;

  const steps = [
    { label: "表示回数", value: num(funnel.impressions), note: funnel.position ? `平均掲載順位 ${funnel.position}位` : "" },
    { label: "クリック", value: num(funnel.clicks), note: `CTR ${pct(funnel.ctr, 2)}` },
    { label: "セッション", value: num(funnel.sessions), note: "GA4 オーガニック" },
    {
      label: "問合せ",
      value: num(funnel.inquiries),
      note: funnel.sessions ? `CVR ${pct(funnel.inquiries / funnel.sessions, 2)}` : "",
    },
    { label: "有効リード", value: num(funnel.leadsValid), note: "対象外を除く" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="SEO集客"
        subtitle={`${current.name}（直近30日）— 検索からの集客を、問合せ・商談・売上まで一本で追跡します。`}
        action={
          <Link href="/app/seo/settings" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
            <Settings2 size={14} />
            接続設定
          </Link>
        }
      />

      {active.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {active.map((s) => (
            <Link
              key={s.id}
              href={`/app/seo?site=${s.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                s.id === current.id
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-black/10 text-ink/60 hover:bg-black/[0.03]"
              }`}
            >
              {s.name}
              <span className="ml-1 text-ink/40">{s.audience.toUpperCase()}</span>
            </Link>
          ))}
        </div>
      )}

      {!connected && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">Search Console にまだ接続されていません。</p>
            <p className="mt-0.5 text-xs">
              <Link href="/app/seo/settings" className="underline">
                接続設定
              </Link>
              でサービスアカウントを登録し、「接続診断」を実行してください。アクセスできるプロパティが一覧表示されます。
            </p>
          </div>
        </div>
      )}

      <Section title="集客ファネル（直近30日）" icon={<Search size={15} />}>
        {!hasData ? (
          <EmptyState message="まだ計測データがありません。接続設定の完了後、翌日の取込（毎日04:00）から表示されます。" />
        ) : (
          <div className="grid gap-3 md:grid-cols-5">
            {steps.map((s) => (
              <div key={s.label} className="rounded-lg border border-black/[0.06] p-3">
                <div className="text-xs text-ink/50">{s.label}</div>
                <div className="mt-0.5 text-xl font-bold text-ink">{s.value}</div>
                {s.note && <div className="mt-0.5 text-xs text-ink/40">{s.note}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="売上への換算（CRM実績ベース）">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-black/[0.06] p-3">
            <div className="text-xs text-ink/50">成約率（直近1年）</div>
            <div className="mt-0.5 text-xl font-bold">{pct(rates.winRate)}</div>
            <div className="text-xs text-ink/40">
              受注 {rates.wonCount} / 失注 {rates.lostCount}
            </div>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <div className="text-xs text-ink/50">受注単価（中央値）</div>
            <div className="mt-0.5 text-xl font-bold">
              {rates.medianDealAmount == null ? "—" : yen(rates.medianDealAmount)}
            </div>
            <div className="text-xs text-ink/40">大型案件に引きずられない中央値を使用</div>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <div className="text-xs text-ink/50">今の流入が生む売上見込み/月</div>
            <div className="mt-0.5 text-xl font-bold text-teal-700">
              {expectedRevenue == null ? "—" : yen(expectedRevenue)}
            </div>
            <div className="text-xs text-ink/40">有効リード × 商談化25%(仮) × 成約率 × 単価</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/50">
          商談化率は現在、リードと商談の紐付け（<code>lead_id</code>）が全商談の2%しかないため実測できず、仮の25%を用いています。
          WO-31（アトリビューション）でHP問合せリードの案件化時に紐付けを必須化し、実測値に置き換えます。
        </p>
      </Section>
    </div>
  );
}
