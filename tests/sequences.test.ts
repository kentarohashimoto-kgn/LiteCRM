/**
 * WO-21 回帰テスト: シーケンスのスケジュール計算・停止判定・ステップ検証。
 */
import { describe, expect, it } from "vitest";
import { addDays, jstToday, stepDueDate, evalStop, validateSteps } from "@/lib/sequences";

describe("addDays", () => {
  it("日付を加算(月跨ぎ)", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });
  it("0日は同日", () => {
    expect(addDays("2026-07-18", 0)).toBe("2026-07-18");
  });
});

describe("jstToday", () => {
  it("UTCの15時はJSTで翌日", () => {
    // 2026-07-18T15:00:00Z → JST 2026-07-19 00:00
    expect(jstToday(Date.parse("2026-07-18T15:00:00Z"))).toBe("2026-07-19");
  });
});

describe("stepDueDate", () => {
  it("先頭ステップ(0日)は当日", () => {
    expect(stepDueDate("2026-07-18", { wait_days: 0, template_id: "t" })).toBe("2026-07-18");
  });
  it("3日後ステップ", () => {
    expect(stepDueDate("2026-07-18", { wait_days: 3, template_id: "t" })).toBe("2026-07-21");
  });
  it("負値は0扱い", () => {
    expect(stepDueDate("2026-07-18", { wait_days: -5, template_id: "t" })).toBe("2026-07-18");
  });
  it("stepなしはnull", () => {
    expect(stepDueDate("2026-07-18", undefined)).toBeNull();
  });
});

describe("evalStop", () => {
  it("受注で停止(on_won)", () => {
    expect(evalStop({ on_won: true }, "0.受注")).toBe("受注により停止");
  });
  it("オチ/キャンセルで停止(on_lost)", () => {
    expect(evalStop({ on_lost: true }, "7.オチ")).toBe("失注/キャンセルにより停止");
    expect(evalStop({ on_lost: true }, "8.キャンセル")).toBe("失注/キャンセルにより停止");
  });
  it("アポ化で停止(on_appointment)", () => {
    expect(evalStop({ on_appointment: true }, "4.アポ")).toBe("アポ化により停止");
    expect(evalStop({ on_appointment: false }, "4.アポ")).toBeNull();
  });
  it("該当なし/ヨミ無しはnull", () => {
    expect(evalStop({ on_won: true, on_lost: true }, "2.B(50%)")).toBeNull();
    expect(evalStop({ on_won: true }, null)).toBeNull();
  });
});

describe("validateSteps", () => {
  it("正常", () => {
    expect(validateSteps([{ wait_days: 0, template_id: "a" }, { wait_days: 3, template_id: "b" }])).toBe(true);
  });
  it("空/型不正はfalse", () => {
    expect(validateSteps([])).toBe(false);
    expect(validateSteps([{ wait_days: 0 }])).toBe(false);
    expect(validateSteps("x")).toBe(false);
    expect(validateSteps([{ wait_days: "x", template_id: "a" }])).toBe(false);
  });
});
