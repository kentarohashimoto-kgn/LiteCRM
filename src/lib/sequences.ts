/**
 * WO-21 メールシーケンス(F-101b) — 純粋ロジック。
 * ステップのスケジュール計算と、案件状態からの自動停止判定。
 * DB非依存=tests/sequences.test.ts で回帰固定。
 */

export interface SequenceStep {
  wait_days: number; // 前ステップ(または投入)からの待機日数。先頭0=当日
  template_id: string;
}

export interface StopOn {
  on_won?: boolean;
  on_lost?: boolean;
  on_appointment?: boolean;
}

/** yyyy-mm-dd に days を足す(UTCベース・日付のみ)。 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** JSTの「今日」(yyyy-mm-dd)。now はテスト用に注入可。 */
export function jstToday(now: number): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 投入日(または直前送信日)を基準に、指定ステップの送信予定日を返す。
 * 先頭ステップ(index=0)は wait_days 分だけ後(通常0=当日)。
 */
export function stepDueDate(baseDate: string, step: SequenceStep | undefined): string | null {
  if (!step) return null;
  return addDays(baseDate, Math.max(0, step.wait_days | 0));
}

/**
 * 案件のヨミ状態から、シーケンスを自動停止すべきか判定。停止理由 or null。
 * 受信同期が無いため on_reply はここでは扱わない(将来 F-101a 常時同期で対応)。
 */
export function evalStop(stopOn: StopOn | null | undefined, yomi: string | null | undefined): string | null {
  const s = stopOn ?? {};
  if (!yomi) return null;
  if (s.on_won && yomi === "0.受注") return "受注により停止";
  if (s.on_lost && (yomi === "7.オチ" || yomi === "8.キャンセル")) return "失注/キャンセルにより停止";
  if (s.on_appointment && yomi === "4.アポ") return "アポ化により停止";
  return null;
}

/** ステップ配列の妥当性(1件以上・各stepにtemplate_id・wait_days数値)。 */
export function validateSteps(steps: unknown): steps is SequenceStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return steps.every(
    (s) => s && typeof s === "object" && typeof (s as SequenceStep).template_id === "string"
      && Number.isFinite((s as SequenceStep).wait_days),
  );
}
