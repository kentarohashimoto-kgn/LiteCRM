/**
 * 経営レビュー(週次幹部MTG支援)のロジック。
 * Good/Watch/Bad 判定としきい値、システム考察コメントのテンプレート生成。
 * 判定ロジックは将来調整しやすいよう、しきい値を定数化している。
 */

export type Evaluation = "good" | "watch" | "bad";

export const EVALUATION_META: Record<Evaluation, { label: string; color: string; dot: string; order: number }> = {
  bad: { label: "Bad", color: "bg-rose-100 text-rose-600", dot: "bg-rose-500", order: 0 },
  watch: { label: "Watch", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500", order: 1 },
  good: { label: "Good", color: "bg-teal-light text-teal-deep", dot: "bg-teal-primary", order: 2 },
};

/** 達成率しきい値(後から調整可能)。 */
export const ACHIEVE_GOOD = 1.0;   // 100%以上=Good
export const ACHIEVE_WATCH = 0.7;  // 70%以上=Watch / 未満=Bad

/** 部門マスタ。 */
export const DEPARTMENTS: { key: string; label: string }[] = [
  { key: "sales", label: "営業" },
  { key: "marketing", label: "マーケ" },
  { key: "delivery", label: "デリバリー" },
  { key: "dev", label: "開発" },
  { key: "advisory", label: "顧問" },
];
export const DEPT_LABEL: Record<string, string> = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d.label]));

/** 営業KPI種別。実績は既存DBから自動集計する。 */
export const SALES_KPIS: { key: string; label: string; unit: "count" | "yen" }[] = [
  { key: "lead", label: "リード獲得", unit: "count" },
  { key: "appointment", label: "アポ獲得", unit: "count" },
  { key: "deal", label: "成約", unit: "count" },
  { key: "revenue", label: "受注金額", unit: "yen" },
  { key: "gross_profit", label: "粗利金額", unit: "yen" },
];
export const KPI_LABEL: Record<string, string> = Object.fromEntries(SALES_KPIS.map((k) => [k.key, k.label]));
export const KPI_UNIT: Record<string, "count" | "yen"> = Object.fromEntries(SALES_KPIS.map((k) => [k.key, k.unit]));

export const ACTION_STATUS: { key: string; label: string }[] = [
  { key: "open", label: "未着手" },
  { key: "in_progress", label: "対応中" },
  { key: "done", label: "完了" },
  { key: "hold", label: "保留" },
];
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(ACTION_STATUS.map((s) => [s.key, s.label]));
export const PRIORITY_LABEL: Record<string, string> = { high: "High", middle: "Middle", low: "Low" };

export interface KpiCalc {
  monthlyTarget: number;
  weeklyTarget: number;
  actual: number;        // 当週実績
  monthlyActual: number; // 月間累計実績
  remainingWeeks: number;
}

export interface KpiJudge {
  evaluation: Evaluation;
  achieveRate: number | null;       // 当週 達成率
  diff: number;                     // 当週 実績-目標
  monthlyProgress: number | null;   // 月間累計 / 月間目標
  remaining: number;                // 月間目標 - 累計
  remainingPace: number | null;     // 残必要数 / 残週数
  reasons: string[];
}

/** 達成率→評価。 */
export function evalOfRate(rate: number | null): Evaluation {
  if (rate == null) return "watch";
  if (rate >= ACHIEVE_GOOD) return "good";
  if (rate >= ACHIEVE_WATCH) return "watch";
  return "bad";
}

/** 週次KPIの予実・累計・残ペースから判定する。 */
export function judgeKpi(c: KpiCalc): KpiJudge {
  const achieveRate = c.weeklyTarget > 0 ? c.actual / c.weeklyTarget : null;
  const diff = c.actual - c.weeklyTarget;
  const monthlyProgress = c.monthlyTarget > 0 ? c.monthlyActual / c.monthlyTarget : null;
  const remaining = Math.max(0, c.monthlyTarget - c.monthlyActual);
  const remainingPace = c.remainingWeeks > 0 ? remaining / c.remainingWeeks : null;

  let evaluation = evalOfRate(achieveRate);
  const reasons: string[] = [];
  if (achieveRate != null && achieveRate < ACHIEVE_WATCH) reasons.push("週次達成率が70%未満");
  // 月間進捗が計画比70%未満 → Bad
  if (monthlyProgress != null && monthlyProgress < ACHIEVE_WATCH) { evaluation = "bad"; reasons.push("月間累計進捗が計画比70%未満"); }
  // 残ペースが週次目標の1.1倍以上 → Bad
  if (remainingPace != null && c.weeklyTarget > 0 && remainingPace >= c.weeklyTarget * 1.1) { evaluation = worse(evaluation, "watch"); reasons.push("残り週の必要ペースが当初計画の1.1倍以上"); }
  return { evaluation, achieveRate, diff, monthlyProgress, remaining, remainingPace, reasons };
}

function worse(a: Evaluation, b: Evaluation): Evaluation {
  return EVALUATION_META[a].order <= EVALUATION_META[b].order ? a : b;
}

function fmt(v: number, unit: "count" | "yen"): string {
  return unit === "yen" ? "¥" + Math.round(v).toLocaleString("ja-JP") : Math.round(v).toLocaleString("ja-JP") + "件";
}
function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/**
 * システム考察コメントをテンプレート生成(将来AI生成へ差し替え可能)。
 * 構造: 判定 / 何が起きているか / どれくらいズレているか / なぜ問題か / 確認すべきこと / 推奨アクション
 */
export function buildSystemComment(kpiType: string, c: KpiCalc, j: KpiJudge): string {
  const unit = KPI_UNIT[kpiType] ?? "count";
  const name = KPI_LABEL[kpiType] ?? kpiType;
  const ev = EVALUATION_META[j.evaluation].label;
  const lines: string[] = [];
  lines.push(`【判定】${name}：${ev}`);
  lines.push(`【何が起きているか】今週の${name}は目標 ${fmt(c.weeklyTarget, unit)} に対し実績 ${fmt(c.actual, unit)}（達成率 ${pct(j.achieveRate)}）。`);
  lines.push(`【どれくらいズレているか】当週差分 ${j.diff >= 0 ? "+" : ""}${fmt(j.diff, unit)}。月間累計は ${fmt(c.monthlyActual, unit)} / 目標 ${fmt(c.monthlyTarget, unit)}（進捗 ${pct(j.monthlyProgress)}）。残り ${c.remainingWeeks} 週で必要数 ${fmt(j.remaining, unit)}（週平均 ${j.remainingPace != null ? fmt(j.remainingPace, unit) : "—"}）。`);
  if (j.evaluation === "good") {
    lines.push(`【なぜ問題か】現状は計画通り。`);
    lines.push(`【確認すべきこと】好調要因を特定し、再現性を高められるか確認。`);
    lines.push(`【推奨アクション】成功パターンを横展開し、上振れの伸びしろを検討。`);
  } else {
    lines.push(`【なぜ問題か】${j.reasons.join("、") || "未達のため目標到達リスクがある"}。このままでは月間目標の到達が難しくなる可能性があります。`);
    lines.push(`【確認すべきこと】${checkHint(kpiType)}`);
    lines.push(`【推奨アクション】残り ${c.remainingWeeks} 週で週平均 ${j.remainingPace != null ? fmt(j.remainingPace, unit) : "—"} を確保する打ち手を決め、担当と期限を設定。`);
  }
  return lines.join("\n");
}

function checkHint(kpiType: string): string {
  switch (kpiType) {
    case "lead": return "施策別のリード獲得数、1ヶ月前の施策準備状況、流入元別の獲得効率を確認。";
    case "appointment": return "リード品質、担当者別アポ化率、初回接触スピード、アポ打診トークの実施有無を確認。";
    case "deal": return "A読みのクロージング予定日設定、B→A引き上げ計画、成約阻害要因(予算/決裁者/競合/時期)を確認。";
    case "revenue":
    case "gross_profit": return "受注予定案件の金額・確度・受注予定月、値引き状況、粗利率を確認。";
    default: return "担当者別の内訳と阻害要因を確認。";
  }
}

// ===== Phase2: マーケ施策 =====
export const CAMPAIGN_PREP_STATUS: { key: string; label: string }[] = [
  { key: "not_started", label: "未着手" },
  { key: "preparing", label: "準備中" },
  { key: "done", label: "実施済" },
  { key: "reviewed", label: "振り返り済" },
];
export const PREP_LABEL: Record<string, string> = Object.fromEntries(CAMPAIGN_PREP_STATUS.map((s) => [s.key, s.label]));

/** 施策単体の判定: CPA超過/アポ化率低下/振り返り未実施/1ヶ月前未着手。 */
export function judgeCampaign(c: { expectedLeads: number; actualLeads: number; appts: number; cost: number; daysToEvent: number | null; prepStatus: string; done: boolean }): { evaluation: Evaluation; reasons: string[] } {
  const reasons: string[] = [];
  let ev: Evaluation = "good";
  const apptRate = c.actualLeads > 0 ? c.appts / c.actualLeads : null;
  const cpaPlan = c.expectedLeads > 0 ? c.cost / c.expectedLeads : null;
  const cpaActual = c.actualLeads > 0 ? c.cost / c.actualLeads : null;
  if (!c.done && c.daysToEvent != null && c.daysToEvent <= 30 && c.prepStatus === "not_started") { ev = "bad"; reasons.push("実施1ヶ月前で準備未着手"); }
  if (c.done && c.prepStatus !== "reviewed") { ev = worse(ev, "watch"); reasons.push("施策実施後の振り返り未実施"); }
  if (cpaPlan != null && cpaActual != null && cpaActual >= cpaPlan * 1.1) { ev = "bad"; reasons.push("CPAが想定比110%以上"); }
  if (c.done && c.actualLeads >= c.expectedLeads && apptRate != null && apptRate < 0.1) { ev = worse(ev, "watch"); reasons.push("リードは取れているがアポ化率が低い"); }
  if (c.done && c.expectedLeads > 0 && c.actualLeads < c.expectedLeads * 0.6) { ev = "bad"; reasons.push("目標リードに対し実績60%未満"); }
  return { evaluation: ev, reasons };
}

// ===== Phase3: デリバリー =====
export const DELIVERY_TYPES: { key: string; label: string }[] = [
  { key: "training", label: "研修品質" },
  { key: "admin", label: "事務手続き" },
  { key: "prep", label: "事前準備" },
];
export const DELIVERY_TYPE_LABEL: Record<string, string> = Object.fromEntries(DELIVERY_TYPES.map((d) => [d.key, d.label]));
export const DELIVERY_STATUS: { key: string; label: string }[] = [
  { key: "open", label: "未対応" },
  { key: "in_progress", label: "対応中" },
  { key: "done", label: "対応済" },
];

/** 研修満足度判定(5段階想定): 2.3以上Good / 2.0以上Watch / 未満Bad。低評価で対策未記入はBad。 */
export function judgeDelivery(d: { satisfaction?: number | null; issueFlag: boolean; countermeasure?: string | null }): { evaluation: Evaluation; reasons: string[] } {
  const reasons: string[] = [];
  let ev: Evaluation = "good";
  const s = d.satisfaction ?? null;
  if (s != null) {
    if (s < 2.0) { ev = "bad"; reasons.push("満足度2.0未満"); }
    else if (s < 2.3) { ev = "watch"; reasons.push("満足度2.0以上2.3未満"); }
  } else { ev = "watch"; reasons.push("満足度未入力"); }
  if (d.issueFlag && !(d.countermeasure ?? "").trim()) { ev = "bad"; reasons.push("低評価/課題ありだが対策未記入"); }
  return { evaluation: ev, reasons };
}

// ===== Phase4: 開発・顧問 =====
export const PROJECT_TYPES: { key: string; label: string }[] = [
  { key: "dev", label: "開発案件" },
  { key: "advisory", label: "顧問案件" },
];
export const PROJECT_TYPE_LABEL: Record<string, string> = Object.fromEntries(PROJECT_TYPES.map((p) => [p.key, p.label]));
export const CONTINUATION_STATUS: { key: string; label: string }[] = [
  { key: "agreed", label: "継続合意" },
  { key: "none", label: "継続なし" },
  { key: "unconfirmed", label: "未確認" },
];
export const CONTINUATION_LABEL: Record<string, string> = Object.fromEntries(CONTINUATION_STATUS.map((c) => [c.key, c.label]));

/** 原価超過/粗利低下/継続未確認/品質・満足リスクで判定。 */
export function judgeProject(p: { projectType: string; contractAmount: number; plannedCost: number; forecastCost: number; plannedGp?: number | null; forecastGp?: number | null; qualityRisk?: string | null; costRisk?: string | null; continuation?: string | null; satisfaction?: string | null }): { evaluation: Evaluation; reasons: string[]; gpRate: number | null } {
  const reasons: string[] = [];
  let ev: Evaluation = "good";
  const costRatio = p.plannedCost > 0 ? p.forecastCost / p.plannedCost : null;
  const gpRate = p.contractAmount > 0 && p.forecastGp != null ? p.forecastGp / p.contractAmount : null;
  if (costRatio != null && costRatio > 1.1) { ev = "bad"; reasons.push("着地原価が予定比110%超"); }
  else if (costRatio != null && costRatio > 1.0) { ev = worse(ev, "watch"); reasons.push("原価が予定を超過"); }
  if (gpRate != null && p.plannedGp != null && p.contractAmount > 0) {
    const plannedRate = p.plannedGp / p.contractAmount;
    if (plannedRate > 0 && gpRate < plannedRate * 0.8) { ev = "bad"; reasons.push("粗利率が計画を大きく下回る"); }
  }
  if ((p.qualityRisk ?? "").trim() && /高|あり|risk|遅延/i.test(p.qualityRisk ?? "")) { ev = worse(ev, "watch"); reasons.push("品質/納期リスクあり"); }
  if ((p.satisfaction ?? "").trim() && /不満|低|bad/i.test(p.satisfaction ?? "")) { ev = "bad"; reasons.push("顧客不満あり"); }
  if (p.projectType === "advisory" && p.continuation === "unconfirmed") { ev = worse(ev, "watch"); reasons.push("翌月継続が未確認"); }
  return { evaluation: ev, reasons, gpRate };
}
