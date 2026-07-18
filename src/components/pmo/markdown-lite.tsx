import React from "react";

/**
 * AIレポート(Markdown)の軽量レンダラ。外部ライブラリを増やさず、
 * 見出し/箇条書き/番号リスト/表/太字/罫線のみ対応する(サーバー描画可)。
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // **bold** と `code` のみ対応
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== "");
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={`${keyBase}-${i}`} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={`${keyBase}-${i}`} className="text-[0.9em] bg-black/[0.05] rounded px-1">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyBase}-${i}`}>{p}</React.Fragment>;
  });
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i} className="leading-relaxed">
        {renderInline(item, `li-${blocks.length}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`ol-${blocks.length}`} className="list-decimal pl-5 space-y-1 my-2 text-sm text-ink/80">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1 my-2 text-sm text-ink/80">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  const flushTable = () => {
    if (!table || table.length === 0) {
      table = null;
      return;
    }
    const [head, ...rows] = table;
    blocks.push(
      <div key={`tbl-${blocks.length}`} className="overflow-x-auto my-3">
        <table className="text-sm border-collapse min-w-[50%]">
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i} className="text-left font-semibold text-ink/70 border-b border-black/10 px-3 py-1.5 whitespace-nowrap">
                  {renderInline(c, `th-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-b border-black/[0.04]">
                {r.map((c, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-ink/80 align-top">
                    {renderInline(c, `td-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (isTableRow(line)) {
      flushList();
      const cells = splitRow(line);
      // 区切り行(|---|---|)はスキップ
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      table = table ?? [];
      table.push(cells);
      continue;
    }
    flushTable();

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const cls =
        level <= 2
          ? "text-base font-bold text-ink mt-5 mb-2 pb-1 border-b border-black/[0.06]"
          : "text-sm font-bold text-ink mt-4 mb-1.5";
      blocks.push(
        <div key={`h-${blocks.length}`} className={cls}>
          {renderInline(h[2], `h-${blocks.length}`)}
        </div>,
      );
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (list && list.ordered) flushList();
      list = list ?? { ordered: false, items: [] };
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (list && !list.ordered) flushList();
      list = list ?? { ordered: true, items: [] };
      list.items.push(ol[1]);
      continue;
    }
    flushList();

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-4 border-black/[0.08]" />);
      continue;
    }
    if (line.trim() === "") continue;

    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm text-ink/80 leading-relaxed my-1.5">
        {renderInline(line, `p-${blocks.length}`)}
      </p>,
    );
  }
  flushList();
  flushTable();

  return <div>{blocks}</div>;
}
