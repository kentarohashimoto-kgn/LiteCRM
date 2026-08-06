/**
 * 顧客分析マトリクス(セグメント × ランク)の共通定義。
 * 集計ロジックの正は RPC 側(0204_account_segment_matrix.sql)。ここは型と表示用の定義のみ。
 */

/** 未分類セルのキー。RPC 側と合わせること。 */
export const UNSEGMENTED_KEY = "__none__";

/** 折りたたみ時に見せるセグメント数。「もっと見る」で全件に切り替える。 */
export const DEFAULT_VISIBLE_SEGMENTS = 5;

/** セルに顧客名を出す上限。超過分は「他N社」からセル明細を開く。 */
export const MAX_ACCOUNTS_PER_CELL = 8;

/** セグメント色の既定値(未設定時)。 */
export const DEFAULT_SEGMENT_COLOR = "#008C8C";

/** 新規セグメント作成時に選べる色(提案書デザインガイドのトーンに合わせた12色)。 */
export const SEGMENT_COLOR_CHOICES = [
  "#008C8C", "#F59A2A", "#3B82F6", "#8B5CF6", "#10B981", "#EC4899",
  "#F97316", "#0EA5E9", "#6366F1", "#EF4444", "#14B8A6", "#A855F7",
];

export interface MatrixAccount {
  id: string;
  name: string;
  industry: string | null;
  area: string | null;
  status: string;
  ownerName: string | null;
  won: number;
  openAmount: number;
  oppCount: number;
  openCount: number;
  /** ランクが自動判定(手動未設定)かどうか */
  rankAuto: boolean;
  /** セグメントが手動割当かどうか(false = industry からの自動マッピング) */
  segmentManual: boolean;
}

export interface MatrixSegment {
  id: string;
  name: string;
  color: string | null;
  keywords: string[];
  sortOrder: number;
  isVisible: boolean;
}

export interface MatrixCell {
  /** セグメントID、または未分類なら UNSEGMENTED_KEY */
  segmentKey: string;
  rank: string;
  count: number;
  won: number;
  openAmount: number;
  /** 上位 MAX_ACCOUNTS_PER_CELL 件のみ */
  accounts: MatrixAccount[];
}

/** ランク自動判定の閾値。account_rank_settings の1行に対応。 */
export interface RankSettings {
  s_revenue: number;
  a_revenue: number;
  a_potential: number;
  b_potential: number;
  s_employees: number;
  a_employees: number;
}

export interface AccountMatrix {
  settings: RankSettings;
  segments: MatrixSegment[];
  cells: MatrixCell[];
}

export const DEFAULT_RANK_SETTINGS: RankSettings = {
  s_revenue: 100000000,
  a_revenue: 10000000,
  a_potential: 100000000,
  b_potential: 10000000,
  s_employees: 1000,
  a_employees: 100,
};

/** マトリクスの列(ランク)。ACCOUNT_RANKS と同じ S>A>B>C>D の順。 */
export const MATRIX_RANKS: { key: string; label: string; color: string }[] = [
  { key: "S", label: "S", color: "bg-accent-orange text-white" },
  { key: "A", label: "A", color: "bg-teal-primary text-white" },
  { key: "B", label: "B", color: "bg-teal-light text-teal-deep" },
  { key: "C", label: "C", color: "bg-mist-soft text-ink/70 border border-black/5" },
  { key: "D", label: "D", color: "bg-mist-soft text-ink/40" },
];

/**
 * 閾値からランクの判定条件を日本語で組み立てる(凡例・ツールチップ用)。
 * 実際の判定は RPC 側で行うので、ここは説明文の生成だけ。
 */
export function rankCriteria(s: RankSettings): Record<string, string> {
  const oku = (n: number) => {
    if (n >= 100000000) return `${trimNum(n / 100000000)}億円`;
    if (n >= 10000) return `${trimNum(n / 10000)}万円`;
    return `${n.toLocaleString("ja-JP")}円`;
  };
  return {
    S: `大企業(${s.s_employees.toLocaleString("ja-JP")}名〜) または 累計受注 ${oku(s.s_revenue)}以上`,
    A: `中堅企業(${s.a_employees.toLocaleString("ja-JP")}名〜) または 累計受注 ${oku(s.a_revenue)}以上 または 進行中見込み ${oku(s.a_potential)}以上`,
    B: `累計受注あり または 進行中見込み ${oku(s.b_potential)}以上`,
    C: "案件はあるが受注・上記見込みなし",
    D: "案件なし",
  };
}

/** 億・万に換算した後の数値。端数は小数1桁まで、桁区切りは付ける(1000万円 → 1,000万円)。 */
function trimNum(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}
