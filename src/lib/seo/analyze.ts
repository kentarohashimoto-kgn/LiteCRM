import { benchmarkCtr, commercialWeight, estimateIntentLayer, isBrandQuery, EFFORT_WEIGHT } from "./benchmark";

/**
 * SEOの機会・劣化を機械的に検出する（純関数・テスト対象）。
 *
 * 「毎日同じ基準で見る」の実体。AIに数値判断をさせると日によって結果が揺れ、
 * PDCAの継続性が壊れるため、検出はすべてここで決定的に確定させる。
 * AIの仕事は、ここで出た所見に「なぜそうなったか」を言語化することだけ。
 */

export type InsightKind =
  | "ctr_opportunity" // 順位のわりにクリックされていない
  | "zero_click" // 上位表示なのにクリック0（最も異常な状態）
  | "striking_distance" // 11〜20位。あと一歩で1ページ目
  | "rank_decline" // 順位が明確に落ちた
  | "click_drop" // クリックが落ちた
  | "cannibalization" // 同一クエリで自社ページ同士が競合
  | "intent_mix"; // 流入の意図層が売上から遠い（サイトレベル）

export interface QueryAgg {
  query: string;
  pagePath: string;
  impressions: number;
  clicks: number;
  position: number | null;
}

export interface Insight {
  kind: InsightKind;
  scope: "site" | "page" | "query";
  query: string | null;
  pagePath: string | null;
  title: string;
  severity: "high" | "medium" | "low";
  /** 根拠数値。AIはこれを引用するだけで、再計算はしない。 */
  metric: Record<string, number | string | null>;
  /** 並び順の一次キー。追加見込みクリック × 商用意図 × 実現容易性 */
  opportunityScore: number;
  actionType: string;
}

export interface AnalyzeOptions {
  /** 指名検索を除外するための自社名。 */
  brandTerms: string[];
  /** これ未満の表示回数は判断材料にしない（GSCのプライバシーしきい値で消えるため）。 */
  minImpressions?: number;
  /** 1回の分析で出す最大件数。人が処理できる量を超えない。 */
  limit?: number;
}

const DEFAULTS = { minImpressions: 30, limit: 40 };

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** 追加見込みクリック × 商用意図 × 実現容易性。 */
function score(extraClicks: number, query: string, actionType: string): number {
  return round(extraClicks * commercialWeight(query) * (EFFORT_WEIGHT[actionType] ?? 1));
}

/**
 * 直近期間のクエリ集計から機会・劣化を検出する。
 * `previous` を渡すと、順位劣化・クリック減も判定する。
 */
export function detectInsights(
  current: QueryAgg[],
  previous: QueryAgg[] | null,
  opts: AnalyzeOptions,
): Insight[] {
  const minImp = opts.minImpressions ?? DEFAULTS.minImpressions;
  const out: Insight[] = [];

  // 指名検索は既に認知済みで施策対象にならないため、最初に除外する
  const rows = current.filter((r) => !isBrandQuery(r.query, opts.brandTerms));

  for (const r of rows) {
    if (r.impressions < minImp) continue;
    const pos = r.position;
    const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
    const bench = benchmarkCtr(pos);

    // --- 上位表示なのにクリック0 ---
    // 見えているのに1回も選ばれていない = タイトルが検索意図と噛み合っていない典型。
    if (pos != null && pos <= 10 && r.clicks === 0 && r.impressions >= 100) {
      const extra = r.impressions * (bench ?? 0);
      out.push({
        kind: "zero_click",
        scope: "query",
        query: r.query,
        pagePath: r.pagePath || null,
        title: `「${r.query}」は${round(pos, 1)}位に表示されているのにクリック0`,
        severity: "high",
        metric: { impressions: r.impressions, clicks: 0, position: round(pos, 1), benchmarkCtr: bench },
        opportunityScore: score(extra, r.query, "title_meta"),
        actionType: "title_meta",
      });
      continue; // CTR機会損失と二重に出さない
    }

    // --- 順位のわりにクリックされていない ---
    if (pos != null && pos <= 10 && bench != null && r.impressions >= 100 && ctr < bench * 0.7) {
      const extra = r.impressions * (bench - ctr);
      out.push({
        kind: "ctr_opportunity",
        scope: "query",
        query: r.query,
        pagePath: r.pagePath || null,
        title: `「${r.query}」のCTRが順位${round(pos, 1)}位の水準を下回る（${round(ctr * 100, 2)}% < 目安${round(bench * 100, 1)}%）`,
        severity: extra >= 50 ? "high" : "medium",
        metric: {
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: round(ctr, 4),
          position: round(pos, 1),
          benchmarkCtr: bench,
          extraClicks: Math.round(extra),
        },
        opportunityScore: score(extra, r.query, "title_meta"),
        actionType: "title_meta",
      });
      continue;
    }

    // --- あと一歩（11〜20位） ---
    // 1ページ目に入れば表示あたりのクリックが数倍になる。費用対効果が最も高い層。
    if (pos != null && pos > 10 && pos <= 20 && r.impressions >= Math.max(50, minImp)) {
      const target = benchmarkCtr(8) ?? 0.03;
      const extra = r.impressions * (target - ctr);
      if (extra > 0) {
        out.push({
          kind: "striking_distance",
          scope: "query",
          query: r.query,
          pagePath: r.pagePath || null,
          title: `「${r.query}」は${round(pos, 1)}位。1ページ目まであと一歩`,
          severity: "medium",
          metric: {
            impressions: r.impressions,
            clicks: r.clicks,
            position: round(pos, 1),
            extraClicks: Math.round(extra),
          },
          opportunityScore: score(extra, r.query, "rewrite"),
          actionType: "rewrite",
        });
      }
    }
  }

  // --- カニバリゼーション（同一クエリで自社ページ同士が競合） ---
  const byQuery = new Map<string, QueryAgg[]>();
  for (const r of rows) {
    if (!r.pagePath || r.impressions < minImp) continue;
    const arr = byQuery.get(r.query) ?? [];
    arr.push(r);
    byQuery.set(r.query, arr);
  }
  for (const [query, arr] of byQuery) {
    const competing = arr.filter((r) => r.position != null && r.position <= 30);
    if (competing.length < 2) continue;
    const totalImp = competing.reduce((n, r) => n + r.impressions, 0);
    out.push({
      kind: "cannibalization",
      scope: "query",
      query,
      pagePath: competing[0].pagePath,
      title: `「${query}」で自社の${competing.length}ページが競合している`,
      severity: "medium",
      metric: {
        pages: competing.length,
        impressions: totalImp,
        paths: competing.map((r) => r.pagePath).join(" / "),
      },
      opportunityScore: score(totalImp * 0.01, query, "merge_pages"),
      actionType: "merge_pages",
    });
  }

  // --- 順位劣化・クリック減（前期比） ---
  if (previous) {
    const prevByKey = new Map(previous.map((r) => [`${r.query}|${r.pagePath}`, r]));
    for (const r of rows) {
      if (r.impressions < minImp) continue;
      const prev = prevByKey.get(`${r.query}|${r.pagePath}`);
      if (!prev) continue;

      if (r.position != null && prev.position != null && r.position - prev.position >= 3) {
        out.push({
          kind: "rank_decline",
          scope: "query",
          query: r.query,
          pagePath: r.pagePath || null,
          title: `「${r.query}」の順位が ${round(prev.position, 1)}位 → ${round(r.position, 1)}位 に低下`,
          severity: r.position - prev.position >= 6 ? "high" : "medium",
          metric: {
            positionBefore: round(prev.position, 1),
            positionAfter: round(r.position, 1),
            delta: round(r.position - prev.position, 1),
            impressions: r.impressions,
          },
          opportunityScore: score(prev.clicks - r.clicks, r.query, "rewrite"),
          actionType: "rewrite",
        });
      } else if (prev.clicks >= 10 && r.clicks <= prev.clicks * 0.7) {
        // 順位は落ちていないのにクリックだけ落ちた = CTR要因（競合のタイトル変更など）
        out.push({
          kind: "click_drop",
          scope: "query",
          query: r.query,
          pagePath: r.pagePath || null,
          title: `「${r.query}」のクリックが ${prev.clicks} → ${r.clicks} に減少（順位は横ばい）`,
          severity: "medium",
          metric: { clicksBefore: prev.clicks, clicksAfter: r.clicks, position: round(r.position ?? 0, 1) },
          opportunityScore: score(prev.clicks - r.clicks, r.query, "title_meta"),
          actionType: "title_meta",
        });
      }
    }
  }

  return out.sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, opts.limit ?? DEFAULTS.limit);
}

export interface IntentMix {
  layer1: number;
  layer2: number;
  layer3: number;
  brand: number;
  total: number;
}

/**
 * 流入の意図層ミックス（サイトレベル）。
 * 第3層（情報収集）ばかりだと「PVは増えたが問合せが増えない」状態になる。
 * 戦略の最重要指標であり、記事を書く前にこれを見る必要がある。
 */
export function intentMix(rows: QueryAgg[], brandTerms: string[]): IntentMix {
  const mix: IntentMix = { layer1: 0, layer2: 0, layer3: 0, brand: 0, total: 0 };
  for (const r of rows) {
    const imp = r.impressions;
    mix.total += imp;
    if (isBrandQuery(r.query, brandTerms)) {
      mix.brand += imp;
      continue;
    }
    const layer = estimateIntentLayer(r.query);
    if (layer === 1) mix.layer1 += imp;
    else if (layer === 2) mix.layer2 += imp;
    else mix.layer3 += imp;
  }
  return mix;
}

/** 意図ミックスが売上から遠い場合のサイトレベル所見。 */
export function intentMixInsight(mix: IntentMix): Insight | null {
  const nonBrand = mix.total - mix.brand;
  if (nonBrand < 500) return null; // 母数が小さいと誤判定になる
  const layer1Share = mix.layer1 / nonBrand;
  const layer3Share = mix.layer3 / nonBrand;
  if (layer1Share >= 0.15) return null;

  return {
    kind: "intent_mix",
    scope: "site",
    query: null,
    pagePath: null,
    title: `流入の${Math.round(layer3Share * 100)}%が情報収集層。発注検討層（第1層）は${Math.round(layer1Share * 100)}%しかない`,
    severity: "high",
    metric: {
      layer1: mix.layer1,
      layer2: mix.layer2,
      layer3: mix.layer3,
      brand: mix.brand,
      layer1Share: round(layer1Share, 3),
      layer3Share: round(layer3Share, 3),
    },
    // サイト全体の構造課題なので、個別クエリの機会より必ず上に来るよう高く置く
    opportunityScore: 100000,
    actionType: "new_article",
  };
}
