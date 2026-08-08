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

/**
 * 「1記事で複数語を狙う」を成立させるのは指示書。
 * 狙う語を全部渡さないと、執筆者はメインKWだけ見て書き、結局1語ぶんの
 * 薄い記事になる。逆に語ごとに記事を分けられるとカニバリを起こす。
 */
describe("buildInstruction — 記事プラン由来（複数語）", () => {
  const planCtx = (over: Partial<ActionContext> = {}) =>
    ctx({
      actionType: "new_article",
      targetQuery: "生成AI研修",
      targetPage: "",
      planTitle: "法人向け生成AI研修｜実務定着まで",
      targetKeywords: [
        { query: "生成AI研修", volume: 1000, targetPosition: 10, intentLayer: 1, isMain: true },
        { query: "生成AI研修 費用", volume: 300, targetPosition: 5, intentLayer: 1, isMain: false },
        { query: "AI研修 企業", volume: 200, targetPosition: 8, intentLayer: 2, isMain: false },
      ],
      ...over,
    });

  it("狙う語を全部・目標順位つきで表に出す", () => {
    const md = buildInstruction(planCtx());
    expect(md).toContain("この記事で狙う語（3語");
    expect(md).toContain("生成AI研修 費用");
    expect(md).toContain("AI研修 企業");
    expect(md).toContain("合計 月1,500検索");
  });

  it("記事を分けないことと、サブKWを見出しに割り当てることを明示する", () => {
    const md = buildInstruction(planCtx());
    expect(md).toContain("記事は1本だけ");
    expect(md).toContain("H2/H3見出しに1語ずつ割り当てる");
    expect(md).toContain("語ごとに記事を分けないでください");
  });

  it("メインKWはタイトル・H1・冒頭に入れる指示になる", () => {
    const md = buildInstruction(planCtx());
    expect(md).toContain("メインKW「生成AI研修」");
    expect(md).toContain("タイトル・H1・冒頭200文字");
  });

  it("リライトでは新しいページを作らせない（自社ページ同士の競合を防ぐ）", () => {
    const md = buildInstruction(planCtx({ actionType: "rewrite", targetPage: "/ai-training" }));
    expect(md).toContain("新しい記事を作らないでください");
  });

  it("新規記事は対象ページを「新規作成（未公開）」と書く（URLを捏造しない）", () => {
    const md = buildInstruction(planCtx());
    expect(md).toContain("新規作成（未公開）");
    expect(md).toContain("**記事タイトル案**: 法人向け生成AI研修｜実務定着まで");
  });

  it("狙う語が1語だけなら表は出さず、従来の指示書のままにする", () => {
    const md = buildInstruction(
      planCtx({ targetKeywords: [{ query: "AI顧問", volume: 100, targetPosition: 5, isMain: true }] }),
    );
    expect(md).not.toContain("この記事で狙う語");
  });
});
