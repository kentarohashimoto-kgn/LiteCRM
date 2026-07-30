import type { StrategyRates } from "./strategy";

/**
 * 施策の期待値換算と優先度付け（純関数・テスト対象）。
 *
 * この機能の中核。SEO施策の優先度を「順位」や「CTR」ではなく
 * **月いくら増えるか** で並べる。分母はすべてCRMの実績値なので、
 * 記事執筆とフォーム改善を同じ土俵で比較できる。
 *
 * 期待値の算術はここ（アプリ）で確定させ、AIには渡すだけにする。
 * AIに優先度を主観で付けさせると日によって順序が揺れ、PDCAが続かない。
 */

export interface ExpectedValue {
  clicks: number;
  sessions: number;
  inquiries: number;
  leads: number;
  opportunities: number;
  revenue: number;
}

/** 追加見込みクリックから、月あたりの期待売上までを一気通貫で換算する。 */
export function expectedValueFromClicks(extraClicks: number, rates: StrategyRates): ExpectedValue {
  const clicks = Math.max(0, extraClicks);
  const sessions = clicks * rates.sessionPerClick;
  const inquiries = sessions * rates.inquiryCvr;
  const leads = inquiries * rates.validRate;
  const opportunities = leads * rates.oppRate;
  const revenue = opportunities * rates.winRate * rates.dealAmount;
  const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    clicks: Math.round(clicks),
    sessions: r(sessions, 1),
    inquiries: r(inquiries),
    leads: r(leads),
    opportunities: r(opportunities),
    revenue: Math.round(revenue),
  };
}

/**
 * CVR改善施策の期待値。
 * 追加流入ゼロで問合せを増やすため、クリック起点とは計算式が違う。
 */
export function expectedValueFromCvr(
  currentSessions: number,
  currentCvr: number,
  targetCvr: number,
  rates: StrategyRates,
): ExpectedValue {
  const deltaInquiries = Math.max(0, currentSessions * (targetCvr - currentCvr));
  const leads = deltaInquiries * rates.validRate;
  const opportunities = leads * rates.oppRate;
  const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    clicks: 0,
    sessions: 0,
    inquiries: r(deltaInquiries),
    leads: r(leads),
    opportunities: r(opportunities),
    revenue: Math.round(opportunities * rates.winRate * rates.dealAmount),
  };
}

/** 施策タイプごとの初期値。実績が貯まれば seo_playbook_stats で置き換える（WO-36）。 */
export const ACTION_PRIORS: Record<string, { effort: number; confidence: number; label: string }> = {
  title_meta: { effort: 1, confidence: 0.7, label: "タイトル・説明文の改善" },
  internal_link: { effort: 1.5, confidence: 0.6, label: "内部リンクの追加" },
  technical: { effort: 2, confidence: 0.5, label: "技術的な修正" },
  cta_form: { effort: 3, confidence: 0.6, label: "CTA・フォームの改善" },
  rewrite: { effort: 4, confidence: 0.5, label: "既存記事のリライト" },
  merge_pages: { effort: 5, confidence: 0.4, label: "重複ページの統合" },
  new_article: { effort: 8, confidence: 0.4, label: "新規記事の作成" },
};

export interface IceScore {
  impact: number;
  confidence: number;
  effort: number;
  score: number;
  strategyWeight: number;
}

export interface StrategyWeights {
  priorityCluster: number;
  layer1: number;
  currentPhase: number;
}

export const DEFAULT_WEIGHTS: StrategyWeights = { priorityCluster: 1.5, layer1: 1.3, currentPhase: 1.2 };

/**
 * ICEスコア。Impact は期待売上を対数スケールで1〜10に正規化する。
 * 対数にするのは、¥100万と¥1,000万の差を10倍として扱うと
 * 大型の1件が他を全部押し流してしまうため。
 */
export function impactFromRevenue(monthlyRevenue: number): number {
  if (monthlyRevenue <= 0) return 0;
  // ¥1万→1, ¥10万→3.3, ¥100万→5.5, ¥1000万→7.8 程度になる
  const v = (Math.log10(monthlyRevenue) - 3) * 2.2;
  return Math.max(0, Math.min(10, Math.round(v * 100) / 100));
}

/**
 * 最終スコア = Impact × Confidence × 10 ÷ Effort × 戦略係数
 *
 * 戦略係数を掛ける理由: 期待売上だけで並べると、短期に効くCTR改善ばかりが
 * 上位を占め、3ヶ月後に効くクラスタ構築が永久に後回しになる。
 * この近視眼を補正するための仕組み。
 */
export function iceScore(
  expectedRevenue: number,
  actionType: string,
  flags: { priorityCluster?: boolean; layer1?: boolean; currentPhase?: boolean },
  weights: StrategyWeights = DEFAULT_WEIGHTS,
  confidenceOverride?: number,
): IceScore {
  const prior = ACTION_PRIORS[actionType] ?? { effort: 4, confidence: 0.5, label: actionType };
  const impact = impactFromRevenue(expectedRevenue);
  const confidence = confidenceOverride ?? prior.confidence;
  const effort = prior.effort;

  let strategyWeight = 1;
  if (flags.priorityCluster) strategyWeight *= weights.priorityCluster;
  if (flags.layer1) strategyWeight *= weights.layer1;
  if (flags.currentPhase) strategyWeight *= weights.currentPhase;

  const score = (impact * confidence * 10) / effort * strategyWeight;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { impact, confidence, effort, strategyWeight: r(strategyWeight), score: r(score) };
}

/**
 * 提案のクールダウン判定。
 * 同じ対象・同じ施策タイプを毎日出し続けると画面が同じ提案で埋まり、
 * 承認する意味が失われる。却下されたものはさらに長く出さない。
 */
export interface CooldownInput {
  lastProposedAt: string | null;
  lastStatus: string | null;
  rejectReason: string | null;
  today: string;
}

const DAYS = (a: string, b: string) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);

export function isInCooldown(input: CooldownInput): boolean {
  if (!input.lastProposedAt) return false;
  const elapsed = DAYS(input.today, input.lastProposedAt.slice(0, 10));
  if (input.lastStatus === "rejected") {
    // 「今はやらない」だけなら短め、「的外れ」なら長く出さない
    return elapsed < (input.rejectReason === "not_now" ? 7 : 30);
  }
  if (input.lastStatus === "approved") return elapsed < 14; // 効果検証が終わるまで再提案しない
  return elapsed < 3; // 未承認のまま溜まっているものは3日は再作成しない
}
