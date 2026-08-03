"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Block, type Inline } from "@/lib/ai-lab/markdown";

/**
 * AIの回答をMarkdownとして描画する。
 * パーサが返すASTからReact要素を組み立てるだけで、HTML文字列は一切作らない
 * (= dangerouslySetInnerHTML を使わないので、モデル出力からのXSS経路がない)。
 */

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "strong") return <strong key={i} className="font-bold">{n.value}</strong>;
        if (n.type === "em") return <em key={i} className="italic">{n.value}</em>;
        if (n.type === "code")
          return (
            <code key={i} className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em] font-mono">
              {n.value}
            </code>
          );
        if (n.type === "link")
          return (
            <a
              key={i}
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-deep underline underline-offset-2 hover:text-teal-primary"
            >
              {n.value}
            </a>
          );
        return <span key={i}>{n.value}</span>;
      })}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードが使えない環境では何もしない(手動選択で足りる)。
    }
  };
  return (
    <div className="relative group my-3">
      <div className="flex items-center justify-between rounded-t-xl bg-ink/90 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-white/60">{lang || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-xl bg-ink px-3 py-3 text-[13px] leading-relaxed text-white/90">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm";
      return (
        <p className={`${size} font-bold text-ink mt-4 first:mt-0 mb-2`}>
          <InlineNodes nodes={block.inline} />
        </p>
      );
    }
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap leading-relaxed my-2 first:mt-0">
          <InlineNodes nodes={block.inline} />
        </p>
      );
    case "list": {
      const cls = "my-2 space-y-1 pl-5";
      const items = block.items.map((item, i) => (
        <li key={i} className="leading-relaxed">
          <InlineNodes nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className={`${cls} list-decimal`}>{items}</ol>
      ) : (
        <ul className={`${cls} list-disc`}>{items}</ul>
      );
    }
    case "code":
      return <CodeBlock lang={block.lang} text={block.text} />;
    case "table":
      return (
        // 横に長い表でも本文側は横スクロールさせない。
        <div className="my-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className="border border-black/10 bg-mist-soft px-2 py-1.5 text-left font-semibold">
                    <InlineNodes nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-black/10 px-2 py-1.5 align-top">
                      <InlineNodes nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote className="my-2 border-l-4 border-teal-light pl-3 text-ink/70 whitespace-pre-wrap">
          <InlineNodes nodes={block.inline} />
        </blockquote>
      );
    case "hr":
      return <hr className="my-4 border-black/10" />;
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="text-sm text-ink">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} />
      ))}
    </div>
  );
}
