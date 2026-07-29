import { describe, it, expect } from "vitest";
import { buildInstruction, absoluteUrl, EXECUTION_MODE, type ActionContext } from "@/lib/seo/instructions";

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  actionType: "title_meta",
  siteName: "カトルセHP（法人）",
  baseUrl: "https://catorce.jp/",
  targetQuery: "claude code",
  targetPage: "/blog/claude-code",
  evidence: { detected: "3.1位に表示されているのにクリック0", impressions: 822, clicks: 0, position: 3.1 },
  expected: { clicks: 66, inquiries: 1.25, revenue: 196000 },
  ...over,
});

describe("absoluteUrl", () => {
  it("相対パスを絶対URLにする（受け取った人がそのまま開ける）", () => {
    expect(absoluteUrl("https://catorce.jp/", "/blog/x")).toBe("https://catorce.jp/blog/x");
  });
  it("既に絶対URLならそのまま返す", () => {
    expect(absoluteUrl("https://catorce.jp/", "https://other.jp/a")).toBe("https://other.jp/a");
  });
  it("パスが空ならサイトのトップを返す", () => {
    expect(absoluteUrl("https://catorce.jp/", "")).toBe("https://catorce.jp/");
  });
  it("壊れた入力でも落ちない", () => {
    expect(absoluteUrl("not-a-url", "/a")).toBe("/a");
  });
});

describe("EXECUTION_MODE", () => {
  it("記事系は記事パイプライン、それ以外はHP側への指示書になる", () => {
    expect(EXECUTION_MODE.rewrite).toBe("content");
    expect(EXECUTION_MODE.new_article).toBe("content");
    expect(EXECUTION_MODE.title_meta).toBe("external");
    expect(EXECUTION_MODE.internal_link).toBe("external");
  });
});

describe("buildInstruction", () => {
  it("対象URLを絶対URLで含む（どこを直すか曖昧にしない）", () => {
    const md = buildInstruction(ctx());
    expect(md).toContain("https://catorce.jp/blog/claude-code");
  });

  it("検出結果と根拠数値を日本語ラベルで含む", () => {
    const md = buildInstruction(ctx());
    expect(md).toContain("3.1位に表示されているのにクリック0");
    expect(md).toContain("表示回数(28日): 822");
    expect(md).toContain("平均掲載順位: 3.1");
  });

  it("期待効果を金額で含む（作業の価値が受け取る側に伝わる）", () => {
    expect(buildInstruction(ctx())).toContain("¥196,000");
  });

  it("期待売上が0なら金額行を出さない（0円と書かない）", () => {
    const md = buildInstruction(ctx({ expected: { clicks: 5, inquiries: 0, revenue: 0 } }));
    expect(md).not.toContain("期待売上");
  });

  it("タイトル改善では対象KWをタイトル前半に入れる指示を含む", () => {
    const md = buildInstruction(ctx());
    expect(md).toContain("タイトルの前半");
    expect(md).toContain("claude code");
  });

  it("内部リンクでは本文中に置く指示とアンカーテキストの注意を含む", () => {
    const md = buildInstruction(ctx({ actionType: "internal_link" }));
    expect(md).toContain("本文中");
    expect(md).toContain("アンカーテキスト");
  });

  it("統合ではリダイレクト設定を必ず指示する（流入喪失を防ぐ）", () => {
    const md = buildInstruction(ctx({ actionType: "merge_pages", evidence: { paths: "/a / /b", pages: 2 } }));
    expect(md).toContain("301リダイレクト");
  });

  it("未知の施策タイプでも指示書が壊れない", () => {
    const md = buildInstruction(ctx({ actionType: "unknown_action" }));
    expect(md).toContain("作業内容");
    expect(md).toContain("反映しました");
  });

  it("必ず「反映しました」の記録を促す（記録が無いと効果検証できない）", () => {
    for (const t of ["title_meta", "internal_link", "cta_form", "rewrite", "new_article", "technical"]) {
      expect(buildInstruction(ctx({ actionType: t }))).toContain("反映しました");
    }
  });
});
