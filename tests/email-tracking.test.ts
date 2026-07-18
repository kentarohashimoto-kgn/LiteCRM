/**
 * WO-22 回帰テスト: 開封/クリック トラッキングの組み立て + 資格情報暗号化。
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  findUrls,
  escapeHtml,
  pixelUrl,
  clickUrl,
  buildTrackedHtml,
  randomToken,
} from "@/lib/email-tracking";
import { encryptSecret, decryptSecret } from "@/lib/crypto-mail";

describe("findUrls", () => {
  it("http(s) を出現順・重複除去で拾う", () => {
    expect(findUrls("資料a https://ex.com/a と https://ex.com/b また https://ex.com/a")).toEqual([
      "https://ex.com/a",
      "https://ex.com/b",
    ]);
  });
  it("末尾の句読点を除外", () => {
    expect(findUrls("詳細はこちら https://ex.com/x。")).toEqual(["https://ex.com/x"]);
  });
  it("URLなしは空", () => {
    expect(findUrls("URLはありません")).toEqual([]);
  });
});

describe("pixelUrl / clickUrl", () => {
  it("末尾スラッシュを正規化して組み立てる", () => {
    expect(pixelUrl("https://app.example.com/", "tok")).toBe("https://app.example.com/api/track/o/tok");
    expect(clickUrl("https://app.example.com", "L1")).toBe("https://app.example.com/api/track/c/L1");
  });
});

describe("buildTrackedHtml", () => {
  const base = "https://app.example.com";
  it("既知リンクはクリック計測URLでラップ、ピクセルを差し込む", () => {
    const html = buildTrackedHtml({
      bodyText: "ご確認ください https://doc.example.com/x\nよろしく",
      baseUrl: base,
      openToken: "OPEN1",
      linkTokens: [{ url: "https://doc.example.com/x", token: "LINK1" }],
    });
    expect(html).toContain('href="https://app.example.com/api/track/c/LINK1"');
    expect(html).toContain(">https://doc.example.com/x</a>"); // 表示は実URLのまま
    expect(html).toContain("/api/track/o/OPEN1"); // 開封ピクセル
    expect(html).toContain("<br>"); // 改行がbr化
  });
  it("トークン未割当URLはそのままリンク化(計測なし)", () => {
    const html = buildTrackedHtml({
      bodyText: "https://notrack.example.com/y",
      baseUrl: base,
      openToken: "O",
      linkTokens: [],
    });
    expect(html).toContain('href="https://notrack.example.com/y"');
  });
  it("HTMLエスケープで注入を防ぐ", () => {
    const html = buildTrackedHtml({ bodyText: "<script>x</script>", baseUrl: base, openToken: "O", linkTokens: [] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("escapeHtml", () => {
  it("特殊文字をエスケープ", () => {
    expect(escapeHtml('a<b>&"\'')).toBe("a&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("randomToken", () => {
  it("16進で指定バイト長×2の文字数", () => {
    expect(randomToken(12)).toMatch(/^[0-9a-f]{24}$/);
  });
  it("毎回異なる", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("crypto-mail (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.MAIL_CRED_SECRET = "test-secret-key-for-vitest-only";
  });
  it("暗号化→復号で元に戻る", () => {
    const enc = encryptSecret("app-password-1234");
    expect(enc).not.toContain("app-password"); // 平文が見えない
    expect(decryptSecret(enc)).toBe("app-password-1234");
  });
  it("暗号文は毎回異なる(IVランダム)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("改ざんは復号で失敗する(GCM認証)", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -4) + (enc.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
