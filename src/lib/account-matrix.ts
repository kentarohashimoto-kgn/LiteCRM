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
  /** 従業員数(employee_size の自由入力から最小値を抽出したもの)。不明なら null */
  employees: number | null;
  /** 最終受注日(受注案件の完了予定日の最大)。受注実績が無ければ null */
  lastWonDate: string | null;
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

/** 会社名検索でヒットした顧客と、その顧客が居るセル(「どこにいるか」の案内用)。 */
export interface MatrixMatch {
  id: string;
  name: string;
  segmentKey: string;
  rank: string;
  won: number;
}

export interface AccountMatrix {
  settings: RankSettings;
  segments: MatrixSegment[];
  cells: MatrixCell[];
  /** 会社名検索をしたときだけ入る。上限 MAX_MATCHES 件 */
  matches: MatrixMatch[];
}

/** 検索ヒット一覧に出す上限。RPC 側(account_segment_matrix)の打ち切りと合わせること。 */
export const MAX_MATCHES = 30;

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

/* =====================================================================
 * 絞り込み
 * =====================================================================
 * 画面の選択(MatrixFilterState) → RPC に渡す条件(MatrixFilter) の変換をここに置く。
 * 「直近3ヶ月」「今期」のような相対期間は、変換の時点で日付に落としてから渡す
 * (DB 側で now() を使うと、テストで固定できず期首の扱いも二重管理になるため)。
 */

/** RPC(account_segment_matrix / account_segment_rank_accounts)の p_filter。 */
export interface MatrixFilter {
  /** 会社名。表記ゆれを吸収して部分一致(company_search_key) */
  q?: string;
  /** 担当営業のユーザーID。"__none" で未割当 */
  owner?: string[];
  area?: string[];
  /** 顧客区分(prospect / customer / inactive) */
  status?: string[];
  empMin?: number;
  empMax?: number;
  /** 従業員数の記載が無い顧客だけ */
  empUnknown?: boolean;
  wonMin?: number;
  wonMax?: number;
  /** open = 進行中案件あり / none = 進行中案件なし */
  openState?: "open" | "none";
  wonFrom?: string;
  wonTo?: string;
  /** 最終受注日がこの日より前(=しばらく受注が無い) */
  lastWonBefore?: string;
  /** 受注実績が1件も無い顧客だけ */
  wonNone?: boolean;
}

/** 絞り込みバーの選択状態。単一選択の3つ(規模・取引額・時期)はプリセットのキーを持つ。 */
export interface MatrixFilterState {
  q: string;
  owner: string[];
  area: string[];
  status: string[];
  size: string;
  deal: string;
  period: string;
  openState: string;
}

export const EMPTY_MATRIX_FILTER: MatrixFilterState = {
  q: "", owner: [], area: [], status: [], size: "", deal: "", period: "", openState: "",
};

/** 顧客区分。accounts.status の値と表示名(顧客一覧と同じ語彙)。 */
export const MATRIX_STATUS_OPTIONS = [
  { key: "prospect", label: "見込み" },
  { key: "customer", label: "顧客" },
  { key: "inactive", label: "休眠" },
];

/** 会社規模(従業員数)のプリセット。employee_size の自由入力から抽出した人数で判定する。 */
export const MATRIX_SIZE_OPTIONS: { key: string; label: string; min?: number; max?: number; unknown?: boolean }[] = [
  { key: "1000", label: "1,000名以上（大企業）", min: 1000 },
  { key: "300", label: "300〜999名", min: 300, max: 999 },
  { key: "100", label: "100〜299名（中堅）", min: 100, max: 299 },
  { key: "30", label: "30〜99名", min: 30, max: 99 },
  { key: "1", label: "29名以下", max: 29 },
  { key: "unknown", label: "規模の記載なし", unknown: true },
];

/** カトルセとの累計取引額(受注済み案件の合計)のプリセット。 */
export const MATRIX_DEAL_OPTIONS: { key: string; label: string; min?: number; max?: number; none?: boolean }[] = [
  { key: "100m", label: "1億円以上", min: 100000000 },
  { key: "30m", label: "3,000万円以上", min: 30000000 },
  { key: "10m", label: "1,000万円以上", min: 10000000 },
  { key: "1m", label: "100万円以上", min: 1000000 },
  { key: "any", label: "取引実績あり", min: 1 },
  { key: "none", label: "取引実績なし", none: true },
];

/**
 * 取引時期(受注時期)のプリセット。
 * months = 直近Nヶ月に受注あり / fiscal = 年度指定(0=今期, -1=前期) / stale = N ヶ月以上受注なし。
 */
export const MATRIX_PERIOD_OPTIONS: { key: string; label: string; months?: number; fiscal?: number; stale?: number }[] = [
  { key: "3m", label: "直近3ヶ月に受注", months: 3 },
  { key: "6m", label: "直近6ヶ月に受注", months: 6 },
  { key: "12m", label: "直近1年に受注", months: 12 },
  { key: "fy", label: "今期に受注", fiscal: 0 },
  { key: "fy-1", label: "前期に受注", fiscal: -1 },
  { key: "stale12", label: "1年以上受注なし", stale: 12 },
  { key: "stale24", label: "2年以上受注なし", stale: 24 },
];

export const MATRIX_OPEN_OPTIONS = [
  { key: "open", label: "進行中案件あり" },
  { key: "none", label: "進行中案件なし" },
];

/** 会計年度の開始月(7月)。fiscal.ts の FISCAL_START_MONTH と同値。 */
const FISCAL_START = 7;

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 画面の選択を RPC の条件に変換する。空の項目は落として、条件なしと同じ形にする。 */
export function buildMatrixFilter(s: MatrixFilterState, today: Date = new Date()): MatrixFilter {
  const f: MatrixFilter = {};

  const q = s.q.trim();
  if (q) f.q = q;
  if (s.owner.length) f.owner = s.owner;
  if (s.area.length) f.area = s.area;
  if (s.status.length) f.status = s.status;
  if (s.openState === "open" || s.openState === "none") f.openState = s.openState;

  const size = MATRIX_SIZE_OPTIONS.find((o) => o.key === s.size);
  if (size) {
    if (size.unknown) f.empUnknown = true;
    if (size.min !== undefined) f.empMin = size.min;
    if (size.max !== undefined) f.empMax = size.max;
  }

  const deal = MATRIX_DEAL_OPTIONS.find((o) => o.key === s.deal);
  if (deal) {
    if (deal.none) f.wonNone = true;
    if (deal.min !== undefined) f.wonMin = deal.min;
    if (deal.max !== undefined) f.wonMax = deal.max;
  }

  const period = MATRIX_PERIOD_OPTIONS.find((o) => o.key === s.period);
  if (period) {
    if (period.months !== undefined) {
      const from = new Date(today.getFullYear(), today.getMonth() - period.months, today.getDate());
      f.wonFrom = ymd(from);
    }
    if (period.fiscal !== undefined) {
      // 今期 = 7月1日〜翌6月30日。fiscal は年度のオフセット(0=今期, -1=前期)
      const startYear =
        (today.getMonth() + 1 >= FISCAL_START ? today.getFullYear() : today.getFullYear() - 1) + period.fiscal;
      f.wonFrom = ymd(new Date(startYear, FISCAL_START - 1, 1));
      f.wonTo = ymd(new Date(startYear + 1, FISCAL_START - 1, 0));
    }
    if (period.stale !== undefined) {
      f.lastWonBefore = ymd(new Date(today.getFullYear(), today.getMonth() - period.stale, today.getDate()));
    }
  }

  return f;
}

/** 1つでも絞り込みが掛かっているか(リセットボタンの活性判定・件数表示の出し分けに使う)。 */
export function hasMatrixFilter(s: MatrixFilterState): boolean {
  return (
    s.q.trim() !== "" ||
    s.owner.length > 0 ||
    s.area.length > 0 ||
    s.status.length > 0 ||
    s.size !== "" ||
    s.deal !== "" ||
    s.period !== "" ||
    s.openState !== ""
  );
}
