/**
 * 配信停止モード(0180) 回帰テスト。
 * 法的な該当性は「送信通数」ではなく内容が広告宣伝目的かで決まるため、
 * 本文フッターの要否は UnsubMode、注意喚起は本文の広告要素検出で決める。
 */
import { describe, expect, it } from "vitest";
import { detectAdSignals, needsAdWarning, wantsFooter } from "@/lib/unsubscribe";

describe("本文フッターの要否", () => {
  it("full は付ける / header_only は付けない", () => {
    expect(wantsFooter("full")).toBe(true);
    expect(wantsFooter("header_only")).toBe(false);
  });
});

describe("広告宣伝要素の検出", () => {
  it("純粋なお礼だけなら検出しない", () => {
    const body = "山田 様\n\n本日はブースにお立ち寄りいただき、誠にありがとうございました。\n引き続きよろしくお願いいたします。";
    expect(detectAdSignals("ご来場ありがとうございました", body)).toEqual([]);
  });

  it("本文中のURLを検出する", () => {
    const s = detectAdSignals("お礼", "詳しくはこちら https://example.com/doc をご覧ください");
    expect(s.some((x) => x.key === "url")).toBe(true);
  });

  it("資料・セミナー・商談打診を検出する", () => {
    expect(detectAdSignals("", "サービス資料をお送りします").some((x) => x.key === "material")).toBe(true);
    expect(detectAdSignals("無料セミナーのご案内", "").some((x) => x.key === "seminar")).toBe(true);
    expect(detectAdSignals("", "オンラインでの簡単なご説明も承っております").some((x) => x.key === "meeting")).toBe(true);
  });

  it("件名だけに広告要素があっても検出する", () => {
    expect(detectAdSignals("【キャンペーン】期間限定のご案内", "本文").length).toBeGreaterThan(0);
  });

  it("実際の展示会お礼テンプレは該当する(資料リンク+説明の打診)", () => {
    const body = [
      "本日は展示会の弊社ブースにお立ち寄りいただき、誠にありがとうございました。",
      "ご覧いただいたサービスの資料を下記にご用意しております。",
      "▼サービス資料",
      "https://example.my.canva.site/deck",
      "オンラインでの簡単なご説明（30分程度）も承っております。",
    ].join("\n");
    const keys = detectAdSignals("【株式会社カトルセ】ご来場ありがとうございました", body).map((s) => s.key);
    expect(keys).toContain("url");
    expect(keys).toContain("material");
  });
});

describe("注意喚起の判定", () => {
  const adBody = "サービス資料はこちら https://example.com/doc";
  const plainBody = "本日はお時間をいただきありがとうございました。";

  it("header_only で広告要素があれば警告する", () => {
    expect(needsAdWarning("header_only", "お礼", adBody)).toBe(true);
  });
  it("header_only でも純粋なお礼なら警告しない", () => {
    expect(needsAdWarning("header_only", "お礼", plainBody)).toBe(false);
  });
  it("full を選んでいれば警告しない(フッターが付くため)", () => {
    expect(needsAdWarning("full", "お礼", adBody)).toBe(false);
  });
});
