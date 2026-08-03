/**
 * AI の回答を表示するための最小 Markdown パーサ。
 *
 * react-markdown を足さずに済ませているのは、
 *   ① 依存を増やさない
 *   ② 出力(AST)をユニットテストで固定できる
 *   ③ HTML文字列を作らず React 要素だけを組むので、XSS の入口を持たない
 * ため。描画側は src/components/ai-lab/markdown.tsx。
 *
 * ストリーミング中は「閉じていないコードフェンス」「途中の表」が普通に来るので、
 * どんな壊れた入力でも例外を投げずに何かを返すことを最優先にしている。
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type Block =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "quote"; inline: Inline[] }
  | { type: "hr" };

// javascript: や data: を踏ませないため、許可するスキームを列挙する。
const SAFE_HREF = /^(https?:\/\/|mailto:|\/)/i;

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

const INLINE_RE =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|(?:\*|_)([^*_\n]+?)(?:\*|_)|\[([^\]\n]*)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  if (!src) return out;
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(src)) !== null) {
    if (m.index > last) out.push({ type: "text", value: src.slice(last, m.index) });
    if (m[2] !== undefined) {
      out.push({ type: "code", value: m[2].trim() });
    } else if (m[3] !== undefined) {
      out.push({ type: "strong", value: m[3] });
    } else if (m[4] !== undefined) {
      out.push({ type: "em", value: m[4] });
    } else if (m[6] !== undefined) {
      const href = m[6];
      const label = m[5] || href;
      // 安全でないスキームはリンクにせず、書かれたまま文字として出す。
      if (isSafeHref(href)) out.push({ type: "link", value: label, href });
      else out.push({ type: "text", value: `[${label}](${href})` });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: "text", value: src.slice(last) });
  return out.filter((n) => n.type !== "text" || n.value !== "");
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}
function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-") && line.includes("|");
}
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // コードフェンス。閉じがないまま入力が終わっても、そこまでをコードとして返す。
    const fence = /^\s*```+\s*(\S*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 閉じフェンス(なければ末尾を越えるだけ)
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2].trim()) });
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 表: ヘッダ行の次が区切り行のときだけ表として扱う(誤検出を避ける)。
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const b = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        const o = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]);
        const hit = isOrdered ? o : b;
        if (!hit) break;
        items.push(parseInline(hit[1]));
        i++;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", inline: parseInline(body.join("\n")) });
      continue;
    }

    // 段落: 次の空行・別ブロックの開始までをひとまとめにする。
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^\s*```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*[-*+]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^\s*>\s?/.test(l)) break;
      if (isTableRow(l) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      para.push(l);
      i++;
    }
    if (para.length) blocks.push({ type: "paragraph", inline: parseInline(para.join("\n")) });
  }

  return blocks;
}
