import { describe, it, expect } from "vitest";
import { isSafeHref, parseInline, parseMarkdown } from "@/lib/ai-lab/markdown";

describe("ブロック要素の解析", () => {
  it("見出し・段落・箇条書き・番号付きリストを区別する", () => {
    const blocks = parseMarkdown(
      ["# 見出し", "", "本文です。", "", "- りんご", "- みかん", "", "1. первый", "2. 次"].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
  });

  it("見出しレベルを保持する", () => {
    const blocks = parseMarkdown("### 小見出し");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 3 });
  });

  it("コードブロックは言語つきで取り出し、中のMarkdownは解釈しない", () => {
    const blocks = parseMarkdown(["```ts", "const a = '**not bold**';", "```"].join("\n"));
    expect(blocks[0]).toEqual({ type: "code", lang: "ts", text: "const a = '**not bold**';" });
  });

  it("GFMの表をヘッダ行とデータ行に分解する", () => {
    const blocks = parseMarkdown(["| 項目 | 値 |", "|---|---|", "| A | 1 |", "| B | 2 |"].join("\n"));
    expect(blocks[0].type).toBe("table");
    const table = blocks[0] as Extract<(typeof blocks)[number], { type: "table" }>;
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  it("区切り行のないパイプ行は表にしない(誤検出を避ける)", () => {
    const blocks = parseMarkdown("| これは表ではない |");
    expect(blocks[0].type).toBe("paragraph");
  });

  it("引用・水平線を認識する", () => {
    const blocks = parseMarkdown(["> 引用文", "", "---"].join("\n"));
    expect(blocks.map((b) => b.type)).toEqual(["quote", "hr"]);
  });
});

describe("インライン要素の解析", () => {
  it("強調・インラインコード・リンクを分解する", () => {
    const nodes = parseInline("**太字**と`コード`と[リンク](https://example.com)");
    expect(nodes.map((n) => n.type)).toEqual(["strong", "text", "code", "text", "link"]);
    expect(nodes[4]).toEqual({ type: "link", value: "リンク", href: "https://example.com" });
  });

  it("コード内の記号は強調として解釈しない", () => {
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("javascript: や data: のリンクはリンク化せず素のテキストにする", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x"]) {
      const nodes = parseInline(`[押して](${bad})`);
      expect(nodes.every((n) => n.type === "text")).toBe(true);
    }
  });

  it("http / https / mailto / 相対パスは安全と判定する", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@example.com")).toBe(true);
    expect(isSafeHref("/app/mypage")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
  });
});

describe("ストリーミング途中の壊れた入力", () => {
  it("閉じていないコードフェンスでも例外を投げず、そこまでをコードとして返す", () => {
    const blocks = parseMarkdown(["```js", "const a = 1;"].join("\n"));
    expect(blocks[0]).toMatchObject({ type: "code", lang: "js" });
  });

  it("書きかけの表・記号だけの入力でも例外にしない", () => {
    for (const partial of ["| 項目 |", "**", "[リンク](", "#", "- ", "```", ""]) {
      expect(() => parseMarkdown(partial)).not.toThrow();
    }
  });

  it("空文字・null相当の入力は空配列", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(undefined as unknown as string)).toEqual([]);
  });
});
