/**
 * 順位別のベンチマークCTRと検索意図の判定（純関数・テスト対象）。
 *
 * 「順位のわりにクリックされていない」を機械的に判定するための基準。
 * ここが無いと、CTR改善の余地があるページを人が勘で探すことになる。
 *
 * 値は一般的な実測レンジの中央付近を採用。データが3ヶ月貯まったら
 * 自サイト実測のCTRカーブに置き換える（設計書 §8.2 の学習項目）。
 */

/** 順位 → 期待CTR。11位以降は2ページ目扱いで一律低い。 */
const CTR_CURVE: Array<{ maxPos: number; ctr: number }> = [
  { maxPos: 1, ctr: 0.28 },
  { maxPos: 2, ctr: 0.15 },
  { maxPos: 3, ctr: 0.11 },
  { maxPos: 4, ctr: 0.08 },
  { maxPos: 5, ctr: 0.06 },
  { maxPos: 6, ctr: 0.045 },
  { maxPos: 7, ctr: 0.035 },
  { maxPos: 8, ctr: 0.03 },
  { maxPos: 9, ctr: 0.025 },
  { maxPos: 10, ctr: 0.022 },
  { maxPos: 20, ctr: 0.01 },
  { maxPos: 50, ctr: 0.003 },
];

/** その順位で期待されるCTR。順位が不明なら null。 */
export function benchmarkCtr(position: number | null): number | null {
  if (position == null || !Number.isFinite(position) || position <= 0) return null;
  for (const step of CTR_CURVE) {
    if (position <= step.maxPos) return step.ctr;
  }
  return 0.001;
}

/**
 * 検索意図の層を推定する。
 *   1 = 比較検討（今すぐ客）… 発注先を探している
 *   2 = 課題認識（そのうち客）… 課題は自覚、手段は未定
 *   3 = 情報収集 … 学習中・個人利用も混在。売上には遠い
 *
 * 台帳(seo_keywords.intent_layer)に人が登録した値があればそちらが正。
 * これはあくまで未分類KWの初期推定に使う。
 */
const LAYER1_WORDS = [
  "会社", "企業", "法人", "業者", "ベンダー", "料金", "費用", "価格", "相場", "見積",
  "比較", "おすすめ", "ランキング", "依頼", "外注", "発注", "導入", "相談", "研修", "顧問", "コンサル", "支援", "代行",
];
const LAYER2_WORDS = [
  "できない", "進まない", "定着", "失敗", "課題", "対策", "方法", "やり方", "作り方", "選び方",
  "ルール", "ガイドライン", "ポリシー", "リスク", "セキュリティ", "情報漏洩", "効果測定", "事例", "運用",
];

export function estimateIntentLayer(query: string): 1 | 2 | 3 {
  const q = (query ?? "").toLowerCase();
  if (LAYER1_WORDS.some((w) => q.includes(w.toLowerCase()))) return 1;
  if (LAYER2_WORDS.some((w) => q.includes(w.toLowerCase()))) return 2;
  return 3;
}

/** 商用意図の係数。売上に近いクエリほど高く、機会スコアを押し上げる。 */
export function commercialWeight(query: string): number {
  const layer = estimateIntentLayer(query);
  return layer === 1 ? 1.5 : layer === 2 ? 1.0 : 0.6;
}

/** 指名検索（自社名）か。指名は既に認知済みで、SEO施策の対象にしない。 */
export function isBrandQuery(query: string, brandTerms: string[]): boolean {
  const q = (query ?? "").toLowerCase().replace(/\s+/g, "");
  return brandTerms.some((b) => b && q.includes(b.toLowerCase().replace(/\s+/g, "")));
}

/** 施策の実現容易性。低コストな施策ほど高く、機会スコアを押し上げる。 */
export const EFFORT_WEIGHT: Record<string, number> = {
  title_meta: 1.2,
  rewrite: 1.0,
  internal_link: 1.1,
  new_article: 0.7,
  merge_pages: 0.8,
  technical: 1.0,
};
