/**
 * 顧客分析マトリクスの凡例テキスト(rankCriteria)。
 * 閾値をテナントごとに変更できるため、金額の単位変換(億/万)が崩れないよう固定する。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_SETTINGS, MATRIX_RANKS, rankCriteria, UNSEGMENTED_KEY } from "@/lib/account-matrix";

describe("rankCriteria", () => {
  it("既定の閾値を「1億円」「1000万円」で表示する", () => {
    const c = rankCriteria(DEFAULT_RANK_SETTINGS);
    expect(c.S).toContain("1億円");
    expect(c.S).toContain("1,000名");
    expect(c.A).toContain("1,000万円");
    expect(c.A).toContain("100名");
    expect(c.B).toContain("1,000万円");
  });

  it("閾値を変えると表示も追従する", () => {
    const c = rankCriteria({ ...DEFAULT_RANK_SETTINGS, s_revenue: 500000000, a_revenue: 30000000, s_employees: 5000 });
    expect(c.S).toContain("5億円");
    expect(c.S).toContain("5,000名");
    expect(c.A).toContain("3,000万円");
  });

  it("1万円未満はそのまま円で出す(0除算や小数の混入を防ぐ)", () => {
    const c = rankCriteria({ ...DEFAULT_RANK_SETTINGS, b_potential: 5000 });
    expect(c.B).toContain("5,000円");
  });

  it("端数のある億は小数1桁に丸める", () => {
    const c = rankCriteria({ ...DEFAULT_RANK_SETTINGS, s_revenue: 150000000 });
    expect(c.S).toContain("1.5億円");
  });

  it("C・Dは金額に依存しない固定文言", () => {
    const c = rankCriteria(DEFAULT_RANK_SETTINGS);
    expect(c.C).toBe("案件はあるが受注・上記見込みなし");
    expect(c.D).toBe("案件なし");
  });

  it("全ランクぶんの説明が揃っている", () => {
    const c = rankCriteria(DEFAULT_RANK_SETTINGS);
    for (const r of MATRIX_RANKS) expect(c[r.key]).toBeTruthy();
  });
});

describe("定数", () => {
  it("ランク列は S>A>B>C>D の順", () => {
    expect(MATRIX_RANKS.map((r) => r.key)).toEqual(["S", "A", "B", "C", "D"]);
  });

  it("未分類キーは RPC 側(account_segment_matrix)と同じ値", () => {
    expect(UNSEGMENTED_KEY).toBe("__none__");
  });
});
