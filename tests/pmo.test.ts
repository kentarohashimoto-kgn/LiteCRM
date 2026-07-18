/**
 * AI-PMO 回帰テスト: ルールベースのヌケモレ検知(detectPmoAlerts)が
 * 期限切れ・停滞・未設定・PJブロッカーを取りこぼさず、正常な状態で誤爆しないことを固定する。
 */
import { describe, expect, it } from "vitest";
import {
  buildPmoDigest,
  detectPmoAlerts,
  isActiveYomi,
  type PmoInput,
  type PmoOppRow,
} from "@/lib/pmo";

const TODAY = "2026-07-18";

function baseInput(over: Partial<PmoInput> = {}): PmoInput {
  return { opps: [], tasks: [], meetings: [], projects: [], months: [], today: TODAY, ...over };
}

function opp(over: Partial<PmoOppRow>): PmoOppRow {
  return {
    id: "o1",
    name: "AI研修導入",
    account_name: "テスト商事",
    status: "open",
    yomi: "2.B(50%)",
    amount: 1_000_000,
    next_action_text: "見積送付",
    next_action_date: "2026-07-25",
    last_activity_at: "2026-07-17T10:00:00+09:00",
    ...over,
  };
}

describe("isActiveYomi", () => {
  it("受注/オチ/キャンセルは対象外", () => {
    expect(isActiveYomi("0.受注")).toBe(false);
    expect(isActiveYomi("7.オチ")).toBe(false);
    expect(isActiveYomi("8.キャンセル")).toBe(false);
  });
  it("A/B/C/アポ/未設定は動いている扱い", () => {
    expect(isActiveYomi("1.A(80%)")).toBe(true);
    expect(isActiveYomi("4.アポ")).toBe(true);
    expect(isActiveYomi(null)).toBe(true);
  });
});

describe("detectPmoAlerts: 案件", () => {
  it("健全な案件では誤爆しない", () => {
    const alerts = detectPmoAlerts(baseInput({ opps: [opp({})] }));
    expect(alerts).toHaveLength(0);
  });

  it("次アクション未設定を重要として検知", () => {
    const alerts = detectPmoAlerts(
      baseInput({ opps: [opp({ next_action_text: null, next_action_date: null })] }),
    );
    expect(alerts.some((a) => a.category === "次アクション未設定" && a.severity === "high")).toBe(true);
  });

  it("次アクション期限切れ: 7日以上で重要に格上げ", () => {
    const mild = detectPmoAlerts(baseInput({ opps: [opp({ next_action_date: "2026-07-15" })] }));
    expect(mild.find((a) => a.category === "次アクション期限切れ")?.severity).toBe("mid");
    const bad = detectPmoAlerts(baseInput({ opps: [opp({ next_action_date: "2026-07-01" })] }));
    expect(bad.find((a) => a.category === "次アクション期限切れ")?.severity).toBe("high");
  });

  it("クローズ予定超過と停滞を検知", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        opps: [opp({ expected_close_date: "2026-06-30", last_activity_at: "2026-06-01T10:00:00+09:00" })],
      }),
    );
    expect(alerts.some((a) => a.category === "クローズ予定超過")).toBe(true);
    expect(alerts.some((a) => a.category === "停滞案件")).toBe(true);
  });

  it("受注済み・オチ案件は検知対象外", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        opps: [
          opp({ status: "won", next_action_text: null, next_action_date: null }),
          opp({ id: "o2", yomi: "7.オチ", next_action_text: null, next_action_date: null }),
        ],
      }),
    );
    expect(alerts).toHaveLength(0);
  });
});

describe("detectPmoAlerts: タスク・商談フォロー・PJ", () => {
  it("期限切れタスクを検知(7日以上または高優先度で重要)", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        tasks: [
          { id: "t1", title: "提案書ドラフト", status: "todo", due_date: "2026-07-16", priority: "middle" },
          { id: "t2", title: "契約書レビュー", status: "todo", due_date: "2026-07-01", priority: "middle" },
          { id: "t3", title: "完了済み", status: "done", due_date: "2026-07-01" },
        ],
      }),
    );
    expect(alerts.find((a) => a.title === "提案書ドラフト")?.severity).toBe("mid");
    expect(alerts.find((a) => a.title === "契約書レビュー")?.severity).toBe("high");
    expect(alerts.some((a) => a.title === "完了済み")).toBe(false);
  });

  it("商談後3日以上フォロー未設定を検知", () => {
    const o = opp({ next_action_text: null, next_action_date: "2026-07-25" });
    const alerts = detectPmoAlerts(
      baseInput({
        opps: [o],
        meetings: [
          {
            id: "m1",
            title: "初回商談",
            meeting_date: "2026-07-10",
            opportunity_id: "o1",
            opportunity_name: "AI研修導入",
            next_action_text: null,
            next_action_date: null,
          },
        ],
      }),
    );
    expect(alerts.some((a) => a.category === "商談後フォロー漏れ" && a.severity === "high")).toBe(true);
  });

  it("PJのブロッカーと工数超過を検知し、closedは対象外", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        projects: [
          {
            plan_id: "p1",
            opportunity_id: "o9",
            name: "基幹システム開発",
            status: "in_progress",
            latest_report: { week_start: "2026-07-13", status: "blocked", blockers: "先方の環境払い出し待ち", progress_pct: 40 },
          },
          {
            plan_id: "p2",
            opportunity_id: "o10",
            name: "AI顧問",
            status: "in_progress",
            latest_report: { week_start: "2026-07-13", status: "over", planned_mm: 1, actual_mm: 1.5, progress_pct: 50 },
          },
          {
            plan_id: "p3",
            opportunity_id: "o11",
            name: "終了PJ",
            status: "closed",
            latest_report: { week_start: "2026-01-01", status: "blocked", blockers: "x" },
          },
        ],
      }),
    );
    expect(alerts.some((a) => a.category === "PJブロッカー" && a.title === "基幹システム開発")).toBe(true);
    expect(alerts.some((a) => a.category === "PJ工数超過" && a.title === "AI顧問")).toBe(true);
    expect(alerts.some((a) => a.title === "終了PJ")).toBe(false);
  });

  it("進行中なのに週次報告が無いPJを検知", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        projects: [{ plan_id: "p1", opportunity_id: "o9", name: "報告なしPJ", status: "in_progress", latest_report: null }],
      }),
    );
    expect(alerts.some((a) => a.category === "PJ報告なし")).toBe(true);
  });

  it("重要度順(high→mid→low)に並ぶ", () => {
    const alerts = detectPmoAlerts(
      baseInput({
        opps: [
          opp({ id: "a", yomi: null }), // low: ヨミ未設定
          opp({ id: "b", next_action_text: null, next_action_date: null }), // high
        ],
      }),
    );
    const sev = alerts.map((a) => a.severity);
    expect(sev).toEqual([...sev].sort((x, y) => ({ high: 0, mid: 1, low: 2 })[x] - ({ high: 0, mid: 1, low: 2 })[y]));
  });
});

describe("buildPmoDigest", () => {
  it("目標・案件・アラートをテキスト化する", () => {
    const input = baseInput({
      opps: [opp({})],
      months: [{ month: "2026-07", target: 10_000_000, actual: 3_000_000, weighted: 4_500_000 }],
    });
    const digest = buildPmoDigest(input, detectPmoAlerts(input));
    expect(digest).toContain("2026-07: 目標1,000万円 / 受注実績300万円 / ヨミ加重450万円");
    expect(digest).toContain("テスト商事｜AI研修導入");
    expect(digest).toContain("次AC:見積送付");
  });
});
