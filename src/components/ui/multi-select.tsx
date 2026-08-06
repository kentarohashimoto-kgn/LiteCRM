"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 1つのプルダウンで複数選択できる絞り込み。
 * ボタンを押すとチェックボックス一覧が開き、選んだ項目は OR で絞り込まれる。
 * 外側クリック・Esc で閉じる。表示は「ラベル：すべて」「ラベル：A・B」「ラベル：A 他2件」。
 *
 * 顧客一覧・案件一覧に同じものが個別実装で入っているが、
 * それらは触ると回帰の影響範囲が広いためそのままにし、新規画面はこちらを使う。
 */

export interface MultiSelectOption {
  id: string;
  name: string;
}

export function MultiSelect({
  selected,
  onChange,
  placeholder,
  options,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  /** 「担当営業」などの見出し。選択なしのときは「担当営業：すべて」と出る */
  placeholder: string;
  options: MultiSelectOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  const label =
    selected.length === 0
      ? `${placeholder}：すべて`
      : selected.length <= 2
        ? `${placeholder}：${selected.map(nameOf).join("・")}`
        : `${placeholder}：${nameOf(selected[0])} 他${selected.length - 1}件`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-sm outline-none",
          selected.length > 0 ? "border-teal-primary text-teal-deep" : "border-black/10 text-ink/70",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="max-w-[180px] truncate">{label}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`${placeholder}の選択をクリア`}
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange([]); } }}
            className="text-ink/40 hover:text-rose-500"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={14} className="text-ink/40" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-56 overflow-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg" role="listbox">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink/40">選択肢がありません</div>
          ) : (
            options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-black/[0.04]"
                  role="option"
                  aria-selected={on}
                >
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-teal-primary bg-teal-primary text-white" : "border-black/20")}>
                    {on && <span className="text-[10px] leading-none">✓</span>}
                  </span>
                  <span className="min-w-0 truncate text-ink/80">{o.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
