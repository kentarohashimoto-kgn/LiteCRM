/**
 * 案件管理（デリバリー原価・粗利管理）の純粋計算ロジック。
 *
 * DB・UIに依存しない関数群。ここで「月別の原価積み上げ・粗利・提案可否・値引き余地・
 * 予実差異」を一元的に計算する（xray.ts と同じく純ロジックを集約してテスト可能にする方針）。
 *
 * 用語:
 *  - cost_rate  : アサイン者の1人月あたり原価（外注費・社内人件費）
 *  - man_month  : その月に投下する人月（0.5 = 半人月）
 *  - ratio      : 月内の稼働割合 0..1（月途中の開始/終了。中旬開始=0.5）
 *  - 行原価(月) : cost_rate × man_month × ratio
 */

export type RiskLevel = "low" | "middle" | "high";
export type Involvement = "none" | "low" | "middle" | "high";
export type Verdict = "go" | "conditional" | "review";
/** 単価の種類: 人月単価 / 時給。 */
export type RateUnit = "man_month" | "hourly";
/** 工数の記述方法: 率(人月×稼働率) / 時間(h)。 */
export type EffortUnit = "ratio" | "hours";

/** 1人月あたりの標準労働時間(工数換算の既定)。人月単価⇔時給、率⇔時間の換算に使う。 */
export const DEFAULT_HOURS_PER_MONTH = 160;

/** アサイン1行 × 1ヶ月の原価セル。month は "YYYY-MM"。 */
export interface CostCell {
  month: string;
  /** 率モードの人月。 */
  manMonth?: number;
  /** 率モードの稼働率 0..1。 */
  ratio?: number;
  /** 時間モードの投下時間(h)。 */
  hours?: number;
}

/** アサイン（人材×役割×単価）と月別のセル。 */
export interface Assignment {
  id: string;
  label: string;
  /** 単価。rateUnit に応じて 円/人月 または 円/時 と解釈。 */
  costRate: number;
  /** 単価の種類(既定 man_month)。 */
  rateUnit?: RateUnit;
  /** 工数の記述方法(既定 ratio)。 */
  effortUnit?: EffortUnit;
  /** 1人月あたり時間(既定 160)。時給⇔人月、率⇔時間の換算に使用。 */
  hoursPerMonth?: number;
  cells: CostCell[];
}

/** 月別の販売（売上）計画。 */
export interface RevenueCell {
  month: string;
  amount: number;
}

/** ゲート判定のしきい値（テナント設定で調整可能）。 */
export interface Thresholds {
  /** これ以上で GO（既定 0.40） */
  go: number;
  /** これ以上で 条件付き（既定 0.25）。未満は 要協議 */
  conditional: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { go: 0.4, conditional: 0.25 };

/** 数値を安全に丸める（小数の誤差対策）。円単位は0桁、率は4桁など呼び出し側で指定。 */
export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** セルの実効人月。率モード=人月×稼働率、時間モード=時間÷(1人月時間)。 */
export function effectivePM(cell: CostCell, effortUnit: EffortUnit = "ratio", hoursPerMonth = DEFAULT_HOURS_PER_MONTH): number {
  if (effortUnit === "hours") {
    const H = hoursPerMonth || DEFAULT_HOURS_PER_MONTH;
    return H > 0 ? (cell.hours || 0) / H : 0;
  }
  return (cell.manMonth || 0) * (cell.ratio ?? 1);
}

export interface CellCostInput {
  costRate: number;
  rateUnit?: RateUnit;
  effortUnit?: EffortUnit;
  hoursPerMonth?: number;
  manMonth?: number;
  ratio?: number;
  hours?: number;
}

/**
 * 行原価(月)。単価の種類(人月/時給)と工数の記述(率/時間)の4通りに対応。
 *  - 人月単価 × 実効人月     (rateUnit=man_month)
 *  - 時給     × 実効時間     (rateUnit=hourly)
 * 実効人月・実効時間は hoursPerMonth で相互換算する。負値・NaNは0。
 */
export function computeCellCost(p: CellCostInput): number {
  const H = p.hoursPerMonth || DEFAULT_HOURS_PER_MONTH;
  const eu = p.effortUnit ?? "ratio";
  const cell: CostCell = { month: "", manMonth: p.manMonth, ratio: p.ratio, hours: p.hours };
  const pm = effectivePM(cell, eu, H);
  const hours = eu === "hours" ? p.hours || 0 : pm * H;
  const rate = p.costRate || 0;
  const v = (p.rateUnit ?? "man_month") === "hourly" ? rate * hours : rate * pm;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 行原価(月) = 人月単価 × 人月 × 稼働率(率モードの簡易版・後方互換)。負値・NaNは0。 */
export function cellCost(costRate: number, manMonth: number, ratio: number): number {
  return computeCellCost({ costRate, manMonth, ratio });
}

/** アサイン1件の原価合計（全月）。単価種別・工数記述を考慮。 */
export function assignmentCost(a: Assignment): number {
  return a.cells.reduce(
    (s, c) => s + computeCellCost({ costRate: a.costRate, rateUnit: a.rateUnit, effortUnit: a.effortUnit, hoursPerMonth: a.hoursPerMonth, manMonth: c.manMonth, ratio: c.ratio, hours: c.hours }),
    0
  );
}

/** アサイン1件の投下人月合計（実効人月）。 */
export function assignmentEffortMM(a: Assignment): number {
  return a.cells.reduce((s, c) => s + effectivePM(c, a.effortUnit, a.hoursPerMonth), 0);
}

/** 粗利率 = 粗利 ÷ 販売。販売0なら0を返す（0除算ガード）。 */
export function grossRate(revenue: number, cost: number): number {
  if (!revenue || revenue <= 0) return 0;
  return (revenue - cost) / revenue;
}

export interface MonthRow {
  month: string;
  revenue: number;
  cost: number;
  gross: number;
  grossRate: number;
}

export interface RollupTotals {
  revenue: number;
  cost: number;
  gross: number;
  grossRate: number;
}

export interface Rollup {
  months: MonthRow[]; // 昇順
  totals: RollupTotals;
}

/**
 * アサイン群と販売計画を、月別（revenue/cost/gross/grossRate）に集計する。
 * 対象月は販売・原価いずれかに現れる全月の和集合。数ヶ月案件は各月を合算する。
 */
export function rollup(assignments: Assignment[], revenue: RevenueCell[]): Rollup {
  const costByMonth = new Map<string, number>();
  for (const a of assignments) {
    for (const c of a.cells) {
      const cost = computeCellCost({ costRate: a.costRate, rateUnit: a.rateUnit, effortUnit: a.effortUnit, hoursPerMonth: a.hoursPerMonth, manMonth: c.manMonth, ratio: c.ratio, hours: c.hours });
      costByMonth.set(c.month, (costByMonth.get(c.month) ?? 0) + cost);
    }
  }
  const revByMonth = new Map<string, number>();
  for (const r of revenue) revByMonth.set(r.month, (revByMonth.get(r.month) ?? 0) + (r.amount || 0));

  const monthsSet = new Set<string>([...costByMonth.keys(), ...revByMonth.keys()]);
  const months = [...monthsSet].sort();

  const rows: MonthRow[] = months.map((month) => {
    const rev = revByMonth.get(month) ?? 0;
    const cost = costByMonth.get(month) ?? 0;
    const gross = rev - cost;
    return { month, revenue: rev, cost, gross, grossRate: grossRate(rev, cost) };
  });

  const tRev = rows.reduce((s, r) => s + r.revenue, 0);
  const tCost = rows.reduce((s, r) => s + r.cost, 0);
  const totals: RollupTotals = {
    revenue: tRev,
    cost: tCost,
    gross: tRev - tCost,
    grossRate: grossRate(tRev, tCost),
  };
  return { months: rows, totals };
}

/**
 * 値引きの下限価格 = 原価 ÷ (1 − 最低粗利率)。
 * 最低粗利率が1以上や負なら原価をそのまま返す（不正入力ガード）。
 */
export function minPrice(cost: number, minGrossRate: number): number {
  if (minGrossRate <= 0) return cost;
  if (minGrossRate >= 1) return Infinity;
  return cost / (1 - minGrossRate);
}

export interface DiscountRoom {
  minPrice: number;
  /** 定価から下限価格までの値引き可能額（負なら定価が下限割れ）。 */
  roomAmount: number;
  /** 値引き可能率（roomAmount ÷ 定価）。 */
  roomPct: number;
}

/** 定価・原価・最低粗利率から、許容できる値引き余地を求める。 */
export function discountRoom(listPrice: number, cost: number, minGrossRate: number): DiscountRoom {
  const mp = minPrice(cost, minGrossRate);
  const room = listPrice - mp;
  return {
    minPrice: mp,
    roomAmount: room,
    roomPct: listPrice > 0 ? room / listPrice : 0,
  };
}

/**
 * 提案可否ゲート。粗利率で基準レベルを出し、リスク・本部関与で1段階まで引き下げる。
 *  - grossRate ≥ go        → go
 *  - conditional ≤ … < go  → conditional
 *  - … < conditional       → review
 * リスク=high または 本部関与=high のとき、1段階シビアにする（go→conditional, conditional→review）。
 */
export function proposalVerdict(input: {
  grossRate: number;
  risk?: RiskLevel;
  involvement?: Involvement;
  thresholds?: Thresholds;
}): Verdict {
  const th = input.thresholds ?? DEFAULT_THRESHOLDS;
  let level: Verdict = input.grossRate >= th.go ? "go" : input.grossRate >= th.conditional ? "conditional" : "review";
  const severe = input.risk === "high" || input.involvement === "high";
  if (severe) level = downgrade(level);
  return level;
}

function downgrade(v: Verdict): Verdict {
  return v === "go" ? "conditional" : v === "conditional" ? "review" : "review";
}

/* ===================== Phase 2: 予実（週次・月次） ===================== */

export type VarianceStatus = "on_track" | "watch" | "over";

export interface Variance {
  planned: number;
  actual: number;
  diff: number; // actual − planned（原価/工数は プラスが超過）
  pct: number; // diff ÷ planned
  status: VarianceStatus;
}

/**
 * 予実差異（原価や工数など「少ないほど良い」指標向け）。
 *  - actual ≤ planned              → on_track
 *  - planned < actual ≤ planned×(1+watch) → watch
 *  - それ以上                       → over
 * planned=0 のときは actual>0 で over、0で on_track。
 */
export function costVariance(planned: number, actual: number, watchPct = 0.05): Variance {
  const diff = actual - planned;
  const pct = planned > 0 ? diff / planned : actual > 0 ? 1 : 0;
  let status: VarianceStatus;
  if (planned <= 0) status = actual > 0 ? "over" : "on_track";
  else if (actual <= planned) status = "on_track";
  else if (actual <= planned * (1 + watchPct)) status = "watch";
  else status = "over";
  return { planned, actual, diff, pct, status };
}

/**
 * 完了時原価見込み（EAC）。実績消化と残計画から着地原価を見積もる簡易版。
 * EAC = 実績原価 + 残りの計画原価。残計画は「計画総額 − 実績時点までの計画消化」で近似。
 */
export function estimateAtCompletion(input: {
  planTotalCost: number;
  plannedToDate: number;
  actualToDate: number;
}): number {
  const remainingPlan = Math.max(0, input.planTotalCost - input.plannedToDate);
  return input.actualToDate + remainingPlan;
}
