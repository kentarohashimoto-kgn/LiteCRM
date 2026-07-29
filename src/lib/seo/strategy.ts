/**
 * 集客戦略の計算（純関数・テスト対象）。
 * 戦略ドキュメント: docs/SEO_STRATEGY_2026-07.md
 *
 * この機能が無いと、日次PDCAは「目先の細かい改善だけを回す装置」になり、
 * 半年後に「順位は少し上がったが売上は変わらない」に着地する。
 * 目標から逆算した必要数値と現在値を毎日突き合わせ、
 * どの段が足りないのかを常に1つに特定するのが役割。
 */

/** ファネルの各段。上流から下流の順で並べる。 */
export type FunnelStageKey =
  | "impressions"
  | "clicks"
  | "sessions"
  | "inquiries"
  | "leads"
  | "opportunities"
  | "revenue";

export interface StrategyRates {
  /** 受注単価。平均ではなく中央値を使う（少数の大型案件に引きずられないため）。 */
  dealAmount: number;
  /** 成約率 = 受注 ÷ (受注+失注) */
  winRate: number;
  /** 商談化率 = 商談 ÷ 有効リード */
  oppRate: number;
  /** 有効率 = 有効リード ÷ 問合せ（スパム・対象外を除く） */
  validRate: number;
  /** CVR = 問合せ ÷ セッション */
  inquiryCvr: number;
  /** セッション ÷ クリック */
  sessionPerClick: number;
  /** CTR = クリック ÷ 表示回数 */
  ctr: number;
}

export const DEFAULT_RATES: StrategyRates = {
  dealAmount: 1_800_000,
  winRate: 0.485,
  oppRate: 0.25,
  validRate: 0.7,
  inquiryCvr: 0.02,
  sessionPerClick: 0.95,
  ctr: 0.04,
};

export interface FunnelTarget {
  stage: FunnelStageKey;
  label: string;
  target: number;
  actual: number;
  /** 達成率。目標が0なら null。 */
  achievement: number | null;
  gap: number;
}

export interface FunnelActuals {
  impressions: number;
  clicks: number;
  sessions: number;
  inquiries: number;
  leadsValid: number;
  opportunities: number;
  revenue: number;
}

const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

/**
 * 月間目標売上から、各段の必要数値を逆算する。
 * 下流（売上）から上流（表示回数）へ順に割り戻す。
 * レートが0のものはそこで打ち切り（0除算で無限大の目標が出るのを防ぐ）。
 */
export function buildFunnelTargets(
  monthlyRevenueTarget: number,
  rates: StrategyRates,
  actuals: FunnelActuals,
): FunnelTarget[] {
  const won = safeDiv(monthlyRevenueTarget, rates.dealAmount);
  const opportunities = safeDiv(won, rates.winRate);
  const leads = safeDiv(opportunities, rates.oppRate);
  const inquiries = safeDiv(leads, rates.validRate);
  const sessions = safeDiv(inquiries, rates.inquiryCvr);
  const clicks = safeDiv(sessions, rates.sessionPerClick);
  const impressions = safeDiv(clicks, rates.ctr);

  const rows: Array<{ stage: FunnelStageKey; label: string; target: number; actual: number }> = [
    { stage: "impressions", label: "表示回数", target: impressions, actual: actuals.impressions },
    { stage: "clicks", label: "クリック", target: clicks, actual: actuals.clicks },
    { stage: "sessions", label: "セッション", target: sessions, actual: actuals.sessions },
    { stage: "inquiries", label: "問合せ", target: inquiries, actual: actuals.inquiries },
    { stage: "leads", label: "有効リード", target: leads, actual: actuals.leadsValid },
    { stage: "opportunities", label: "商談", target: opportunities, actual: actuals.opportunities },
    { stage: "revenue", label: "売上", target: monthlyRevenueTarget, actual: actuals.revenue },
  ];

  return rows.map((r) => ({
    ...r,
    target: Math.round(r.target * 100) / 100,
    achievement: r.target > 0 ? r.actual / r.target : null,
    gap: Math.max(0, Math.round((r.target - r.actual) * 100) / 100),
  }));
}

/**
 * ボトルネック（最も達成率が低い段）を1つ返す。
 * 「どこを直せば一番効くか」を毎日1つに絞るための関数。
 * 同率なら上流を優先する（上流が詰まっていると下流はどうやっても改善しないため）。
 */
export function findBottleneck(targets: FunnelTarget[]): FunnelTarget | null {
  let best: FunnelTarget | null = null;
  for (const t of targets) {
    if (t.achievement == null) continue;
    if (!best || t.achievement < best.achievement!) best = t;
  }
  return best;
}

/**
 * ボトルネックを解消したとき、追加で何件の問合せが得られるか。
 * 「CVRを2%にすれば追加流入ゼロで問合せ+3件」のような示し方をするための計算。
 */
export function inquiryUpliftFromCvr(sessions: number, currentCvr: number, targetCvr: number): number {
  if (sessions <= 0 || targetCvr <= currentCvr) return 0;
  return Math.round(sessions * (targetCvr - currentCvr) * 10) / 10;
}

export interface ClusterProgress {
  id: string;
  name: string;
  priority: number;
  hasPillar: boolean;
  articleCount: number;
  targetArticleCount: number;
  completionRate: number;
  clicks: number;
  inquiries: number;
  revenue: number;
  status: string;
}

/** クラスタの完成度。ピラーページの有無を1本分として数える。 */
export function completionRate(hasPillar: boolean, articleCount: number, target: number): number {
  const denom = Math.max(1, target + 1); // ピラー1 + 記事target本
  const num = (hasPillar ? 1 : 0) + Math.min(articleCount, target);
  return Math.round((num / denom) * 100) / 100;
}

export interface IntentCoverage {
  layer: 1 | 2 | 3;
  label: string;
  keywordCount: number;
  rankedTop10: number;
  coverageRate: number | null;
  impressions: number;
  clicks: number;
}

export const INTENT_LABELS: Record<1 | 2 | 3, string> = {
  1: "第1層 比較検討（今すぐ客）",
  2: "第2層 課題認識（そのうち客）",
  3: "第3層 情報収集",
};

/** 意図層ごとのカバレッジ率（10位以内に入っているKWの割合）。 */
export function coverageRate(rankedTop10: number, keywordCount: number): number | null {
  return keywordCount > 0 ? Math.round((rankedTop10 / keywordCount) * 1000) / 1000 : null;
}
