import { describe, it, expect } from "vitest";
import { parseBasicAuth, safeEqual, sha256Hex, verifyBasicCredentials } from "@/lib/ai-lab/basic-auth";
import { generatePassword, hashPassword, verifyPassword } from "@/lib/ai-lab/password";

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

describe("Basic認証ヘッダの解析", () => {
  it("正常なヘッダからID/パスワードを取り出す", () => {
    expect(parseBasicAuth(basicHeader("acme", "pass-a"))).toEqual({ user: "acme", pass: "pass-a" });
  });

  it("パスワードにコロンが含まれても最初のコロンで分割する", () => {
    expect(parseBasicAuth(basicHeader("acme", "a:b:c"))).toEqual({ user: "acme", pass: "a:b:c" });
  });

  it("日本語を含む資格情報をUTF-8として復元する", () => {
    expect(parseBasicAuth(basicHeader("研修", "ぱすわーど"))).toEqual({ user: "研修", pass: "ぱすわーど" });
  });

  it("ヘッダ無し・Basic以外・base64不正・コロン無しは null", () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth("Bearer abc")).toBeNull();
    expect(parseBasicAuth("Basic ****")).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from("no-colon").toString("base64")}`)).toBeNull();
  });
});

describe("Basic認証の照合", () => {
  it("IDとパスワードが両方一致したときだけ通す", async () => {
    const hash = await sha256Hex("pass-a");
    expect(await verifyBasicCredentials(basicHeader("acme", "pass-a"), "acme", hash)).toBe(true);
    expect(await verifyBasicCredentials(basicHeader("acme", "wrong"), "acme", hash)).toBe(false);
    expect(await verifyBasicCredentials(basicHeader("other", "pass-a"), "acme", hash)).toBe(false);
    expect(await verifyBasicCredentials(basicHeader("other", "wrong"), "acme", hash)).toBe(false);
  });

  it("期待値が空(未設定)なら通さない", async () => {
    expect(await verifyBasicCredentials(basicHeader("acme", "pass-a"), "", "")).toBe(false);
  });

  it("ハッシュの大文字小文字は問わない", async () => {
    const hash = (await sha256Hex("pass-a")).toUpperCase();
    expect(await verifyBasicCredentials(basicHeader("acme", "pass-a"), "acme", hash)).toBe(true);
  });

  it("safeEqual は長さ違い・内容違いを false にする", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("受講者パスワードのハッシュ", () => {
  it("同じパスワードでも毎回異なるハッシュになり、検証は通る", async () => {
    const a = await hashPassword("secret-1");
    const b = await hashPassword("secret-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("secret-1", a)).toBe(true);
    expect(await verifyPassword("secret-1", b)).toBe(true);
  });

  it("誤ったパスワードは通さない", async () => {
    const stored = await hashPassword("secret-1");
    expect(await verifyPassword("secret-2", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("保存形式が壊れていても例外を投げず false", async () => {
    for (const bad of ["", "plain-text", "scrypt$1$2$3", "bcrypt$1$2$3$4$5", "scrypt$x$y$z$$"]) {
      expect(await verifyPassword("secret-1", bad)).toBe(false);
    }
  });
});

describe("初期パスワードの自動生成", () => {
  it("既定は14文字で、毎回異なる", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toHaveLength(14);
    expect(a).not.toBe(b);
  });

  it("読み違えやすい文字(0 O 1 l I)を含まない", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword(20)).not.toMatch(/[0O1lI]/);
    }
  });
});
