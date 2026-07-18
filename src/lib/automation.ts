/**
 * WO-18 ワークフロー自動化(F-102) — 純粋ロジック。
 *
 * 「WHEN(トリガー) → IF(条件) → THEN(アクション)」ルールの評価と、
 * Slack/通知テンプレートのレンダリングを、DB非依存の純関数として実装する。
 * cron ルート(/api/cron/automation)から呼ばれ、tests/automation.test.ts で回帰固定する。
 *
 * 発火は「バッチ方式」(ユーザー決定 2026-07-18)。検知源は既存 yomi_change_logs(0126) 等。
 */

import { YOMI_OPTIONS } from "@/lib/constants";

// ---- ヨミの確度序列(「転落(down)」判定用) -------------------------------
// YOMI_OPTIONS の番号は確度順に単調ではない(5〜9はラダー外)。ため、
// 「どれだけ受注に近いか」を明示スコア化して下方遷移を判定する。
// 数値が大きいほど受注に近い。
export const YOMI_CONFIDENCE: Record<string, number> = {
  "0.受注": 100,
  "1.A(80%)": 80,
  "2.B(50%)": 50,
  "3.C(30%)": 30,
  "9.調整中": 22,
  "4.アポ": 20,
  "5.リスケ": 12,
  "6.定期追い": 8,
  "8.キャンセル": 0,
  "7.オチ": 0,
};

/** ヨミ表示ラベル(未知値はそのまま返す)。 */
export function yomiLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return YOMI_OPTIONS.find((y) => y.key === key)?.label ?? key;
}

/**
 * from → to が「転落(確度が下がった)」か。
 * どちらかが未知値(スコア無し)の場合は判定不能として false。
 */
export function isYomiDowngrade(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to) return false;
  const f = YOMI_CONFIDENCE[from];
  const t = YOMI_CONFIDENCE[to];
  if (f === undefined || t === undefined) return false;
  return t < f;
}

// ---- 条件評価 ------------------------------------------------------------
export interface YomiChangeEvent {
  from_yomi: string | null;
  to_yomi: string | null;
}

export interface YomiCondition {
  /** 遷移先がこの集合に含まれる時だけ発火。省略時は先を問わない。 */
  to_in?: string[];
  /** 遷移元がこの集合に含まれる時だけ発火。省略時は元を問わない。 */
  from_in?: string[];
  /** 'down'=転落時のみ / 'up'=前進時のみ / 'any'|未指定=方向を問わない。 */
  direction?: "down" | "up" | "any";
  /** 案件金額の下限(円)。省略時は金額を問わない。 */
  amount_gte?: number;
}

/** ヨミ変更イベントが condition にマッチするか(AND結合)。金額は別途 meetsAmount で判定。 */
export function matchesYomiCondition(ev: YomiChangeEvent, cond: YomiCondition | null | undefined): boolean {
  const c = cond ?? {};
  if (c.to_in && c.to_in.length && !(ev.to_yomi && c.to_in.includes(ev.to_yomi))) return false;
  if (c.from_in && c.from_in.length && !(ev.from_yomi && c.from_in.includes(ev.from_yomi))) return false;
  if (c.direction === "down" && !isYomiDowngrade(ev.from_yomi, ev.to_yomi)) return false;
  if (c.direction === "up" && !(isYomiDowngrade(ev.to_yomi, ev.from_yomi))) return false;
  return true;
}

/** 金額しきい値(amount_gte)を満たすか。未指定なら常に true。 */
export function meetsAmount(amount: number | null | undefined, min: number | null | undefined): boolean {
  if (min === null || min === undefined) return true;
  return (amount ?? 0) >= min;
}

// ---- ステージ変更トリガー ----
export interface StageChangeEvent {
  from_stage: string | null;
  to_stage: string | null;
}
export interface StageCondition {
  to_in?: string[];
  from_in?: string[];
  amount_gte?: number;
}
/** ステージ変更イベントが condition にマッチするか(AND結合・金額は meetsAmount)。 */
export function matchesStageCondition(ev: StageChangeEvent, cond: StageCondition | null | undefined): boolean {
  const c = cond ?? {};
  if (c.to_in && c.to_in.length && !(ev.to_stage && c.to_in.includes(ev.to_stage))) return false;
  if (c.from_in && c.from_in.length && !(ev.from_stage && c.from_in.includes(ev.from_stage))) return false;
  return true;
}

// ---- テンプレート差し込み ------------------------------------------------
export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * "{account} が {to_yomi} に転落" のような単純プレースホルダを差し込む。
 * 未知の変数はそのまま(誤差し込みで情報を捏造しない)。null/undefined は "—"。
 */
export function renderTemplate(tmpl: string, vars: TemplateVars): string {
  return tmpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in vars)) return whole;
    const v = vars[key];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  });
}

// ---- アクション型 --------------------------------------------------------
export type AutomationAction =
  | { type: "slack_notify"; template: string; channel?: string }
  | { type: "app_notify"; to: "owner"; title: string; body?: string; href?: string }
  | { type: "create_task"; title: string; due_in_days?: number; assign?: "owner" };

// ---- レシピ・カタログ(レシピ方式UI用) -----------------------------------
export interface AutomationRecipe {
  key: string;
  name: string;
  description: string;
  trigger_type: string;
  condition_json: Record<string, unknown>;
  action_json: AutomationAction[];
}

/**
 * MVPの初期レシピ。ユーザーは選んで有効化するだけ。
 * ※ WO-18 の cron が実装するトリガーは 'yomi_changed' のみ。
 *   他トリガーは WO-19 で走査を追加する(それまでは有効化しても発火しない)。
 */
export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    key: "yomi_drop_to_c",
    name: "ヨミC転落 → Slack + 担当へ通知",
    description: "ヨミが 1.A / 2.B / 受注 から 3.C(30%) に転落した瞬間に、Slack と担当者のアプリ内通知へ知らせます。",
    trigger_type: "yomi_changed",
    condition_json: { to_in: ["3.C(30%)"], direction: "down" },
    action_json: [
      { type: "slack_notify", template: ":arrow_down: *{account}* が {from_yomi} → *{to_yomi}* に転落（担当 {owner}）" },
      { type: "app_notify", to: "owner", title: "ヨミが3.Cに転落", body: "{account}: {from_yomi} → {to_yomi}" },
    ],
  },
  {
    key: "yomi_drop_to_ochi",
    name: "オチ(失注見込) → Slack + リカバリタスク",
    description: "ヨミが 7.オチ に転落した時に、Slack へ共有し担当者にリカバリ検討タスクを自動起票します。",
    trigger_type: "yomi_changed",
    condition_json: { to_in: ["7.オチ"], direction: "down" },
    action_json: [
      { type: "slack_notify", template: ":warning: *{account}* が {from_yomi} → *{to_yomi}*（担当 {owner}）。失注要因の記入を。" },
      { type: "create_task", title: "オチ転落のリカバリ策/失注要因を検討: {account}", due_in_days: 2, assign: "owner" },
    ],
  },
  {
    key: "yomi_won",
    name: "受注 → Slack で祝う",
    description: "ヨミが 0.受注 に上がった時に、Slack にお祝い通知を流します。",
    trigger_type: "yomi_changed",
    condition_json: { to_in: ["0.受注"] },
    action_json: [
      { type: "slack_notify", template: ":tada: *{account}* を受注！（担当 {owner}） {from_yomi} → *{to_yomi}*" },
    ],
  },
  {
    key: "high_value_lost",
    name: "高額案件（≥500万）の失注 → 本部へ通知",
    description: "500万円以上の案件が 7.オチ になった時に、Slack と担当への通知で本部が気づけます。",
    trigger_type: "yomi_changed",
    condition_json: { to_in: ["7.オチ"], amount_gte: 5000000 },
    action_json: [
      { type: "slack_notify", template: ":rotating_light: 高額失注: *{account}*（{amount}円・担当 {owner}）が {to_yomi} に。要因の確認を。" },
      { type: "app_notify", to: "owner", title: "高額案件が失注", body: "{account}（{amount}円）が {to_yomi}" },
    ],
  },
  {
    key: "stage_reach_proposal",
    name: "提案済に到達 → フォロータスク自動起票",
    description: "ステージが「提案済」になった時に、担当者へ提案後フォローのタスクを自動で起票します。",
    trigger_type: "stage_changed",
    condition_json: { to_in: ["proposal_sent"] },
    action_json: [
      { type: "create_task", title: "提案後フォロー: {account}", due_in_days: 3, assign: "owner" },
    ],
  },
  {
    key: "ac_overdue",
    name: "次回AC 3日超過 → 担当へ催促",
    description: "次回アクション予定日を3日以上過ぎた案件について、担当者へアプリ内通知と催促タスクを出します。",
    trigger_type: "next_action_overdue",
    condition_json: { overdue_days_gte: 3 },
    action_json: [
      { type: "app_notify", to: "owner", title: "次回ACが超過しています", body: "{account}: 次回AC {next_action_date} が超過" },
      { type: "create_task", title: "次回AC超過のリカバリ: {account}", due_in_days: 1, assign: "owner" },
    ],
  },
  {
    key: "stale_proposal",
    name: "提案済のまま7日無活動 → フォロータスク",
    description: "提案済ステージのまま7日間活動が無い案件に、フォロータスクを自動起票します。",
    trigger_type: "no_activity_days",
    condition_json: { days_gte: 7, stage_in: ["proposal_sent", "internal_review"] },
    action_json: [
      { type: "app_notify", to: "owner", title: "提案後フォローが滞っています", body: "{account}: 7日間 活動がありません" },
      { type: "create_task", title: "提案後フォロー(滞留): {account}", due_in_days: 1, assign: "owner" },
    ],
  },
];

export const RECIPE_MAP: Record<string, AutomationRecipe> = Object.fromEntries(
  AUTOMATION_RECIPES.map((r) => [r.key, r]),
);

/** cron が実装済みで実際に発火するトリガー種別(UIの注意書きに使う)。 */
export const IMPLEMENTED_TRIGGERS = new Set([
  "yomi_changed",
  "stage_changed",
  "next_action_overdue",
  "no_activity_days",
]);
