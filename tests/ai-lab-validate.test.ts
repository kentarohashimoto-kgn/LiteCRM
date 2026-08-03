import { describe, it, expect } from "vitest";
import {
  MAX_ASSET_CHARS,
  conversationTitleFrom,
  validateAssetText,
  validateLoginId,
  validateSlug,
} from "@/lib/ai-lab/validate";

describe("URL識別子(slug)の検証", () => {
  it("英小文字・数字・ハイフンの2〜63文字は通る", () => {
    expect(validateSlug("acme")).toBeNull();
    expect(validateSlug("acme-1")).toBeNull();
    expect(validateSlug("a1")).toBeNull();
    expect(validateSlug("a".repeat(63))).toBeNull();
  });

  it("大文字・日本語・記号・空文字は弾く", () => {
    for (const bad of ["", "Acme", "acme_1", "研修", "acme.corp", "a", "a".repeat(64)]) {
      expect(validateSlug(bad)).not.toBeNull();
    }
  });

  it("先頭ハイフン・末尾ハイフンは弾く", () => {
    expect(validateSlug("-acme")).not.toBeNull();
    expect(validateSlug("acme-")).not.toBeNull();
  });

  it("ルートと衝突する予約語は弾く", () => {
    for (const reserved of ["app", "api", "login", "help", "admin", "preview", "chat"]) {
      expect(validateSlug(reserved)).toContain("予約語");
    }
  });
});

describe("会話タイトルの自動生成", () => {
  it("最初の質問から30文字で作る", () => {
    expect(conversationTitleFrom("契約書のレビュー観点を教えて")).toBe("契約書のレビュー観点を教えて");
  });

  it("長い場合は切り詰めて省略記号を付ける", () => {
    const title = conversationTitleFrom("あ".repeat(100));
    expect(title).toBe(`${"あ".repeat(30)}…`);
  });

  it("改行・連続空白は1つの空白に潰す", () => {
    expect(conversationTitleFrom("前半\n\n後半   です")).toBe("前半 後半 です");
  });

  it("空文字・空白のみなら既定タイトル", () => {
    expect(conversationTitleFrom("")).toBe("新しいチャット");
    expect(conversationTitleFrom("   \n  ")).toBe("新しいチャット");
  });
});

describe("参考資料の検証", () => {
  it("空は弾く", () => {
    expect(validateAssetText("")).not.toBeNull();
    expect(validateAssetText("   ")).not.toBeNull();
  });

  it("上限以内は通り、超過は弾く", () => {
    expect(validateAssetText("a".repeat(MAX_ASSET_CHARS))).toBeNull();
    expect(validateAssetText("a".repeat(MAX_ASSET_CHARS + 1))).not.toBeNull();
  });
});

describe("ログインIDの検証", () => {
  it("英数と . _ - @ の3〜64文字は通る", () => {
    expect(validateLoginId("tanaka")).toBeNull();
    expect(validateLoginId("tanaka.taro@example.com")).toBeNull();
  });

  it("短すぎる・記号混じり・空は弾く", () => {
    for (const bad of ["", "ab", "田中", "tanaka taro", "tanaka#1"]) {
      expect(validateLoginId(bad)).not.toBeNull();
    }
  });
});
