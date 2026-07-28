"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { saveMypageLayoutAction, resetMypageLayoutAction } from "@/server/actions/mypage";
import type { GadgetKey, GadgetSetting, GadgetSize, MypageLayout } from "@/lib/mypage";
import { cn } from "@/lib/utils";

interface GadgetOption {
  key: GadgetKey;
  label: string;
  description: string;
  defaultSize: GadgetSize;
}
interface ShortcutOpt {
  href: string;
  label: string;
  group: string;
}

/**
 * マイページのカスタマイズUI(クライアント)。
 * ガジェットの追加/削除/並べ替え/幅、ショートカットの選択を編集して保存する。
 * 保存はサーバーアクションでロール正規化のうえ upsert される。
 */
export function MypageCustomizer({
  layout,
  gadgetOptions,
  shortcutOptions,
}: {
  layout: MypageLayout;
  gadgetOptions: GadgetOption[];
  shortcutOptions: ShortcutOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [gadgets, setGadgets] = useState<GadgetSetting[]>(layout.gadgets);
  const [shortcuts, setShortcuts] = useState<string[]>(layout.shortcuts);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const optionMap = useMemo(() => new Map(gadgetOptions.map((o) => [o.key, o])), [gadgetOptions]);
  const unused = gadgetOptions.filter((o) => !gadgets.some((g) => g.key === o.key));
  const shortcutGroups = useMemo(() => {
    const m = new Map<string, ShortcutOpt[]>();
    for (const o of shortcutOptions) {
      const arr = m.get(o.group) ?? [];
      arr.push(o);
      m.set(o.group, arr);
    }
    return Array.from(m.entries());
  }, [shortcutOptions]);

  const openDialog = () => {
    // 開くたびに保存済みレイアウトから編集を開始(前回の未保存編集を破棄)
    setGadgets(layout.gadgets);
    setShortcuts(layout.shortcuts);
    setError(null);
    setOpen(true);
  };

  const move = (idx: number, delta: number) => {
    const next = [...gadgets];
    const to = idx + delta;
    if (to < 0 || to >= next.length) return;
    [next[idx], next[to]] = [next[to], next[idx]];
    setGadgets(next);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveMypageLayoutAction({ gadgets, shortcuts });
      if (!res.ok) setError(res.error);
      else setOpen(false);
    });
  };

  const reset = () => {
    if (!confirm("マイページを初期配置に戻しますか？")) return;
    setError(null);
    startTransition(async () => {
      const res = await resetMypageLayoutAction();
      if (!res.ok) setError(res.error);
      else setOpen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700 transition-colors"
      >
        <Settings2 size={15} />
        カスタマイズ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div
            className="mt-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-base font-bold text-slate-700">マイページのカスタマイズ</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="閉じる">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-6">
              {/* ガジェット配置 */}
              <section>
                <h3 className="text-sm font-semibold text-slate-600 mb-2">ガジェット（上から順に表示）</h3>
                <ul className="space-y-1.5">
                  {gadgets.map((g, idx) => {
                    const opt = optionMap.get(g.key);
                    if (!opt) return null;
                    return (
                      <li key={g.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-700">{opt.label}</span>
                          <span className="block text-[11px] text-slate-400 truncate">{opt.description}</span>
                        </span>
                        <select
                          value={g.size}
                          onChange={(e) => setGadgets(gadgets.map((x, i) => (i === idx ? { ...x, size: e.target.value as GadgetSize } : x)))}
                          className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
                          aria-label={`${opt.label}の幅`}
                        >
                          <option value="full">全幅</option>
                          <option value="half">半分</option>
                        </select>
                        <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-teal-600 disabled:opacity-30" aria-label="上へ">
                          <ArrowUp size={15} />
                        </button>
                        <button type="button" onClick={() => move(idx, 1)} disabled={idx === gadgets.length - 1} className="text-slate-400 hover:text-teal-600 disabled:opacity-30" aria-label="下へ">
                          <ArrowDown size={15} />
                        </button>
                        <button type="button" onClick={() => setGadgets(gadgets.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500" aria-label="削除">
                          <X size={15} />
                        </button>
                      </li>
                    );
                  })}
                  {gadgets.length === 0 && <li className="text-xs text-slate-400 px-1">ガジェットがありません。下から追加してください。</li>}
                </ul>
                {unused.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {unused.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setGadgets([...gadgets, { key: o.key, size: o.defaultSize }])}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-teal-400 hover:text-teal-700"
                      >
                        <Plus size={12} />
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* ショートカット選択 */}
              <section>
                <h3 className="text-sm font-semibold text-slate-600 mb-1">ショートカットに表示する画面</h3>
                <p className="text-[11px] text-slate-400 mb-2">あなたの権限で利用できる画面のみ表示されます。</p>
                <div className="space-y-3">
                  {shortcutGroups.map(([group, opts]) => (
                    <div key={group}>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">{group}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                        {opts.map((o) => (
                          <label key={o.href} className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={shortcuts.includes(o.href)}
                              onChange={(e) =>
                                setShortcuts(e.target.checked ? [...shortcuts, o.href] : shortcuts.filter((h) => h !== o.href))
                              }
                              className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            />
                            <span className="truncate">{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {error && <p className="text-xs text-rose-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500 disabled:opacity-50"
              >
                <RotateCcw size={13} />
                初期配置に戻す
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className={cn(
                    "rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60",
                  )}
                >
                  {pending ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
