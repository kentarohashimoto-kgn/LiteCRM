/**
 * 差出人依存の差し込み変数(0181) 回帰テスト。
 * 同じテンプレでも送信者ごとに件名・本文末尾が正しく変わることを固定する。
 */
import { describe, expect, it } from "vitest";
import { lastName, resolveSender, placeholderSender } from "@/lib/sender";
import { renderEmailTemplate } from "@/lib/email";

describe("姓の抽出", () => {
  it("全角スペース区切り", () => expect(lastName("橋本　健太郎")).toBe("橋本"));
  it("半角スペース区切り", () => expect(lastName("橋本 健太郎")).toBe("橋本"));
  it("区切りがなければ全体", () => expect(lastName("平石真子")).toBe("平石真子"));
  it("空文字は空文字", () => expect(lastName("")).toBe(""));
});

describe("差出人の解決", () => {
  it("SMTP接続: from_name と from_email をそのまま使う", () => {
    const v = resolveSender({
      fromName: "橋本　健太郎", fromEmail: "kentaro.hashimoto@catorce.jp",
      authMethod: "smtp", signature: "署名本体",
    });
    expect(v).toEqual({
      sender: "橋本　健太郎", sender_last: "橋本",
      sender_email: "kentaro.hashimoto@catorce.jp", signature: "署名本体",
    });
  });

  it("Google OAuth: from_name が空なら表示名で補い、アドレスは oauth_email を使う", () => {
    // OAuth接続では from_email にプレースホルダ(UUID)が入ることがある
    const v = resolveSender({
      fromName: null, displayName: "平石真子",
      fromEmail: "55a330e2-87a2-4629-b50a-1012eb78e25a",
      oauthEmail: "mako.hiraishi@catorce.jp",
      authMethod: "google_oauth",
    });
    expect(v.sender).toBe("平石真子");
    expect(v.sender_email).toBe("mako.hiraishi@catorce.jp");
  });

  it("メール形式でない値は採用しない", () => {
    const v = resolveSender({ fromEmail: "not-an-email", authMethod: "smtp" });
    expect(v.sender_email).toBe("");
  });

  it("署名は前後の空白を落とす。未設定は空文字", () => {
    expect(resolveSender({ signature: "  block  " }).signature).toBe("block");
    expect(resolveSender({}).signature).toBe("");
  });
});

describe("展示会お礼テンプレの差し込み", () => {
  const subjectTmpl = "【展示会お礼】AIエージェント導入支援・バイブコーディング研修のカトルセ{sender_last}です";
  const bodyTmpl = ["{company}", "{contact} 様", "", "株式会社カトルセの{sender}です。", "", "{signature}"].join("\n");

  it("橋本が送る場合", () => {
    const vars = {
      contact: "山田 太郎", company: "株式会社サンプル", opportunity: "",
      ...resolveSender({
        fromName: "橋本　健太郎", fromEmail: "kentaro.hashimoto@catorce.jp", authMethod: "smtp",
        signature: "株式会社カトルセ\n代表取締役　橋本　健太郎",
      }),
    };
    expect(renderEmailTemplate(subjectTmpl, vars)).toBe(
      "【展示会お礼】AIエージェント導入支援・バイブコーディング研修のカトルセ橋本です",
    );
    const body = renderEmailTemplate(bodyTmpl, vars);
    expect(body).toContain("株式会社サンプル\n山田 太郎 様");
    expect(body).toContain("株式会社カトルセの橋本　健太郎です。");
    expect(body).toContain("代表取締役　橋本　健太郎");
  });

  it("平石が送る場合は件名・署名が入れ替わる", () => {
    const vars = {
      contact: "山田 太郎", company: "株式会社サンプル", opportunity: "",
      ...resolveSender({
        displayName: "平石真子", oauthEmail: "mako.hiraishi@catorce.jp", authMethod: "google_oauth",
        signature: "株式会社カトルセ\n平石真子",
      }),
    };
    expect(renderEmailTemplate(subjectTmpl, vars)).toContain("カトルセ平石真子です");
    expect(renderEmailTemplate(bodyTmpl, vars)).toContain("平石真子");
  });

  it("未設定でも {変数} が文字として残らない", () => {
    const vars = { contact: "山田", company: "サンプル", opportunity: "", ...resolveSender({}) };
    const body = renderEmailTemplate(bodyTmpl, vars);
    expect(body).not.toMatch(/\{(sender|signature|sender_last|sender_email)\}/);
  });

  it("プレビュー用プレースホルダは全項目を持つ", () => {
    const p = placeholderSender();
    expect(Object.keys(p).sort()).toEqual(["sender", "sender_email", "sender_last", "signature"]);
  });
});
