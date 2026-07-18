/**
 * WO-18 回帰テスト: ワークフロー自動化(F-102)の条件評価・テンプレート差し込み。
 * 「ヨミC転落 → Slack」が誤爆/取りこぼししないことを固定する。
 */
import { describe, expect, it } from "vitest";
import {
  isYomiDowngrade,
  matchesYomiCondition,
  renderTemplate,
  AUTOMATION_RECIPES,
  RECIPE_MAP,
} from "@/lib/automation";

describe("isYomiDowngrade (ヨミ転落判定)", () => {
  it("1.A → 3.C は転落", () => {
    expect(isYomiDowngrade("1.A(80%)", "3.C(30%)")).toBe(true);
  });
  it("2.B → 3.C は転落", () => {
    expect(isYomiDowngrade("2.B(50%)", "3.C(30%)")).toBe(true);
  });
  it("3.C → 2.B は前進(転落でない)", () => {
    expect(isYomiDowngrade("3.C(30%)", "2.B(50%)")).toBe(false);
  });
  it("同値は転落でない", () => {
    expect(isYomiDowngrade("3.C(30%)", "3.C(30%)")).toBe(false);
  });
  it("未知値は判定不能=false", () => {
    expect(isYomiDowngrade("なにか", "3.C(30%)")).toBe(false);
    expect(isYomiDowngrade(null, "3.C(30%)")).toBe(false);
  });
  it("受注(100) は最上位なので何へでも転落し得る", () => {
    expect(isYomiDowngrade("0.受注", "1.A(80%)")).toBe(true);
  });
});

describe("matchesYomiCondition (C転落レシピ条件)", () => {
  const cond = { to_in: ["3.C(30%)"], direction: "down" as const };

  it("1.A → 3.C はマッチ", () => {
    expect(matchesYomiCondition({ from_yomi: "1.A(80%)", to_yomi: "3.C(30%)" }, cond)).toBe(true);
  });
  it("4.アポ → 3.C は前進なのでマッチしない(direction:down)", () => {
    expect(matchesYomiCondition({ from_yomi: "4.アポ", to_yomi: "3.C(30%)" }, cond)).toBe(false);
  });
  it("1.A → 2.B は to が違うのでマッチしない", () => {
    expect(matchesYomiCondition({ from_yomi: "1.A(80%)", to_yomi: "2.B(50%)" }, cond)).toBe(false);
  });
  it("direction 未指定なら方向を問わない", () => {
    expect(matchesYomiCondition({ from_yomi: "4.アポ", to_yomi: "3.C(30%)" }, { to_in: ["3.C(30%)"] })).toBe(true);
  });
  it("from_in 指定を尊重する", () => {
    const c = { to_in: ["3.C(30%)"], from_in: ["1.A(80%)"] };
    expect(matchesYomiCondition({ from_yomi: "2.B(50%)", to_yomi: "3.C(30%)" }, c)).toBe(false);
    expect(matchesYomiCondition({ from_yomi: "1.A(80%)", to_yomi: "3.C(30%)" }, c)).toBe(true);
  });
});

describe("renderTemplate (テンプレ差し込み)", () => {
  it("既知の変数を差し込む", () => {
    expect(renderTemplate("{account} が {to_yomi} に転落", { account: "A社", to_yomi: "3.C(30%)" })).toBe(
      "A社 が 3.C(30%) に転落",
    );
  });
  it("null/空は — にする", () => {
    expect(renderTemplate("担当 {owner}", { owner: null })).toBe("担当 —");
    expect(renderTemplate("担当 {owner}", { owner: "" })).toBe("担当 —");
  });
  it("未知の変数は捏造せずそのまま残す", () => {
    expect(renderTemplate("{unknown} と {account}", { account: "A社" })).toBe("{unknown} と A社");
  });
});

describe("AUTOMATION_RECIPES (レシピ・カタログ)", () => {
  it("キーが一意で RECIPE_MAP と整合", () => {
    const keys = AUTOMATION_RECIPES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of AUTOMATION_RECIPES) expect(RECIPE_MAP[r.key]).toBe(r);
  });
  it("第一号レシピは yomi_changed / 3.C / down", () => {
    const r = RECIPE_MAP["yomi_drop_to_c"];
    expect(r.trigger_type).toBe("yomi_changed");
    expect(r.condition_json).toMatchObject({ to_in: ["3.C(30%)"], direction: "down" });
    expect(r.action_json.some((a) => a.type === "slack_notify")).toBe(true);
  });
});
