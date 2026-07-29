import Link from "next/link";
import { Search, Settings2, AlertTriangle, Target, Zap, Lightbulb, ClipboardList } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import {
  listSeoSites,
  getSeoFunnel,
  getCrmRates,
  getAttributionHealth,
  getSeoPageRevenue,
  getOpenInsights,
} from "@/lib/data/seo";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const num = (n: number) => n.toLocaleString("ja-JP");
const pct = (n: number | null, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

/** 検出種別の日本語ラベル。何が起きているかを一目で分かるようにする。 */
const KIND_LABEL: Record<string, string> = {
  intent_mix: "戦略",
  zero_click: "クリック0",
  ctr_opportunity: "CTR損失",
  striking_distance: "あと一歩",
  rank_decline: "順位低下",
  click_drop: "クリック減",
  cannibalization: "競合",
};

/**
 * SEO集客サマリー（WO-30）。
 *
 * 「表示回数 → クリック → セッション → 問合せ → 有効リード」のKPIツリーを
 * 実測値で1本に並べる。順位やCTRではなく、最後は必ず件数と金額に着地させる。
 */
export default async function SeoPage({ searchParams }: { searchParams: { site?: string } }) {
  const ctx = await requireCtx();
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
  const [funnel, rates, health, pageRevenue, insights] = await Promise.all([
    getSeoFunnel(current.id, 30),
    getCrmRates(),
    getAttributionHealth(ctx.tenantId, 90),
    getSeoPageRevenue(current.id, 30, 10),
    getOpenInsights(current.id, 12),
  ]);
  const connected = current.gscStatus === "ok";
  const hasData = funnel.impressions > 0 || funnel.sessions > 0 || funnel.inquiries > 0;

  // 実測の受注が出るまでの間、今の流入が生む売上の見込みを示す（CRM実績のレートを使う）
  const expectedRevenue =
    rates.winRate != null && rates.medianDealAmount != null
      ? funnel.leadsValid * (funnel.leadToOpp ?? 0.25) * rates.winRate * rates.medianDealAmount
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
    {
      label: "商談",
      value: num(funnel.opportunities),
      note: funnel.leadToOpp != null ? `商談化 ${pct(funnel.leadToOpp)}` : "",
    },
    {
      label: "受注",
      value: `${num(funnel.won)}件`,
      note: funnel.revenue > 0 ? yen(funnel.revenue) : "",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="SEO集客"
        subtitle={`${current.name}（直近30日）— 検索からの集客を、問合せ・商談・売上まで一本で追跡します。`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/proposals" className="btn-accent inline-flex items-center gap-1.5 text-sm">
              <Lightbulb size={14} />
              改善提案
            </Link>
            <Link href="/app/seo/actions" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <ClipboardList size={14} />
              施策の実行
            </Link>
            <Link href="/app/seo/strategy" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Target size={14} />
              戦略ボード
            </Link>
            <Link href="/app/seo/settings" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Settings2 size={14} />
              接続設定
            </Link>
          </div>
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
          <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
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

      {/* 機械検出した機会・劣化。毎日同じ基準で出るので、朝これだけ見れば打ち手が決まる。 */}
      {insights.length > 0 && (
        <Section title={`今日の要対応（${insights[0].runDate} 時点・機会スコア順）`} icon={<Zap size={15} />}>
          <ul className="space-y-2">
            {insights.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-lg border border-black/[0.06] p-3 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    i.severity === "high"
                      ? "bg-rose-50 text-rose-700"
                      : i.severity === "medium"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-black/[0.04] text-ink/50"
                  }`}
                >
                  {KIND_LABEL[i.kind] ?? i.kind}
                </span>
                <div className="min-w-0">
                  <div className="break-words">{i.title}</div>
                  <div className="mt-0.5 text-xs text-ink/45">
                    {i.pagePath && <span className="mr-2 break-all">{i.pagePath}</span>}
                    {typeof i.metric.extraClicks === "number" && (
                      <span className="mr-2">見込み +{num(Number(i.metric.extraClicks))}クリック/月</span>
                    )}
                    {typeof i.metric.impressions === "number" && (
                      <span>表示 {num(Number(i.metric.impressions))}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink/50">
            検出は毎日同じ基準で機械的に行われます。承認できる形の提案は{" "}
            <Link href="/app/seo/proposals" className="underline">
              改善提案
            </Link>
            で確認できます。
          </p>
        </Section>
      )}

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
            <div className="text-xs text-ink/40">
              有効リード × 商談化{funnel.leadToOpp != null ? pct(funnel.leadToOpp) : "25%(仮)"} × 成約率 × 単価
            </div>
          </div>
        </div>
      </Section>

      {/* 「どの記事が稼いだか」— 一般のSEOツールには出せない、CRM一体型ならではの表 */}
      <Section title="ページ別の売上貢献（直近30日）">
        {pageRevenue.length === 0 ? (
          <EmptyState message="まだデータがありません。取込の開始後に表示されます。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-black/[0.06] text-xs text-ink/50">
                  <th className="py-2 text-left font-medium">ページ</th>
                  <th className="py-2 text-right font-medium">クリック</th>
                  <th className="py-2 text-right font-medium">問合せ</th>
                  <th className="py-2 text-right font-medium">商談</th>
                  <th className="py-2 text-right font-medium">受注</th>
                  <th className="py-2 text-right font-medium">受注金額</th>
                </tr>
              </thead>
              <tbody>
                {pageRevenue.map((r) => (
                  <tr key={r.pagePath} className="border-b border-black/[0.03]">
                    <td className="py-2 pr-3 break-all">{r.pagePath}</td>
                    <td className="py-2 text-right">{num(r.clicks)}</td>
                    <td className="py-2 text-right">{num(r.inquiries)}</td>
                    <td className="py-2 text-right">{num(r.opportunities)}</td>
                    <td className="py-2 text-right">{num(r.won)}</td>
                    <td className="py-2 text-right font-medium">{r.revenue > 0 ? yen(r.revenue) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 紐付けが切れていると、集客がどれだけ成功しても売上が¥0に見える。常時可視化する。 */}
      {health && (
        <Section title="アトリビューション健全性（直近90日）">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-lg border border-black/[0.06] p-3">
              <div className="text-xs text-ink/50">商談がリードに紐付いている割合</div>
              <div
                className={`mt-0.5 text-xl font-bold ${
                  (health.linkRate ?? 0) < 0.5 ? "text-rose-600" : "text-ink"
                }`}
              >
                {pct(health.linkRate)}
              </div>
              <div className="text-xs text-ink/40">
                {num(health.opportunitiesLinked)} / {num(health.opportunitiesTotal)} 件
                {health.unlinkedRecent > 0 && `（未紐付け ${num(health.unlinkedRecent)} 件）`}
              </div>
            </div>
            <div className="rounded-lg border border-black/[0.06] p-3">
              <div className="text-xs text-ink/50">問合せリードに着地ページが記録されている割合</div>
              <div
                className={`mt-0.5 text-xl font-bold ${
                  (health.landingRate ?? 0) < 0.5 ? "text-rose-600" : "text-ink"
                }`}
              >
                {pct(health.landingRate)}
              </div>
              <div className="text-xs text-ink/40">
                {num(health.inquiryLeadsWithLanding)} / {num(health.inquiryLeadsTotal)} 件
              </div>
            </div>
          </div>
          {((health.linkRate ?? 1) < 0.5 || (health.landingRate ?? 1) < 0.5) && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">集客の成果を売上として証明できない状態です。</p>
                <p className="mt-0.5">
                  {(health.linkRate ?? 1) < 0.5 &&
                    "商談をリード経由（リード詳細の「案件化」ボタン）で作ると自動で紐付きます。直接作成した商談はSEOの成果に計上されません。"}
                  {(health.landingRate ?? 1) < 0.5 &&
                    "着地ページが記録されていません。HPの問い合わせフォームに landing_page / utm_* を送る設定が必要です（連携手順書を参照）。"}
                </p>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
