/**
 * WO-25 回帰テスト: MIME組み立て(F-101)。日本語件名RFC2047・base64本文・構造。
 */
import { describe, expect, it } from "vitest";
import { buildMime, encodeHeaderWord, toBase64Url } from "@/lib/mime";

describe("encodeHeaderWord", () => {
  it("ASCIIはそのまま", () => {
    expect(encodeHeaderWord("Hello")).toBe("Hello");
  });
  it("日本語はRFC2047 base64", () => {
    expect(encodeHeaderWord("件名")).toBe("=?UTF-8?B?5Lu25ZCN?=");
  });
});

describe("buildMime", () => {
  const mime = buildMime({
    from: "橋本 <me@catorce.jp>",
    to: "taro@example.com",
    bcc: "me@catorce.jp",
    subject: "ご提案",
    text: "本文テキスト",
    html: "<b>本文</b>",
    messageId: "<abc123@catorce>",
  });

  it("必須ヘッダを含む", () => {
    expect(mime).toContain("To: taro@example.com");
    expect(mime).toContain("Bcc: me@catorce.jp");
    expect(mime).toContain("Message-ID: <abc123@catorce>");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("multipart/alternative");
  });
  it("From表示名をRFC2047エンコード", () => {
    expect(mime).toContain("<me@catorce.jp>");
    expect(mime).toContain("=?UTF-8?B?"); // 橋本 がエンコードされる
  });
  it("件名をRFC2047エンコード", () => {
    expect(mime).toContain(`Subject: ${encodeHeaderWord("ご提案")}`);
  });
  it("text/plain と text/html の2パート", () => {
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect((mime.match(/Content-Transfer-Encoding: base64/g) ?? []).length).toBe(2);
  });
  it("本文はbase64(生テキストは現れない)", () => {
    expect(mime).not.toContain("本文テキスト");
    expect(mime).toContain(Buffer.from("本文テキスト", "utf8").toString("base64"));
  });
  it("bcc未指定なら Bcc 行なし", () => {
    const m2 = buildMime({ from: "a@b", to: "c@d", subject: "s", text: "t", html: "h", messageId: "<x@y>" });
    expect(m2).not.toContain("Bcc:");
  });
});

describe("toBase64Url", () => {
  it("URLセーフ(+/=を置換)", () => {
    const u = toBase64Url("<<<???>>>"); // base64に + / = が出やすい入力
    expect(u).not.toMatch(/[+/=]/);
  });
});
