/**
 * 展示会の表記統一（YYYYMM_展示会名）と最新化（開催日ベースの実施済み判定）の回帰テスト。
 */
import { describe, expect, it } from "vitest";
import { ymFromDate, exhibitionCoreName, exhibitionLabel, isExhibitionDone } from "@/lib/exhibition-label";

describe("ymFromDate", () => {
  it("YYYY-MM-DD から YYYYMM を取り出す", () => {
    expect(ymFromDate("2026-06-10")).toBe("202606");
    expect(ymFromDate("2025-09-17")).toBe("202509");
  });
  it("空/無効は null", () => {
    expect(ymFromDate(undefined)).toBeNull();
    expect(ymFromDate(null)).toBeNull();
    expect(ymFromDate("")).toBeNull();
  });
});

describe("exhibitionCoreName", () => {
  it("先頭の YYYYMM_ プレフィックスを除去", () => {
    expect(exhibitionCoreName("202606_AIEXPO幕張")).toBe("AIEXPO幕張");
  });
  it("先頭の YYYYMMDD_ プレフィックスを除去", () => {
    expect(exhibitionCoreName("20260610_AINATIVEEXPO")).toBe("AINATIVEEXPO");
  });
  it("先頭に日付が無い名前はそのまま（末尾コードは保持）", () => {
    expect(exhibitionCoreName("ODEX2606")).toBe("ODEX2606");
    expect(exhibitionCoreName("生成AIワールド")).toBe("生成AIワールド");
  });
  it("区切りの揺れ（全角アンダーバー・ハイフン・スペース）にも対応", () => {
    expect(exhibitionCoreName("202602＿AIWorld")).toBe("AIWorld");
    expect(exhibitionCoreName("202510-ODEX大阪")).toBe("ODEX大阪");
    expect(exhibitionCoreName("202507 産業DX総合展")).toBe("産業DX総合展");
  });
});

describe("exhibitionLabel", () => {
  it("開催日から YYYYMM を導出し `YYYYMM_核名` に統一", () => {
    expect(exhibitionLabel({ name: "ナノオプトメディア展示会", event_date: "2026-06-10" })).toBe("202606_ナノオプトメディア展示会");
  });
  it("既存の日付プレフィックスは二重付与しない（正本は開催日）", () => {
    expect(exhibitionLabel({ name: "202601_AIEXPO幕張", event_date: "2026-06-10" })).toBe("202606_AIEXPO幕張");
  });
  it("開催日が無ければ核名のみ", () => {
    expect(exhibitionLabel({ name: "202606_AIEXPO幕張", event_date: null })).toBe("AIEXPO幕張");
    expect(exhibitionLabel({ name: "生成AIワールド" })).toBe("生成AIワールド");
  });
});

describe("isExhibitionDone", () => {
  const today = "2026-07-11";
  it("状態が done なら実施済み", () => {
    expect(isExhibitionDone({ event_status: "done", event_date: "2027-01-01" }, today)).toBe(true);
  });
  it("開催日が today より前なら（状態に関わらず）実施済み＝自動最新化", () => {
    expect(isExhibitionDone({ event_status: "applied", event_date: "2026-06-10" }, today)).toBe(true);
    expect(isExhibitionDone({ event_status: "planned", event_date: "2026-06-10" }, today)).toBe(true);
  });
  it("開催日が today 以降なら未実施（今後）", () => {
    expect(isExhibitionDone({ event_status: "applied", event_date: "2026-07-11" }, today)).toBe(false);
    expect(isExhibitionDone({ event_status: "planned", event_date: "2026-08-01" }, today)).toBe(false);
  });
  it("開催日が無く状態も done でなければ今後扱い", () => {
    expect(isExhibitionDone({ event_status: "planned" }, today)).toBe(false);
  });
});
