"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 横長テーブルのフェーズ1改善ラッパー。
 *  - 見出し固定・先頭列固定は globals.css の .sticky-grid[data-freeze*] が担当。
 *  - ここでは「画面内に収まるスクロール領域」＋「上部の同期スクロールバー」を提供する。
 * 使い方: <StickyGrid freeze><table>…</table></StickyGrid>
 *  - freeze : 先頭1列を固定（顧客名など）
 *  - freeze2: 先頭2列を固定（チェックボックス＋顧客名。1列目は w-8 前提）
 *  - freezeLast: 右端の列（操作・保存など）を固定
 */
export function StickyGrid({
  children,
  freeze = true,
  freeze2 = false,
  freezeLast = false,
  maxHeight,
  className,
}: {
  children: React.ReactNode;
  freeze?: boolean;
  freeze2?: boolean;
  freezeLast?: boolean;
  maxHeight?: string;
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const top = topRef.current;
    const inner = innerRef.current;
    const scroll = scrollRef.current;
    if (!shell || !top || !inner || !scroll) return;
    const table = scroll.querySelector("table");

    const size = () => {
      const w = table ? table.scrollWidth : scroll.scrollWidth;
      inner.style.width = `${w}px`;
      shell.dataset.x = w > scroll.clientWidth + 1 ? "1" : "";
      // 先頭2列固定時は1列目の実幅を測って2列目の left を合わせる（チェックボックス列の幅ゆらぎ対策）
      if (scroll.hasAttribute("data-freeze2")) {
        const firstTh = scroll.querySelector<HTMLElement>("thead th:first-child");
        if (firstTh) scroll.style.setProperty("--freeze-col1-w", `${firstTh.offsetWidth}px`);
      }
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(scroll);
    if (table) ro.observe(table);

    let lock = false;
    const fromScroll = () => {
      if (lock) return;
      lock = true;
      top.scrollLeft = scroll.scrollLeft;
      lock = false;
    };
    const fromTop = () => {
      if (lock) return;
      lock = true;
      scroll.scrollLeft = top.scrollLeft;
      lock = false;
    };
    scroll.addEventListener("scroll", fromScroll, { passive: true });
    top.addEventListener("scroll", fromTop, { passive: true });
    return () => {
      ro.disconnect();
      scroll.removeEventListener("scroll", fromScroll);
      top.removeEventListener("scroll", fromTop);
    };
  }, []);

  const freezeAttr: Record<string, string> = freeze2 ? { "data-freeze2": "" } : freeze ? { "data-freeze": "" } : {};
  if (freezeLast) freezeAttr["data-freeze-r"] = "";

  return (
    <div ref={shellRef} className={cn("sticky-grid-shell", className)}>
      <div ref={topRef} className="sticky-grid-topbar" aria-hidden="true">
        <div ref={innerRef} className="sticky-grid-topbar-inner" />
      </div>
      <div ref={scrollRef} className="sticky-grid" style={maxHeight ? { maxHeight } : undefined} {...freezeAttr}>
        {children}
      </div>
    </div>
  );
}
