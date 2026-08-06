/**
 * 顧客分析マトリクスの凡例テキスト(rankCriteria)と、絞り込み条件の組み立て(buildMatrixFilter)。
 * 閾値をテナントごとに変更できるため、金額の単位変換(億/万)が崩れないよう固定する。
 * 期間の絞り込みは「今日」に依存するので、基準日を渡して固定する。
 */
import { describe, expect, it } from "vitest";
import {
  DEAL_STAGES, DEAL_STAGE_MAP, DEFAULT_RANK_SETTINGS, EMPTY_MATRIX_FILTER, MATRIX_RANKS,
  buildMatrixFilter, dealStageOf, dealStageSummary, hasMatrixFilter, rankCriteria, UNSEGMENTED_KEY,
  type MatrixAccount,
} from "@/lib/account-matrix";

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

describe("buildMatrixFilter", () => {
  // 2026年8月6日 = 2026年度(2026-07-01〜2027-06-30)の第2月
  const today = new Date(2026, 7, 6);

  it("何も選んでいなければ空の条件（= 絞り込みなし）", () => {
    expect(buildMatrixFilter(EMPTY_MATRIX_FILTER, today)).toEqual({});
    expect(hasMatrixFilter(EMPTY_MATRIX_FILTER)).toBe(false);
  });

  it("会社名は前後の空白を落として渡す。空白だけなら条件にしない", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, q: "  カトルセ " }, today).q).toBe("カトルセ");
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, q: "   " }, today)).toEqual({});
    expect(hasMatrixFilter({ ...EMPTY_MATRIX_FILTER, q: "   " })).toBe(false);
  });

  it("営業担当・エリア・区分は選んだものだけ配列で渡す", () => {
    const f = buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, owner: ["u1", "__none"], status: ["customer"] }, today);
    expect(f.owner).toEqual(["u1", "__none"]);
    expect(f.status).toEqual(["customer"]);
    expect(f.area).toBeUndefined();
  });

  it("会社規模は従業員数の上下限になる。「記載なし」は専用フラグ", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "1000" }, today)).toEqual({ empMin: 1000 });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "100" }, today)).toEqual({ empMin: 100, empMax: 299 });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "1" }, today)).toEqual({ empMax: 29 });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "unknown" }, today)).toEqual({ empUnknown: true });
  });

  it("取引額は累計受注の下限。「取引実績なし」は wonNone", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, deal: "100m" }, today)).toEqual({ wonMin: 100000000 });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, deal: "any" }, today)).toEqual({ wonMin: 1 });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, deal: "none" }, today)).toEqual({ wonNone: true });
  });

  it("直近Nヶ月は基準日から遡った日付になる", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "3m" }, today)).toEqual({ wonFrom: "2026-05-06" });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "12m" }, today)).toEqual({ wonFrom: "2025-08-06" });
  });

  it("今期・前期は7月開始6月決算の年度になる（暦年ではない）", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "fy" }, today)).toEqual({
      wonFrom: "2026-07-01", wonTo: "2027-06-30",
    });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "fy-1" }, today)).toEqual({
      wonFrom: "2025-07-01", wonTo: "2026-06-30",
    });
  });

  it("年度は期首(7月)をまたぐと切り替わる", () => {
    // 6月30日はまだ前年度
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "fy" }, new Date(2026, 5, 30)).wonFrom).toBe("2025-07-01");
    // 7月1日から新年度
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "fy" }, new Date(2026, 6, 1)).wonFrom).toBe("2026-07-01");
  });

  it("「N年以上受注なし」は最終受注日の上限として渡す", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "stale12" }, today)).toEqual({ lastWonBefore: "2025-08-06" });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, period: "stale24" }, today)).toEqual({ lastWonBefore: "2024-08-06" });
  });

  it("案件状況は open / none のみ受け付ける", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, openState: "open" }, today)).toEqual({ openState: "open" });
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, openState: "bogus" }, today)).toEqual({});
  });

  it("知らないプリセットキーは黙って無視する(条件が増えない)", () => {
    expect(buildMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "xxx", deal: "yyy", period: "zzz" }, today)).toEqual({});
  });

  it("複数条件は AND で1つのオブジェクトにまとまる", () => {
    const f = buildMatrixFilter(
      { ...EMPTY_MATRIX_FILTER, q: "NTT", owner: ["u1"], size: "1000", deal: "10m", period: "fy", openState: "open" },
      today
    );
    expect(f).toEqual({
      q: "NTT", owner: ["u1"], empMin: 1000, wonMin: 10000000,
      wonFrom: "2026-07-01", wonTo: "2027-06-30", openState: "open",
    });
    expect(hasMatrixFilter({ ...EMPTY_MATRIX_FILTER, size: "1000" })).toBe(true);
  });
});

/**
 * 取引ステージ。判定の正は RPC(account_matrix_base)側なので、ここで検証するのは
 * 「RPC の dealStage をそのまま尊重すること」と「欠けたときのフォールバック」。
 */
describe("dealStageOf", () => {
  it("RPC が返した dealStage をそのまま使う", () => {
    expect(dealStageOf({ dealStage: "won", wonCount: 0, metCount: 0 })).toBe("won");
    expect(dealStageOf({ dealStage: "engaged", wonCount: 5, metCount: 5 })).toBe("engaged");
    expect(dealStageOf({ dealStage: "lead", wonCount: 3, metCount: 3 })).toBe("lead");
  });

  it("dealStage が無いときは件数から組み立てる(成約 > 商談 > リード)", () => {
    expect(dealStageOf({ wonCount: 1, metCount: 4 })).toBe("won");
    expect(dealStageOf({ wonCount: 0, metCount: 2 })).toBe("engaged");
    expect(dealStageOf({ wonCount: 0, metCount: 0 })).toBe("lead");
    expect(dealStageOf({})).toBe("lead");
  });

  it("受注金額が0でも受注件数があれば成約済(amount=0 の受注を取りこぼさない)", () => {
    expect(dealStageOf({ wonCount: 2, metCount: 0 })).toBe("won");
  });

  it("不正な値は無視してフォールバックする", () => {
    expect(dealStageOf({ dealStage: "unknown" as never, wonCount: 0, metCount: 1 })).toBe("engaged");
  });
});

describe("dealStageSummary", () => {
  const base: MatrixAccount = {
    id: "a", name: "テスト株式会社", industry: null, area: null, status: "prospect",
    ownerName: null, won: 0, openAmount: 0, oppCount: 0, openCount: 0,
    employees: null, lastWonDate: null,
    dealStage: "lead", wonCount: 0, metCount: 0, leadCount: 0,
    rankAuto: true, segmentManual: false,
  };

  it("ステージ名と件数の内訳を並べる", () => {
    const s = dealStageSummary({ ...base, dealStage: "won", wonCount: 2, metCount: 5, oppCount: 6, leadCount: 1 });
    expect(s).toBe("成約済 ／ 受注2件・商談5件・案件6件・リード1件");
  });

  it("件数が全て0ならステージ名だけ", () => {
    expect(dealStageSummary(base)).toBe("リードのみ");
  });

  it("0件の項目は並べない", () => {
    expect(dealStageSummary({ ...base, dealStage: "engaged", metCount: 3, oppCount: 3 }))
      .toBe("商談済 ／ 商談3件・案件3件");
  });
});

describe("取引ステージの定義", () => {
  it("進んでいる順(成約済 → 商談済 → リードのみ)に並ぶ", () => {
    expect(DEAL_STAGES.map((s) => s.key)).toEqual(["won", "engaged", "lead"]);
  });

  it("全ステージに表示用の色とラベルが揃っている", () => {
    for (const s of DEAL_STAGES) {
      expect(DEAL_STAGE_MAP[s.key]).toBe(s);
      expect(s.label).toBeTruthy();
      expect(s.criteria).toBeTruthy();
      expect(s.text).toBeTruthy();
      expect(s.icon).toBeTruthy();
      expect(s.pill).toBeTruthy();
      expect(s.bar).toBeTruthy();
    }
  });
});
