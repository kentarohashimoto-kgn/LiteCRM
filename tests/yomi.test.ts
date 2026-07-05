/**
 * E-5 回帰テスト: ヨミ変換(取込時のステージ/ステータス/予測区分/確度の導出)。
 * 「数字が狂うと信頼を失う」変換ルールを固定する。
 */
import { describe, expect, it } from "vitest";
import { yomiToFields, canonicalExhibition } from "@/lib/deal-import";

describe("yomiToFields (ヨミ→ステージ/確度)", () => {
  it("0.受注 → won / commit / 100%", () => {
    expect(yomiToFields("0.受注")).toEqual({ stage: "won", status: "won", forecast: "commit", probability: 100 });
  });
  it("1.ほぼ確 → internal_review / commit / 80%", () => {
    expect(yomiToFields("1.ほぼ確")).toEqual({ stage: "internal_review", status: "open", forecast: "commit", probability: 80 });
  });
  it("2.提案中 → proposal_sent / best_case / 50%", () => {
    expect(yomiToFields("2.提案中")).toEqual({ stage: "proposal_sent", status: "open", forecast: "best_case", probability: 50 });
  });
  it("3.商談済 → meeting_done / pipeline / 30%", () => {
    expect(yomiToFields("3.商談済")).toEqual({ stage: "meeting_done", status: "open", forecast: "pipeline", probability: 30 });
  });
  it("4.アポ → meeting_scheduled / pipeline / 20%", () => {
    expect(yomiToFields("4.アポ")).toEqual({ stage: "meeting_scheduled", status: "open", forecast: "pipeline", probability: 20 });
  });
  it("5/6 → upside 10%", () => {
    expect(yomiToFields("5.白地")).toMatchObject({ forecast: "upside", probability: 10 });
    expect(yomiToFields("6.白地商談済")).toMatchObject({ forecast: "upside", probability: 10, stage: "meeting_done" });
  });
  it("7/8.失注 → lost / omitted / 0%", () => {
    expect(yomiToFields("7.失注")).toEqual({ stage: "lost", status: "lost", forecast: "omitted", probability: 0 });
    expect(yomiToFields("8.リサイクル")).toMatchObject({ status: "lost", probability: 0 });
  });
  it("9 → meeting_scheduled / pipeline / 15%", () => {
    expect(yomiToFields("9.日程調整中")).toMatchObject({ stage: "meeting_scheduled", probability: 15 });
  });
  it("未設定/不明 → lead_acquired / pipeline / 5%", () => {
    expect(yomiToFields()).toEqual({ stage: "lead_acquired", status: "open", forecast: "pipeline", probability: 5 });
    expect(yomiToFields("  ")).toMatchObject({ stage: "lead_acquired", probability: 5 });
  });
});

describe("canonicalExhibition (展示会名の正規化)", () => {
  it("既知の別名を正規名へ統一する", () => {
    expect(canonicalExhibition("ODEX2506")).toBe("202506_ODEX（ビッグサイト）");
    expect(canonicalExhibition("DXPO")).toBe("202508_DXPO（ビッグサイト）");
  });
  it("未知の値はそのまま、空はnull", () => {
    expect(canonicalExhibition("202607_新イベント")).toBe("202607_新イベント");
    expect(canonicalExhibition("")).toBeNull();
    expect(canonicalExhibition(null)).toBeNull();
  });
});
