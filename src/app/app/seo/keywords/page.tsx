import Link from "next/link";
import { Target, Search, ArrowUp, ArrowDown, Compass } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { listSeoSites } from "@/lib/data/seo";
import {
  getKeywordRankings,
  getKeywordGap,
  getDiscoveredQueries,
  GAP_META,
  LAYER_LABEL,
  type GapStatus,
} from "@/lib/data/seo-keywords";

export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("ja-JP");

const TONE: Record<"bad" | "warn" | "ok", string> = {
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/**
 * ターゲットKW順位表（F-307）。
 *
 * 「狙った語が何位取れているか」を週次で見る画面。
 * これがSEOコンサルの主戦場で、ここが空だと施策は対処療法になる。
 * 背景: docs/SEO_STRATEGY_V2_KEYWORD_DRIVEN_2026-07.md
 */
export default async function SeoKeywordsPage({
  searchParams,
}: {
  searchParams: { site?: string; layer?: string; status?: string };
}) {
  await requireCtx();
  const sites = await listSeoSites();
  const active = sites.filter((s) => s.status === "active");
  const current = active.find((s) => s.id === searchParams.site) ?? active[0] ?? sites[0];
  if (!current) {
    return (
      <div>
        <PageHeader title="ターゲットKW順位表" subtitle="狙った語が何位取れているかを週次で追います。" />
        <EmptyState message="計測サイトが未登録です。" />
      </div>
    );
  }

  const [rankings, gap, discovered] = await Promise.all([
    getKeywordRankings(current.id),
    getKeywordGap(current.id),
    getDiscoveredQueries(current.id, 12),
  ]);

  const layerFilter = searchParams.layer ? Number(searchParams.layer) : null;
  const statusFilter = (searchParams.status as GapStatus | undefined) ?? null;
  const rows = rankings.filter(
    (r) =>
      (layerFilter == null || r.intentLayer === layerFilter) &&
      (statusFilter == null || r.gapStatus === statusFilter),
  );

  const layers = [1, 2, 3].filter((l) => rankings.some((r) => r.intentLayer === l));
  const totalVolume = rankings.reduce((n, r) => n + (r.searchVolume ?? 0), 0);
  const takenCount = rankings.filter((r) => r.gapStatus === "top10").length;

  // HP内のパスを実サイトの絶対URLに解決する。リライト時に対象ページと
  // 実表示ページを画面から直接開いて見比べられるようにするため
  const pageUrl = (path: string): string | null => {
    try {
      return new URL(path, current.baseUrl).toString();
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="ターゲットKW順位表"
        subtitle={`${current.name} — 仮説で決めた狙う語 ${rankings.length}語（想定検索数 合計 月${num(totalVolume)}）。うち10位以内 ${takenCount}語`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/plans" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              記事プラン
            </Link>
            <Link href="/app/seo/strategy" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Target size={14} />
              戦略ボード
            </Link>
            <Link href="/app/seo" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Search size={14} />
              集客サマリー
            </Link>
          </div>
        }
      />

      {rankings.length === 0 ? (
        <EmptyState message="ターゲットKWが未登録です。マイグレーション 0186 を適用してください。" />
      ) : (
        <>
          {/* ギャップの4分類。各分類から打つべき手が一意に決まる */}
          <Section title="ギャップ分析（狙った語の到達状況）" icon={<Compass size={15} />}>
            <div className="space-y-4">
              {layers.map((layer) => {
                const forLayer = gap.filter((g) => g.intentLayer === layer);
                if (!forLayer.length) return null;
                const layerTotal = forLayer.reduce((n, g) => n + g.keywords, 0);
                return (
                  <div key={layer}>
                    <div className="mb-1.5 text-sm font-medium">
                      {LAYER_LABEL[layer]}
                      <span className="ml-2 text-xs text-ink/50">{layerTotal}語</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {(["no_page", "out", "far", "striking", "top10"] as GapStatus[]).map((st) => {
                        const g = forLayer.find((x) => x.gapStatus === st);
                        const meta = GAP_META[st];
                        return (
                          <Link
                            key={st}
                            href={`/app/seo/keywords?site=${current.id}&layer=${layer}&status=${st}`}
                            className={`rounded-lg border p-2.5 transition hover:opacity-80 ${
                              g?.keywords ? TONE[meta.tone] : "border-black/[0.06] text-ink/35"
                            }`}
                          >
                            <div className="text-xs">{meta.label}</div>
                            <div className="mt-0.5 text-lg font-bold">{g?.keywords ?? 0}語</div>
                            <div className="mt-0.5 text-[11px] leading-tight">{meta.action}</div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/app/seo/keywords?site=${current.id}`}
              className={`rounded-full border px-3 py-1 ${
                !layerFilter && !statusFilter
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-black/10 text-ink/60"
              }`}
            >
              すべて（{rankings.length}）
            </Link>
            {layers.map((l) => (
              <Link
                key={l}
                href={`/app/seo/keywords?site=${current.id}&layer=${l}`}
                className={`rounded-full border px-3 py-1 ${
                  layerFilter === l && !statusFilter
                    ? "border-teal-500 bg-teal-50 text-teal-800"
                    : "border-black/10 text-ink/60"
                }`}
              >
                第{l}層（{rankings.filter((r) => r.intentLayer === l).length}）
              </Link>
            ))}
            {statusFilter && (
              <span className="text-ink/60">
                絞り込み: {GAP_META[statusFilter].label} → {GAP_META[statusFilter].action}
              </span>
            )}
          </div>

          <Section title={`KW順位表（${rows.length}語）`} icon={<Target size={15} />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-xs text-ink/50">
                    <th className="py-2 text-left font-medium">キーワード</th>
                    <th className="py-2 text-left font-medium">クラスタ</th>
                    <th className="py-2 text-right font-medium">想定検索数</th>
                    <th className="py-2 text-left font-medium">対策ページ</th>
                    <th className="py-2 text-right font-medium">目標 6M→12M</th>
                    <th className="py-2 text-right font-medium">現在</th>
                    <th className="py-2 text-right font-medium">前週比</th>
                    <th className="py-2 text-right font-medium">表示</th>
                    <th className="py-2 text-right font-medium">クリック</th>
                    <th className="py-2 text-left font-medium">状態 / 実際に表示されているページ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = GAP_META[r.gapStatus];
                    // 到達判定は12ヶ月目標に対して行う（6ヶ月は中間チェックポイント）
                    const reached =
                      r.currentPosition != null && r.target12m != null && r.currentPosition <= r.target12m;
                    return (
                      <tr key={r.keywordId} className="border-b border-black/[0.03]">
                        <td className="py-2 pr-2">
                          <span className={r.intentLayer === 1 ? "font-medium" : ""}>{r.query}</span>
                        </td>
                        <td className="py-2 pr-2 text-xs text-ink/50">{r.clusterName ?? "—"}</td>
                        <td className="py-2 text-right text-ink/60">{r.searchVolume ? num(r.searchVolume) : "—"}</td>
                        <td className="py-2 pr-2 text-xs">
                          {/* 1検索意図=1ページ。どのページで取るかを常に見せてカニバリを防ぐ */}
                          {r.planTitle ? (
                            <>
                              <span className="text-ink/70">{r.planTitle.split("｜")[0]}</span>
                              <span
                                className={`ml-1 rounded px-1 text-[10px] ${
                                  r.isExistingPage ? "bg-teal-50 text-teal-700" : "bg-orange-50 text-orange-700"
                                }`}
                              >
                                {r.isExistingPage ? "既存" : "新規"}
                              </span>
                              {r.plannedUrl &&
                                (pageUrl(r.plannedUrl) ? (
                                  <div className="break-all text-[10px]">
                                    <a
                                      href={pageUrl(r.plannedUrl)!}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-teal-700 underline decoration-teal-300 hover:text-teal-900"
                                    >
                                      {r.plannedUrl}
                                    </a>
                                  </div>
                                ) : (
                                  <div className="break-all text-[10px] text-ink/40">{r.plannedUrl}</div>
                                ))}
                            </>
                          ) : (
                            <span className="text-rose-600">未割当</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-ink/50">
                          {r.target6m ?? "—"}→{r.target12m ?? "—"}位
                        </td>
                        <td className={`py-2 text-right font-medium ${reached ? "text-emerald-700" : ""}`}>
                          {r.currentPosition != null ? `${r.currentPosition}位` : "—"}
                        </td>
                        <td className="py-2 text-right">
                          {r.delta == null ? (
                            <span className="text-ink/30">—</span>
                          ) : r.delta > 0 ? (
                            <span className="inline-flex items-center text-emerald-700">
                              <ArrowUp size={11} />
                              {r.delta}
                            </span>
                          ) : r.delta < 0 ? (
                            <span className="inline-flex items-center text-rose-600">
                              <ArrowDown size={11} />
                              {Math.abs(r.delta)}
                            </span>
                          ) : (
                            <span className="text-ink/40">±0</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-ink/60">{num(r.impressions)}</td>
                        <td className="py-2 text-right text-ink/60">{num(r.clicks)}</td>
                        <td className="py-2">
                          <span className={`rounded border px-1.5 py-0.5 text-xs ${TONE[meta.tone]}`}>
                            {meta.label}
                          </span>
                          {r.rankingPage &&
                            (pageUrl(r.rankingPage) ? (
                              <a
                                href={pageUrl(r.rankingPage)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 break-all text-xs text-ink/60 underline decoration-black/20 hover:text-ink"
                              >
                                {r.rankingPage}
                              </a>
                            ) : (
                              <span className="ml-2 break-all text-xs text-ink/45">{r.rankingPage}</span>
                            ))}
                          {/* 対策ページを決めているのにGoogleが別ページを選んでいる = カニバリか対策ページが弱い */}
                          {r.pageMismatch && (
                            <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800">
                              対策ページと不一致
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 拾い物: 狙っていないのに取れている語。捨てずに仮説の種にする */}
          {discovered.length > 0 && (
            <Section title="拾い物（狙っていないが取れている語）">
              <p className="mb-2 text-xs text-ink/50">
                台帳に無いのに流入がある語です。捨てずに<strong>仮説の種</strong>として扱います。
                発注検討層でなくても、そこから発注検討層のページへ内部リンクを張れば売上に繋がります。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] text-xs text-ink/50">
                      <th className="py-2 text-left font-medium">キーワード</th>
                      <th className="py-2 text-right font-medium">表示</th>
                      <th className="py-2 text-right font-medium">クリック</th>
                      <th className="py-2 text-right font-medium">順位</th>
                      <th className="py-2 text-left font-medium">ページ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discovered.map((d) => (
                      <tr key={d.query} className="border-b border-black/[0.03]">
                        <td className="py-2 pr-2">{d.query}</td>
                        <td className="py-2 text-right text-ink/60">{num(d.impressions)}</td>
                        <td className="py-2 text-right text-ink/60">{num(d.clicks)}</td>
                        <td className="py-2 text-right text-ink/60">{d.position ?? "—"}</td>
                        <td className="py-2 break-all text-xs">
                          {d.pagePath && pageUrl(d.pagePath) ? (
                            <a
                              href={pageUrl(d.pagePath)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-ink/60 underline decoration-black/20 hover:text-ink"
                            >
                              {d.pagePath}
                            </a>
                          ) : (
                            <span className="text-ink/45">{d.pagePath ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
