"use client";

import { useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * 記事本文のコピペ支援。ワンクリックで全文コピー、テキスト領域はフォーカスで全選択。
 * Claudeデザインへ連携できない場合の手動運用(コピペ)を最短にする。
 */
export function CopyArea({ text, rows = 24 }: { text: string; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // クリップボードAPI不可の環境では全選択で代替
      ref.current?.focus();
      ref.current?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button type="button" onClick={copy} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
          {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          {copied ? "コピーしました" : "全文をコピー"}
        </button>
      </div>
      <textarea
        ref={ref}
        readOnly
        rows={rows}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm font-mono leading-relaxed focus:border-teal-primary focus:outline-none"
      />
    </div>
  );
}
