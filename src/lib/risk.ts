/**
 * 危険案件 / 放置案件の検知(要件 9.8 アラート条件, 15.5 危険案件の条件)。
 */

import type { OppView } from "@/lib/data/select";
import { PROPOSAL_OR_LATER, PROPOSAL_FOLLOWUP_DAYS, STALE_DAYS } from "@/lib/constants";
import { daysSince, sameMonth } from "@/lib/utils";

export type RiskReason =
  | "stale"
  | "no_next_action"
  | "proposal_stale"
  | "close_this_month_early_stage"
  | "commit_unverified";

export const RISK_LABELS: Record<RiskReason, string> = {
  stale: `${STALE_DAYS}日以上 活動なし`,
  no_next_action: "次アクション未設定",
  proposal_stale: `提案後 ${PROPOSAL_FOLLOWUP_DAYS}日以上 放置`,
  close_this_month_early_stage: "今月受注予定だが提案前",
  commit_unverified: "Commitだが要件未確認",
};

export interface RiskResult {
  reasons: RiskReason[];
}

export function evaluateRisk(o: OppView, now: Date = new Date()): RiskResult {
  const reasons: RiskReason[] = [];
  if (o.status !== "open") return { reasons };

  const sinceActivity = daysSince(o.last_activity_at, now);
  if (sinceActivity != null && sinceActivity >= STALE_DAYS) reasons.push("stale");

  if (!o.next_action_date) reasons.push("no_next_action");

  if (PROPOSAL_OR_LATER.includes(o.stage) && sinceActivity != null && sinceActivity >= PROPOSAL_FOLLOWUP_DAYS) {
    reasons.push("proposal_stale");
  }

  const earlyStages = ["lead_acquired", "contacted", "meeting_scheduled", "meeting_done", "needs_confirmed", "proposal_preparing"];
  if (sameMonth(o.expected_close_date, now) && earlyStages.includes(o.stage)) {
    reasons.push("close_this_month_early_stage");
  }

  if (o.forecast_category === "commit" && (!o.next_action_date || (sinceActivity != null && sinceActivity >= STALE_DAYS))) {
    reasons.push("commit_unverified");
  }

  return { reasons };
}

export function isAtRisk(o: OppView, now: Date = new Date()): boolean {
  return evaluateRisk(o, now).reasons.length > 0;
}

export function isStale(o: OppView, now: Date = new Date()): boolean {
  if (o.status !== "open") return false;
  const d = daysSince(o.last_activity_at, now);
  return d != null && d >= STALE_DAYS;
}

export function noNextAction(o: OppView): boolean {
  return o.status === "open" && !o.next_action_date;
}
