/**
 * リードスコアリング設計(F-201)の共有定義 — 純粋データ。
 * ルール評価本体はSQL(rescore_leads / 0174)。UI・バリデーションがここを参照する。
 */

export const MATCH_KINDS = [
  { key: "employee_gte", label: "従業員数が◯人以上", hint: "数値(例: 300)" },
  { key: "role_level_in", label: "役職レベルが一致", hint: "exec,officer,manager,staff をカンマ区切り" },
  { key: "title_regex", label: "役職名に含む", hint: "キーワード。複数は | 区切り(例: 部長|本部長)" },
  { key: "industry_includes", label: "業界に含む", hint: "キーワード。複数は | 区切り(例: 製造|物流)" },
  { key: "needs_in", label: "課題温度が一致", hint: "high,mid,low をカンマ区切り" },
  { key: "timing_in", label: "導入時期が一致", hint: "now,soon をカンマ区切り" },
  { key: "budget_in", label: "予算が一致", hint: "yes,considering,no をカンマ区切り" },
  { key: "text_includes", label: "課題・メモ・タグに含む", hint: "キーワード。複数は | 区切り(例: AI導入|研修)" },
] as const;

export type MatchKind = (typeof MATCH_KINDS)[number]["key"];

/** パターン(正規表現)として検証が必要な条件種別。 */
export const REGEX_KINDS = new Set<string>(["title_regex", "industry_includes", "text_includes"]);

export const MATCH_KIND_MAP: Record<string, { label: string; hint: string }> = Object.fromEntries(
  MATCH_KINDS.map((k) => [k.key, { label: k.label, hint: k.hint }]),
);

/** 軸の集計方法の表示。 */
export const AGG_LABEL: Record<string, string> = {
  max: "段階判定（最も高い1つを採用）",
  sum: "加点式（該当分を合算・上限あり）",
};
