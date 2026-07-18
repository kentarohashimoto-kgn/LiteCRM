/**
 * WO-20 回帰テスト: メール連携(F-101a)のテンプレート差込・Gmail作成URL・抜粋。
 */
import { describe, expect, it } from "vitest";
import {
  renderEmailTemplate,
  buildGmailComposeUrl,
  emailSnippet,
  isValidEmail,
} from "@/lib/email";

describe("renderEmailTemplate", () => {
  it("既知の変数を差し込む", () => {
    expect(renderEmailTemplate("{contact} 様（{company}）", { contact: "山田", company: "A社" })).toBe(
      "山田 様（A社）",
    );
  });
  it("null/未指定は空文字(誤差し込みしない)", () => {
    expect(renderEmailTemplate("{contact} 様", { contact: null })).toBe(" 様");
  });
  it("未知の変数は捏造せずそのまま残す", () => {
    expect(renderEmailTemplate("{unknown}/{company}", { company: "A社" })).toBe("{unknown}/A社");
  });
  it("複数行・複数出現を差し込む", () => {
    expect(renderEmailTemplate("{sender}\n{sender}", { sender: "橋本" })).toBe("橋本\n橋本");
  });
});

describe("buildGmailComposeUrl", () => {
  it("to/su/body をエンコードして付与", () => {
    const url = buildGmailComposeUrl({ to: "a@example.com", subject: "件名 テスト", body: "本文\n改行" });
    expect(url.startsWith("https://mail.google.com/mail/?")).toBe(true);
    expect(url).toContain("view=cm");
    expect(url).toContain("fs=1");
    expect(url).toContain("to=a%40example.com");
    expect(url).toContain("su=%E4%BB%B6%E5%90%8D"); // "件名" エンコード
    expect(url).toContain("body=");
  });
  it("空フィールドは付与しない", () => {
    const url = buildGmailComposeUrl({ to: null, subject: "只件名", body: null });
    expect(url).not.toContain("to=");
    expect(url).not.toContain("body=");
    expect(url).toContain("su=");
  });
});

describe("emailSnippet", () => {
  it("改行を詰めて先頭 n 文字", () => {
    expect(emailSnippet("あ\n\nい  う", 10)).toBe("あ い う");
  });
  it("n 超過は … を付ける", () => {
    expect(emailSnippet("0123456789abc", 5)).toBe("01234…");
  });
  it("空は空文字", () => {
    expect(emailSnippet(null)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("正常なアドレス", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
  });
  it("不正/空", () => {
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("noat.example.com")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});
