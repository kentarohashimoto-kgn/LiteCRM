"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, PhoneCall, Target, ClipboardList, CheckSquare } from "lucide-react";

/** 全画面共通のクイック追加(＋)。よく使う登録動線へ1クリックで移動。 */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const items = [
    { href: "/app/appointments/new", label: "アポ登録", desc: "架電でアポ獲得", icon: PhoneCall },
    { href: "/app/activities/new", label: "活動を記録", desc: "商談後5分入力", icon: ClipboardList },
    { href: "/app/opportunities/new", label: "案件を作成", desc: "新規案件", icon: Target },
    { href: "/app/tasks", label: "タスクを追加", desc: "ToDo登録", icon: CheckSquare },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-xl bg-teal-primary px-2.5 sm:px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep transition-colors"
        title="クイック追加"
      >
        <Plus size={16} /> <span className="hidden sm:inline">追加</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-black/10 bg-white shadow-lg p-1.5">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-mist-soft">
                <span className="rounded-lg bg-teal-light p-1.5 text-teal-deep"><Icon size={15} /></span>
                <span>
                  <span className="block text-sm font-medium text-ink">{it.label}</span>
                  <span className="block text-[11px] text-ink/45">{it.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
