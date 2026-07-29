import { describe, it, expect } from "vitest";
import { isApiDisabled, extractProjectId } from "@/lib/seo/google-errors";

/**
 * GCPは「APIが無効」も「権限がない」も同じ403で返す。
 * 取り違えると「権限を付けたのに直らない」で詰まるため、判別は確実に動く必要がある。
 */

// 実際に本番の接続診断で返ってきた本文（2026-07-29）
const REAL_DISABLED_BODY = JSON.stringify({
  error: {
    code: 403,
    message:
      "Google Search Console API has not been used in project 274438881688 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=274438881688 then retry.",
  },
});

const REAL_FORBIDDEN_BODY = JSON.stringify({
  error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:catorce.jp'." },
});

describe("isApiDisabled", () => {
  it("API未有効化のエラーを検出する（実際のレスポンス）", () => {
    expect(isApiDisabled(REAL_DISABLED_BODY)).toBe(true);
  });
  it("SERVICE_DISABLED / accessNotConfigured も検出する", () => {
    expect(isApiDisabled('{"reason":"SERVICE_DISABLED"}')).toBe(true);
    expect(isApiDisabled('{"reason":"accessNotConfigured"}')).toBe(true);
  });
  it("単なる権限不足はAPI未有効化と誤判定しない", () => {
    expect(isApiDisabled(REAL_FORBIDDEN_BODY)).toBe(false);
  });
  it("空文字でも落ちない", () => {
    expect(isApiDisabled("")).toBe(false);
  });
});

describe("extractProjectId", () => {
  it("有効化リンクを組み立てるためにプロジェクト識別子を取り出す", () => {
    expect(extractProjectId(REAL_DISABLED_BODY)).toBe("274438881688");
  });
  it("プロジェクトIDが文字列の場合も取り出せる", () => {
    expect(extractProjectId("has not been used in project catorce-chat before")).toBe("catorce-chat");
  });
  it("見つからなければ null（リンクはプロジェクト指定なしにフォールバック）", () => {
    expect(extractProjectId("something went wrong")).toBeNull();
  });
});
