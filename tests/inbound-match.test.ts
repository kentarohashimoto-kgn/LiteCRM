/**
 * WO-24 回帰テスト: 受信メールの照合・関連性判定(F-101a)。
 * 「該当メールだけ保存(返信 or 既知取引先)、それ以外は破棄」を固定する。
 */
import { describe, expect, it } from "vitest";
import {
  normalizeMessageId,
  referencedIds,
  extractEmail,
  classifyInbound,
  providerSearchLink,
} from "@/lib/inbound-match";

describe("normalizeMessageId", () => {
  it("山括弧・空白を除去", () => {
    expect(normalizeMessageId("  <abc@mail>  ")).toBe("abc@mail");
    expect(normalizeMessageId("plain@id")).toBe("plain@id");
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
  });
});

describe("referencedIds", () => {
  it("In-Reply-To と References を統合・正規化・重複除去", () => {
    expect(referencedIds("<a@m>", "<a@m> <b@m>")).toEqual(["a@m", "b@m"]);
  });
  it("配列 References にも対応", () => {
    expect(referencedIds(null, ["<x@m>", "<y@m>"])).toEqual(["x@m", "y@m"]);
  });
  it("空は空配列", () => {
    expect(referencedIds(null, null)).toEqual([]);
  });
});

describe("extractEmail", () => {
  it("表示名付きから小文字アドレス", () => {
    expect(extractEmail("山田 太郎 <Taro@Example.com>")).toBe("taro@example.com");
  });
  it("生アドレス", () => {
    expect(extractEmail("a@b.co")).toBe("a@b.co");
  });
  it("不正はnull", () => {
    expect(extractEmail("noaddress")).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe("classifyInbound", () => {
  const ourSend = new Map([["sent-123@app", "msg-uuid-1"]]);
  const known = new Set(["taro@example.com"]);

  it("自分の送信への返信 → reply(送信IDを返す)", () => {
    const r = classifyInbound({ refIds: ["sent-123@app"], senderEmail: "taro@example.com", ourSendIdByMessageId: ourSend, knownContactEmails: known });
    expect(r).toEqual({ kind: "reply", matchedSendId: "msg-uuid-1" });
  });
  it("参照は無いが既知取引先 → inbound", () => {
    const r = classifyInbound({ refIds: [], senderEmail: "taro@example.com", ourSendIdByMessageId: ourSend, knownContactEmails: known });
    expect(r).toEqual({ kind: "inbound" });
  });
  it("参照も既知取引先でもない → discard(保存しない)", () => {
    const r = classifyInbound({ refIds: ["someone@else"], senderEmail: "spam@nope.com", ourSendIdByMessageId: ourSend, knownContactEmails: known });
    expect(r).toEqual({ kind: "discard" });
  });
  it("返信判定は取引先未登録でも成立(Message-Id照合が優先)", () => {
    const r = classifyInbound({ refIds: ["sent-123@app"], senderEmail: "unknown@x.com", ourSendIdByMessageId: ourSend, knownContactEmails: new Set() });
    expect(r).toEqual({ kind: "reply", matchedSendId: "msg-uuid-1" });
  });
});

describe("providerSearchLink", () => {
  it("Gmail検索リンク", () => {
    expect(providerSearchLink("gws", "<abc@m>")).toBe("https://mail.google.com/mail/#search/rfc822msgid:abc%40m");
  });
  it("未知プロバイダ/空はnull", () => {
    expect(providerSearchLink("other", "<x@m>")).toBeNull();
    expect(providerSearchLink("gws", null)).toBeNull();
  });
});
