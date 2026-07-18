"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, Target, Sparkles } from "lucide-react";
import { globalSearchAction, type GlobalSearchHit } from "@/server/actions/search";
import { cn } from "@/lib/utils";

const KIND_META: Record<string, { label: string; icon: React.ElementType; href: (id: string) => string }> = {
  account: { label: "顧客", icon: Building2, href: (id) => `/app/accounts/${id}` },
  opportunity: { label: "案件", icon: Target, href: (id) => `/app/opportunities/${id}` },
  lead: { label: "リード", icon: Sparkles, href: (id) => `/app/leads/${id}` },
};

/** ヘッダーのグローバル検索。顧客/案件/リードを横断。 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // モバイルは幅が足りないためプレースホルダーを短縮
  const [placeholder, setPlaceholder] = useState("顧客・案件・リードを検索（/ でフォーカス）");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setPlaceholder(mq.matches ? "検索" : "顧客・案件・リードを検索（/ でフォーカス）");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      setHits(await globalSearchAction(q));
      setLoading(false);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // "/" でフォーカス(入力中は除く)
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  function go(hit: GlobalSearchHit) {
    const meta = KIND_META[hit.kind];
    if (!meta) return;
    setOpen(false);
    setQ("");
    router.push(meta.href(hit.id));
  }

  const grouped = ["account", "opportunity", "lead"]
    .map((k) => ({ kind: k, list: hits.filter((h) => h.kind === k) }))
    .filter((g) => g.list.length > 0);

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
      <input
        ref={inputRef}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-black/10 bg-mist-soft/50 pl-9 pr-3 py-1.5 text-sm outline-none focus:border-teal-primary focus:bg-white transition-colors"
      />
      {open && q.trim() && (
        <div className="absolute z-40 mt-1.5 w-full rounded-xl border border-black/10 bg-white shadow-lg overflow-hidden">
          {loading && <div className="px-3 py-2.5 text-xs text-ink/40">検索中…</div>}
          {!loading && grouped.length === 0 && <div className="px-3 py-2.5 text-xs text-ink/40">該当なし</div>}
          {!loading && grouped.map((g) => {
            const meta = KIND_META[g.kind];
            const Icon = meta.icon;
            return (
              <div key={g.kind}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-ink/35 uppercase">{meta.label}</div>
                {g.list.map((h) => (
                  <button key={h.kind + h.id} type="button" onClick={() => go(h)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-mist-soft">
                    <Icon size={14} className={cn("shrink-0", g.kind === "account" ? "text-teal-deep" : g.kind === "opportunity" ? "text-accent-orange" : "text-ink/40")} />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink truncate">{h.title}</span>
                      {h.sub && <span className="block text-[11px] text-ink/45 truncate">{h.sub}</span>}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
