import { describe, expect, it } from "vitest";
import {
  MEMO_MAX_BODY,
  MEMO_MAX_TITLE,
  buildTranscriptBody,
  defaultMemoTitle,
  isBlankBody,
  isMemoKind,
  minutesTemplate,
  normalizeMemoBody,
  normalizeMemoTitle,
} from "@/lib/memo";

describe("memo: kind / normalize", () => {
  it("isMemoKind は memo/minutes のみ許可する", () => {
    expect(isMemoKind("memo")).toBe(true);
    expect(isMemoKind("minutes")).toBe(true);
    expect(isMemoKind("weekly_plan")).toBe(false);
    expect(isMemoKind(null)).toBe(false);
    expect(isMemoKind(undefined)).toBe(false);
  });

  it("タイトルは trim され、空なら「無題」、上限で切られる", () => {
    expect(normalizeMemoTitle("  打合せメモ  ")).toBe("打合せメモ");
    expect(normalizeMemoTitle("")).toBe("無題");
    expect(normalizeMemoTitle(null)).toBe("無題");
    expect(normalizeMemoTitle("   ")).toBe("無題");
    expect(normalizeMemoTitle("あ".repeat(MEMO_MAX_TITLE + 50))).toHaveLength(MEMO_MAX_TITLE);
  });

  it("本文は null を空文字にし、上限で切られる", () => {
    expect(normalizeMemoBody(null)).toBe("");
    expect(normalizeMemoBody("本文")).toBe("本文");
    expect(normalizeMemoBody("x".repeat(MEMO_MAX_BODY + 10))).toHaveLength(MEMO_MAX_BODY);
  });

  it("isBlankBody は空白のみ・null を空とみなす", () => {
    expect(isBlankBody("")).toBe(true);
    expect(isBlankBody("  \n\t ")).toBe(true);
    expect(isBlankBody(null)).toBe(true);
    expect(isBlankBody(undefined)).toBe(true);
    expect(isBlankBody("a")).toBe(false);
  });
});

describe("memo: 初期タイトル・テンプレート", () => {
  it("議事録の初期タイトルは日付入り（JSTのDateをUTC getterで読む）", () => {
    const jst = new Date(Date.UTC(2026, 7, 2, 10, 0, 0)); // 2026/8/2 相当
    expect(defaultMemoTitle("minutes", jst)).toBe("議事録 2026/8/2");
    expect(defaultMemoTitle("memo", jst)).toBe("無題");
  });

  it("議事録テンプレートは日時・アジェンダ・決定事項・TODOを含む", () => {
    const t = minutesTemplate("2026/8/2");
    expect(t).toContain("日時: 2026/8/2");
    expect(t).toContain("■ アジェンダ");
    expect(t).toContain("■ 決定事項");
    expect(t).toContain("■ TODO・ネクストアクション");
  });
});

describe("memo: 文字起こしのページ反映テキスト", () => {
  it("要約と全文の両方があるときは要約が先", () => {
    const body = buildTranscriptBody({ summary: "要約です", transcript: "全文です" });
    expect(body).not.toBeNull();
    const idxSummary = body!.indexOf("要約です");
    const idxTranscript = body!.indexOf("全文です");
    expect(idxSummary).toBeGreaterThanOrEqual(0);
    expect(idxTranscript).toBeGreaterThan(idxSummary);
    expect(body).toContain("■ AI議事録（録音の自動要約）");
    expect(body).toContain("■ 文字起こし全文");
  });

  it("どちらか一方だけでも組み立てる", () => {
    expect(buildTranscriptBody({ summary: "要約のみ" })).toContain("要約のみ");
    expect(buildTranscriptBody({ summary: "要約のみ" })).not.toContain("文字起こし全文");
    expect(buildTranscriptBody({ transcript: "全文のみ" })).toContain("全文のみ");
  });

  it("両方空・空白なら null", () => {
    expect(buildTranscriptBody({})).toBeNull();
    expect(buildTranscriptBody({ summary: "  ", transcript: "\n" })).toBeNull();
  });

  it("上限を超える全文は切り詰める", () => {
    const body = buildTranscriptBody({ transcript: "x".repeat(MEMO_MAX_BODY + 1000) });
    expect(body!.length).toBeLessThanOrEqual(MEMO_MAX_BODY);
  });
});
