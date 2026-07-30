import Link from "next/link";
import { Target, Layers, Route, Search } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { listSeoSites, getSeoFunnel, getCrmRates } from "@/lib/data/seo";
import { getStrategy, getClusterProgress, getIntentCoverage, getMilestones } from "@/lib/data/seo-strategy";
import { buildFunnelTargets, findBottleneck, INTENT_LABELS } from "@/lib/seo/strategy";
import { setMilestoneStatusAction } from "@/server/actions/seo";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const num = (n: number) => Math.round(n).toLocaleString("ja-JP");
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

const PHASE_LABEL: Record<string, string> = {
  phase0: "Phase 0 現状把握",
  phase1: "Phase 1 刈り取り",
  phase2: "Phase 2 クラスタ構築",
  phase3: "Phase 3 拡張",
  phase4: "Phase 4 積み上げ",
};

/**
 * SEO戦略ボード（F-306）。
 *
 * 戦略は書いた瞬間から風化する。この画面は docs/SEO_STRATEGY_2026-07.md の
 * 各章を実測値で毎日置き換え続けることで、「今どこまで進み、どこがズレたか」を
 * 見える状態に保つ。日次の改善が戦略から離れるのを防ぐのが目的。
 */
export default async function SeoStrategyPage({
  searchParams,
}: {
  searchParams: { site?: string; saved?: string; error?: string };
}) {
  await requireCtx();
  const sites = await listSeoSites();
  const active = sites.filter((s) => s.status === "active");
  const current = active.find((s) => s.id === searchParams.site) ?? active[0] ?? sites[0];

  if (!current) {
    return (
      <div>
        <PageHeader title="SEO戦略ボード" subtitle="目標から逆算し、進捗とズレを毎日確認します。" />
        <EmptyState message="計測サイトが未登録です。" />
      </div>
    );
  }

  const [funnel, crm] = await Promise.all([getSeoFunnel(current.id, 30), getCrmRates()]);
  const strategy = await getStrategy(current.id, crm, {
    leadToOpp: funnel.leadToOpp,
    cvr: funnel.cvr,
    ctr: funnel.ctr,
  });

  if (!strategy) {
    return (
      <div className="space-y-4">
        <PageHeader title="SEO戦略ボード" subtitle={current.name} />
        <EmptyState message="このサイトには戦略が設定されていません（主サイトのみ初期設定済み）。" />
      </div>
    );
  }

  const [clusters, coverage, milestones] = await Promise.all([
    getClusterProgress(current.id, 30),
    getIntentCoverage(current.id, 28),
    getMilestones(strategy.id),
  ]);

  const targets = buildFunnelTargets(strategy.targetMonthlyRevenue, strategy.rates, {
    impressions: funnel.impressions,
    clicks: funnel.clicks,
    sessions: funnel.sessions,
    inquiries: funnel.inquiries,
    leadsValid: funnel.leadsValid,
    opportunities: funnel.opportunities,
    revenue: funnel.revenue,
  });
  const bottleneck = findBottleneck(targets);
  const hasData = funnel.impressions > 0 || funnel.sessions > 0;

  const today = new Date().toISOString().slice(0, 10);
  const phases = ["phase0", "phase1", "phase2", "phase3"].filter((p) => milestones.some((m) => m.phase === p));

  return (
    <div className="space-y-5">
      <PageHeader
        title="SEO戦略ボード"
        subtitle={`${current.name} — ${strategy.name}（目標 月${yen(strategy.targetMonthlyRevenue)} / ${strategy.periodTo}まで）`}
        action={
          <Link href="/app/seo" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
            <Search size={14} />
            集客サマリー
          </Link>
        }
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ milestone: "ロードマップを更新しました。" }}
        errorMessages={{ forbidden: "この操作を行う権限がありません。" }}
      />

      {active.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {active.map((s) => (
            <Link
              key={s.id}
              href={`/app/seo/strategy?site=${s.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                s.id === current.id
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-black/10 text-ink/60 hover:bg-black/[0.03]"
              }`}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      {/* A. 売上逆算ファネル — 戦略 §1.2 */}
      <Section title="売上逆算ファネル（目標に対して何が足りないか）" icon={<Target size={15} />}>
        <div className="space-y-2">
          {targets.map((t) => {
            const rate = t.achievement ?? 0;
            const isBottleneck = bottleneck?.stage === t.stage;
            const width = Math.min(100, Math.round(rate * 100));
            return (
              <div key={t.stage} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                <div className={isBottleneck ? "font-bold text-rose-700" : "text-ink/70"}>{t.label}</div>
                <div className="h-4 overflow-hidden rounded bg-black/[0.05]">
                  <div
                    className={`h-full ${isBottleneck ? "bg-rose-400" : "bg-teal-500"}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div className="whitespace-nowrap text-xs text-ink/60">
                  <span className="font-medium text-ink">
                    {t.stage === "revenue" ? yen(t.actual) : num(t.actual)}
                  </span>
                  {" / "}
                  {t.stage === "revenue" ? yen(t.target) : num(t.target)}
                  <span className="ml-2">{pct(t.achievement)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {bottleneck && hasData && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <span className="font-medium">最大のボトルネック: {bottleneck.label}</span>
            <span className="ml-2 text-xs">
              目標まであと {bottleneck.stage === "revenue" ? yen(bottleneck.gap) : `${num(bottleneck.gap)}`}
              。ここを1段上げるのが最短距離です。
            </span>
          </div>
        )}
        {!hasData && (
          <p className="mt-3 text-xs text-ink/50">
            まだ計測データがありません。接続設定の「今すぐ取込を実行」か、翌朝04:00の自動取込後に実測値が入ります。
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/50">
          <span>
            受注単価 {yen(strategy.rates.dealAmount)}
            <Src s={strategy.rateSources.dealAmount} />
          </span>
          <span>
            成約率 {pct(strategy.rates.winRate)}
            <Src s={strategy.rateSources.winRate} />
          </span>
          <span>
            商談化 {pct(strategy.rates.oppRate)}
            <Src s={strategy.rateSources.oppRate} />
          </span>
          <span>
            CVR {pct(strategy.rates.inquiryCvr, 2)}
            <Src s={strategy.rateSources.inquiryCvr} />
          </span>
          <span>
            CTR {pct(strategy.rates.ctr, 2)}
            <Src s={strategy.rateSources.ctr} />
          </span>
        </div>
      </Section>

      {/* B. トピッククラスタ — 戦略 §4 */}
      <Section title="トピッククラスタの進捗（商材＝クラスタ）" icon={<Layers size={15} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-black/[0.06] text-xs text-ink/50">
                <th className="py-2 text-left font-medium">優先</th>
                <th className="py-2 text-left font-medium">クラスタ</th>
                <th className="py-2 text-center font-medium">ピラー</th>
                <th className="py-2 text-right font-medium">記事</th>
                <th className="py-2 text-left font-medium">完成度</th>
                <th className="py-2 text-right font-medium">クリック</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <tr key={c.id} className="border-b border-black/[0.03]">
                  <td className="py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        c.priority <= 2 ? "bg-teal-50 text-teal-800" : "bg-black/[0.04] text-ink/50"
                      }`}
                    >
                      {c.priority}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className={c.status === "out_of_scope" ? "text-ink/40" : ""}>{c.name}</div>
                    {c.note && <div className="text-xs text-ink/40">{c.note}</div>}
                  </td>
                  <td className="py-2 text-center">{c.hasPillar ? "✅" : "—"}</td>
                  <td className="py-2 text-right">
                    {c.articleCount} / {c.targetArticleCount}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 overflow-hidden rounded bg-black/[0.05]">
                        <div className="h-full bg-teal-500" style={{ width: `${Math.round(c.completion * 100)}%` }} />
                      </div>
                      <span className="text-xs text-ink/50">{pct(c.completion, 0)}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right">{num(c.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink/50">
          半端に3クラスタを30%ずつ作るより、<strong>優先1のクラスタを100%完成させる</strong>
          方が順位は上がります（専門性の集中）。ページとクラスタの紐付けは、クロール機能（WO-33）の稼働後に自動化されます。
        </p>
      </Section>

      {/* C. 検索意図3層 — 戦略 §3 */}
      <Section title="検索意図3層のカバレッジ" icon={<Search size={15} />}>
        {coverage.every((c) => c.keywordCount === 0) ? (
          <EmptyState message="ターゲットKW台帳が未登録です。KW順位表から登録できます。" />
        ) : (
          <div className="space-y-2 text-sm">
            {coverage.map((c) => (
              <div key={c.layer} className="grid grid-cols-[14rem_1fr_auto] items-center gap-3">
                <div className={c.layer === 1 ? "font-medium text-ink" : "text-ink/70"}>
                  {INTENT_LABELS[c.layer]}
                </div>
                <div className="h-3 overflow-hidden rounded bg-black/[0.05]">
                  <div
                    className={`h-full ${c.layer === 1 ? "bg-orange-400" : "bg-teal-500"}`}
                    style={{ width: `${Math.round((c.coverageRate ?? 0) * 100)}%` }}
                  />
                </div>
                <div className="whitespace-nowrap text-xs text-ink/60">
                  KW {c.keywordCount}語 / 10位内 {c.rankedTop10}語（{pct(c.coverageRate)}）・クリック {num(c.clicks)}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink/50">
          第1層（今すぐ客）が最も売上に近い層です。ここのカバレッジが低いまま第3層の記事を増やしても、
          PVは増えて問合せは増えません。語ごとの順位とギャップは{" "}
          <Link href="/app/seo/keywords" className="underline">
            KW順位表
          </Link>
          で確認できます。
        </p>
      </Section>

      {/* D. 90日ロードマップ — 戦略 §9 */}
      <Section title="ロードマップ進捗" icon={<Route size={15} />}>
        <div className="space-y-4">
          {phases.map((phase) => {
            const items = milestones.filter((m) => m.phase === phase);
            const done = items.filter((m) => m.status === "done").length;
            return (
              <div key={phase}>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  <span className={phase === strategy.currentPhase ? "text-teal-800" : "text-ink/70"}>
                    {PHASE_LABEL[phase] ?? phase}
                  </span>
                  <span className="text-xs text-ink/50">
                    {done}/{items.length} 完了
                  </span>
                  {phase === strategy.currentPhase && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-800">現在</span>
                  )}
                </div>
                <ul className="space-y-1">
                  {items.map((m) => {
                    const overdue = m.status !== "done" && m.dueDate != null && m.dueDate < today;
                    return (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        <form action={setMilestoneStatusAction}>
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="to" value={m.status === "done" ? "todo" : "done"} />
                          <input type="hidden" name="site" value={current.id} />
                          <SubmitButton className="text-base leading-none" pendingLabel="…">
                            {m.status === "done" ? "✅" : "⬜"}
                          </SubmitButton>
                        </form>
                        <span className={m.status === "done" ? "text-ink/40 line-through" : ""}>{m.title}</span>
                        {m.dueDate && (
                          <span className={`text-xs ${overdue ? "font-medium text-rose-600" : "text-ink/40"}`}>
                            {overdue ? `期限超過（${m.dueDate}）` : m.dueDate}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

/** レートがCRM実績か想定値かを示す小バッジ。想定値のまま判断しないための注意喚起。 */
function Src({ s }: { s: "crm" | "assumed" }) {
  return (
    <span className={`ml-1 rounded px-1 text-[10px] ${s === "crm" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>
      {s === "crm" ? "実績" : "想定"}
    </span>
  );
}
