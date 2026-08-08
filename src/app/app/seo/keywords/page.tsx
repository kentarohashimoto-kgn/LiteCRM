import Link from "next/link";
import { Target, Search, ArrowUp, ArrowDown, Compass, Lightbulb, ClipboardList } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { listSeoSites } from "@/lib/data/seo";
import {
  getKeywordRankings,
  getKeywordGap,
  getDiscoveredQueries,
  getKeywordWork,
  getKeywordHistories,
  GAP_META,
  LAYER_LABEL,
  WORK_LABEL,
  type GapStatus,
  type KeywordRanking,
  type KeywordWork,
  type KeywordWorkState,
  type KeywordWeekPoint,
} from "@/lib/data/seo-keywords";
import { createProposalFromKeywordAction } from "@/server/actions/seo";
import { SiteSwitcher } from "@/components/seo/site-switcher";

export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("ja-JP");

const TONE: Record<"bad" | "warn" | "ok", string> = {
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const WORK_TONE: Record<KeywordWorkState, string> = {
  none: "bg-rose-50 text-rose-700 border-rose-200",
  proposed: "bg-amber-50 text-amber-800 border-amber-200",
  executing: "bg-sky-50 text-sky-800 border-sky-200",
  verifying: "bg-violet-50 text-violet-800 border-violet-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/**
 * 重要度スコア。未対応の語をどれから片付けるかを決めるための並び順。
 * 想定検索数を土台に、売上に近い層（第1層）と、打ち手の効きやすい到達段階
 * （11〜20位=あと一歩）を重める。10位以内は「守り」なので下げる。
 */
function importanceOf(r: KeywordRanking): number {
  const layerW = r.intentLayer === 1 ? 1.3 : r.intentLayer === 2 ? 1.15 : 1.0;
  const gapW =
    r.gapStatus === "striking" ? 1.2 : r.gapStatus === "no_page" || r.gapStatus === "out" ? 1.1 : r.gapStatus === "far" ? 1.0 : 0.5;
  return (r.searchVolume ?? 0) * layerW * gapW;
}

/** 反映週の順位と最新週の順位を比べる。検証中・完了の成果表示に使う。 */
function deltaSinceApplied(
  history: KeywordWeekPoint[] | undefined,
  appliedAt: string | null,
): { then: number; now: number } | null {
  if (!history?.length || !appliedAt) return null;
  const applied = appliedAt.slice(0, 10);
  const withPos = history.filter((p) => p.position != null);
  if (!withPos.length) return null;
  // 反映日を含む週（＝反映直前の状態を残す最後の週）を基準にする
  const base = [...withPos].reverse().find((p) => p.week <= applied) ?? withPos[0];
  const latest = withPos[withPos.length - 1];
  if (base === latest) return null;
  return { then: base.position!, now: latest.position! };
}

/** 12週の順位推移スパークライン。下ほど悪い順位。反映週に目印を打つ。 */
function Sparkline({ history, appliedAt }: { history?: KeywordWeekPoint[]; appliedAt?: string | null }) {
  const points = (history ?? []).filter((p) => p.position != null);
  if (points.length < 2) return <span className="text-xs text-ink/30">—</span>;

  const W = 112;
  const H = 28;
  const positions = points.map((p) => Math.min(p.position!, 50));
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  const span = Math.max(max - min, 1);
  const x = (i: number) => 2 + (i * (W - 4)) / Math.max(points.length - 1, 1);
  // 順位は小さいほど良い＝上に描く
  const y = (pos: number) => 3 + ((Math.min(pos, 50) - min) / span) * (H - 6);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.position!).toFixed(1)}`).join(" ");

  const applied = appliedAt?.slice(0, 10);
  const appliedIdx = applied
    ? points.reduce((best, p, i) => (p.week <= applied ? i : best), -1)
    : -1;
  const last = points[points.length - 1];
  const improving = points.length >= 2 && last.position! < points[0].position!;

  return (
    <svg width={W} height={H} className="block" aria-label="順位推移">
      <path d={path} fill="none" strokeWidth="1.5" className={improving ? "stroke-emerald-500" : "stroke-ink/40"} />
      {appliedIdx >= 0 && (
        <line
          x1={x(appliedIdx)}
          y1="1"
          x2={x(appliedIdx)}
          y2={H - 1}
          strokeWidth="1"
          strokeDasharray="2 2"
          className="stroke-teal-600"
        />
      )}
      <circle cx={x(points.length - 1)} cy={y(last.position!)} r="2" className={improving ? "fill-emerald-600" : "fill-ink/50"} />
    </svg>
  );
}

/**
 * ターゲットKW順位表（F-307）。
 *
 * 「狙った語が何位取れているか」を週次で見る画面。
 * v2: 眺める表から「回す」ハブへ。各語の対応状況（未対応→提案中→実施中→
 * 検証中→完了）を突合して見せ、未対応の語はこの画面から1クリックで提案化する。
 * これがSEOコンサルの主戦場で、ここが空だと施策は対処療法になる。
 * 背景: docs/SEO_STRATEGY_V2_KEYWORD_DRIVEN_2026-07.md
 */
export default async function SeoKeywordsPage(
  props: {
    searchParams: Promise<{
      site?: string;
      layer?: string;
      status?: string;
      work?: string;
      sort?: string;
      saved?: string;
      error?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
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

  const [rankings, gap, discovered, work] = await Promise.all([
    getKeywordRankings(current.id),
    getKeywordGap(current.id),
    getDiscoveredQueries(current.id, 12),
    getKeywordWork(current.id),
  ]);
  const histories = await getKeywordHistories(
    current.id,
    rankings.map((r) => r.query),
  );

  // クエリ一致を最優先、無ければ対策ページ／実表示ページで突合する
  const workOf = (r: KeywordRanking): KeywordWork | null => {
    const q = work.byQuery.get(r.query.trim().toLowerCase());
    if (q) return q;
    const planned = r.plannedUrl ? work.byPage.get(r.plannedUrl.trim().toLowerCase()) : undefined;
    if (planned) return planned;
    const ranking = r.rankingPage ? work.byPage.get(r.rankingPage.trim().toLowerCase()) : undefined;
    return ranking ?? null;
  };
  const stateOf = (r: KeywordRanking): KeywordWorkState => workOf(r)?.state ?? "none";

  const layerFilter = searchParams.layer ? Number(searchParams.layer) : null;
  const statusFilter = (searchParams.status as GapStatus | undefined) ?? null;
  const workFilter = (searchParams.work as KeywordWorkState | undefined) ?? null;
  const sort = searchParams.sort ?? "importance";

  const base = rankings.filter(
    (r) =>
      (layerFilter == null || r.intentLayer === layerFilter) &&
      (statusFilter == null || r.gapStatus === statusFilter),
  );
  const rows = [...base.filter((r) => workFilter == null || stateOf(r) === workFilter)];

  rows.sort((a, b) => {
    if (sort === "volume") return (b.searchVolume ?? 0) - (a.searchVolume ?? 0);
    if (sort === "position") return (a.currentPosition ?? 999) - (b.currentPosition ?? 999);
    if (sort === "delta") return (b.delta ?? -999) - (a.delta ?? -999);
    return importanceOf(b) - importanceOf(a);
  });

  const layers = [1, 2, 3].filter((l) => rankings.some((r) => r.intentLayer === l));
  const totalVolume = rankings.reduce((n, r) => n + (r.searchVolume ?? 0), 0);
  const takenCount = rankings.filter((r) => r.gapStatus === "top10").length;
  const workCounts = (["none", "proposed", "executing", "verifying", "done"] as KeywordWorkState[]).map((st) => ({
    key: st,
    count: base.filter((r) => stateOf(r) === st).length,
  }));
  const untouchedVolume = base
    .filter((r) => stateOf(r) === "none")
    .reduce((n, r) => n + (r.searchVolume ?? 0), 0);

  // HP内のパスを実サイトの絶対URLに解決する。リライト時に対象ページと
  // 実表示ページを画面から直接開いて見比べられるようにするため
  const pageUrl = (path: string): string | null => {
    try {
      return new URL(path, current.baseUrl).toString();
    } catch {
      return null;
    }
  };

  const filterHref = (params: Record<string, string | null>) => {
    const q = new URLSearchParams();
    q.set("site", current.id);
    const merged: Record<string, string | null> = {
      layer: layerFilter?.toString() ?? null,
      status: statusFilter,
      work: workFilter,
      sort: sort === "importance" ? null : sort,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/app/seo/keywords?${q.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="ターゲットKW順位表"
        subtitle={`${current.name} — 狙う語 ${rankings.length}語（想定検索数 合計 月${num(totalVolume)}）。うち10位以内 ${takenCount}語。ここから提案→実施→検証まで回せます`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/proposals" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Lightbulb size={14} />
              改善提案
            </Link>
            <Link href="/app/seo/actions" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <ClipboardList size={14} />
              施策の実行
            </Link>
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

      <SiteSwitcher sites={sites} currentId={current.id} basePath="/app/seo/keywords" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          proposal_created:
            "提案を作成しました。この語が属する記事プラン1本ぶん（サブKW込み）です。「改善提案」で承認すると実行チケットと指示書が作られます。",
          proposal_exists: "この記事の提案は既に承認待ちにあります。「改善提案」から承認してください。",
          proposal_nogap: "この記事の狙う語はすべて目標順位に届いています。新しい提案はありません。",
        }}
        errorMessages={{
          forbidden: "提案の作成は owner / admin / sales_manager のみ可能です。",
          not_found: "対象のキーワードが見つかりませんでした。",
          save_failed: "保存に失敗しました。もう一度お試しください。",
        }}
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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                href={`/app/seo/keywords?site=${current.id}`}
                className={`rounded-full border px-3 py-1 ${
                  !layerFilter && !statusFilter && !workFilter
                    ? "border-teal-500 bg-teal-50 text-teal-800"
                    : "border-black/10 text-ink/60"
                }`}
              >
                すべて（{rankings.length}）
              </Link>
              {layers.map((l) => (
                <Link
                  key={l}
                  href={filterHref({ layer: layerFilter === l ? null : String(l) })}
                  className={`rounded-full border px-3 py-1 ${
                    layerFilter === l ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
                  }`}
                >
                  第{l}層（{rankings.filter((r) => r.intentLayer === l).length}）
                </Link>
              ))}
              <span className="mx-1 text-ink/30">|</span>
              {/* 対応状況フィルタ。未対応の放置と、実施済みの経過確認の両方に使う */}
              {workCounts.map(({ key, count }) => (
                <Link
                  key={key}
                  href={filterHref({ work: workFilter === key ? null : key })}
                  className={`rounded-full border px-3 py-1 ${
                    workFilter === key ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
                  } ${count === 0 ? "opacity-40" : ""}`}
                >
                  {WORK_LABEL[key]}（{count}）
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink/40">並び順:</span>
              {[
                { key: "importance", label: "重要度" },
                { key: "volume", label: "検索数" },
                { key: "position", label: "現在順位" },
                { key: "delta", label: "前週の動き" },
              ].map((s) => (
                <Link
                  key={s.key}
                  href={filterHref({ sort: s.key === "importance" ? null : s.key })}
                  className={`rounded-full border px-3 py-1 ${
                    sort === s.key ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
                  }`}
                >
                  {s.label}
                </Link>
              ))}
              {statusFilter && (
                <span className="text-ink/60">
                  絞り込み: {GAP_META[statusFilter].label} → {GAP_META[statusFilter].action}
                </span>
              )}
              {untouchedVolume > 0 && !workFilter && (
                <Link href={filterHref({ work: "none" })} className="ml-auto text-rose-600 hover:underline">
                  未対応 {workCounts[0].count}語に想定検索数 月{num(untouchedVolume)}が眠っています →
                </Link>
              )}
            </div>
          </div>

          <Section title={`KW順位表（${rows.length}語）`} icon={<Target size={15} />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1360px] text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-xs text-ink/50">
                    <th className="py-2 text-left font-medium">キーワード</th>
                    <th className="py-2 text-left font-medium">クラスタ</th>
                    <th className="py-2 text-right font-medium">想定検索数</th>
                    <th className="py-2 text-left font-medium">対策ページ</th>
                    <th className="py-2 text-right font-medium">目標 6M→12M</th>
                    <th className="py-2 text-right font-medium">現在</th>
                    <th className="py-2 text-right font-medium">前週比</th>
                    <th className="py-2 text-left font-medium">推移（12週）</th>
                    <th className="py-2 text-right font-medium">表示</th>
                    <th className="py-2 text-right font-medium">クリック</th>
                    <th className="py-2 text-left font-medium">状態 / 実際に表示されているページ</th>
                    <th className="py-2 text-left font-medium">対応</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = GAP_META[r.gapStatus];
                    const w = workOf(r);
                    const state = w?.state ?? "none";
                    const history = histories.get(r.query.trim().toLowerCase());
                    const applied = w?.appliedAt ?? null;
                    const d = state === "verifying" || state === "done" ? deltaSinceApplied(history, applied) : null;
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
                        <td className="py-2 pr-2">
                          <Sparkline history={history} appliedAt={applied} />
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
                        <td className="py-2 pr-1">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`rounded border px-1.5 py-0.5 text-xs ${WORK_TONE[state]}`}>
                              {WORK_LABEL[state]}
                            </span>
                            {state === "none" && (
                              // 未対応の語をその場で提案化する。バッチの1日10件を待たなくてよい
                              (<form action={createProposalFromKeywordAction}>
                                <input type="hidden" name="keyword_id" value={r.keywordId} />
                                <input type="hidden" name="site" value={current.id} />
                                <SubmitButton className="btn-secondary !px-2 !py-0.5 text-xs" pendingLabel="…">
                                  提案を作る
                                </SubmitButton>
                              </form>)
                            )}
                            {state === "proposed" && (
                              <Link
                                href={`/app/seo/proposals?site=${current.id}`}
                                className="text-xs text-teal-deep hover:underline"
                              >
                                承認待ちを開く
                              </Link>
                            )}
                            {state === "executing" && (
                              <Link
                                href={`/app/seo/actions?site=${current.id}`}
                                className="text-xs text-teal-deep hover:underline"
                              >
                                チケットを開く
                              </Link>
                            )}
                            {(state === "verifying" || state === "done") && (
                              <div className="text-[11px] leading-tight text-ink/60">
                                {applied && <div>反映 {new Date(applied).toLocaleDateString("ja-JP")}</div>}
                                {state === "verifying" && w?.verifyDueAt && (
                                  <div>判定 {new Date(w.verifyDueAt).toLocaleDateString("ja-JP")}</div>
                                )}
                                {d &&
                                  (d.then > d.now ? (
                                    <div className="font-medium text-emerald-700">
                                      {d.then}位→{d.now}位（+{Math.round((d.then - d.now) * 10) / 10}）
                                    </div>
                                  ) : d.then < d.now ? (
                                    <div className="font-medium text-rose-600">
                                      {d.then}位→{d.now}位（-{Math.round((d.now - d.then) * 10) / 10}）
                                    </div>
                                  ) : (
                                    <div>順位変化なし（{d.now}位）</div>
                                  ))}
                              </div>
                            )}
                          </div>
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
