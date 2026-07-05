/**
 * E-5 回帰テスト: 危険案件/放置案件の検知ルール。
 */
import { describe, expect, it } from "vitest";
import { evaluateRisk, isStale, noNextAction } from "@/lib/risk";
import type { OppView } from "@/lib/data/select";

const now = new Date(2026, 6, 15); // 2026-07-15

function o(partial: Record<string, unknown>): OppView {
  return {
    id: "x",
    status: "open",
    stage: "meeting_done",
    forecast_category: "pipeline",
    last_activity_at: "2026-07-14",
    next_action_date: "2026-07-20",
    expected_close_date: null,
    ...partial,
  } as unknown as OppView;
}

describe("evaluateRisk", () => {
  it("open以外はリスクなし", () => {
    expect(evaluateRisk(o({ status: "won", next_action_date: null }), now).reasons).toEqual([]);
  });
  it("7日以上活動なし → stale", () => {
    expect(evaluateRisk(o({ last_activity_at: "2026-07-01" }), now).reasons).toContain("stale");
    expect(evaluateRisk(o({ last_activity_at: "2026-07-10" }), now).reasons).not.toContain("stale");
  });
  it("次アクション未設定 → no_next_action", () => {
    expect(evaluateRisk(o({ next_action_date: null }), now).reasons).toContain("no_next_action");
  });
  it("提案以降で7日以上放置 → proposal_stale", () => {
    expect(evaluateRisk(o({ stage: "proposal_sent", last_activity_at: "2026-07-01" }), now).reasons).toContain("proposal_stale");
  });
  it("今月受注予定なのに提案前ステージ → close_this_month_early_stage", () => {
    expect(evaluateRisk(o({ expected_close_date: "2026-07-30", stage: "meeting_done" }), now).reasons).toContain("close_this_month_early_stage");
    expect(evaluateRisk(o({ expected_close_date: "2026-08-30", stage: "meeting_done" }), now).reasons).not.toContain("close_this_month_early_stage");
  });
  it("Commitだが次アクションなし/放置 → commit_unverified", () => {
    expect(evaluateRisk(o({ forecast_category: "commit", next_action_date: null }), now).reasons).toContain("commit_unverified");
    expect(evaluateRisk(o({ forecast_category: "commit" }), now).reasons).not.toContain("commit_unverified");
  });
});

describe("isStale / noNextAction", () => {
  it("openかつ7日以上でstale", () => {
    expect(isStale(o({ last_activity_at: "2026-07-01" }), now)).toBe(true);
    expect(isStale(o({ status: "won", last_activity_at: "2026-07-01" }), now)).toBe(false);
  });
  it("openかつ次回AC未設定でtrue", () => {
    expect(noNextAction(o({ next_action_date: null }))).toBe(true);
    expect(noNextAction(o({}))).toBe(false);
  });
});
