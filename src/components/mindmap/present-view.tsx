"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X, Maximize } from "lucide-react";
import {
  buildTree,
  layoutMindmap,
  markerBadge,
  subtreeIds,
  type MindmapLayout,
  type MindmapMeta,
  type MindmapNode,
  type TreeNode,
} from "@/lib/mindmap";
import { cn } from "@/lib/utils";

/**
 * プレゼンモード: マインドマップそのものを使って発表する。
 * ルート→各枝→その子…と深さ優先で1ステップずつ「寄って」いき、
 * 対象のサブツリー以外は薄く落とす。←/→/Space で移動、Esc で終了。
 */

const PAD = 60;

/** 深さ優先で「話す順番」を作る(既定は第2階層まで。子が多い枝はその子も1ステップに)。 */
function buildSteps(root: TreeNode | null): TreeNode[] {
  if (!root) return [];
  const steps: TreeNode[] = [root];
  const walk = (node: TreeNode, depth: number) => {
    for (const c of node.children) {
      steps.push(c);
      if (depth < 2 && c.children.length > 0) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return steps;
}

export function PresentView({
  meta,
  nodes,
}: {
  meta: MindmapMeta;
  nodes: MindmapNode[];
}) {
  const [index, setIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 1200, h: 700 });

  // プレゼン中は折り畳みを無視して全体を見せる
  const tree = useMemo(() => buildTree(nodes.map((n) => ({ ...n, collapsed: false }))), [nodes]);
  const layout = useMemo(() => layoutMindmap(tree, { layout: meta.layout as MindmapLayout }), [tree, meta.layout]);
  const origin = useMemo(() => ({ x: -layout.minX + PAD, y: -layout.minY + PAD }), [layout]);
  const steps = useMemo(() => buildSteps(tree), [tree]);
  const current = steps[Math.min(index, Math.max(0, steps.length - 1))] ?? null;

  const focusIds = useMemo(() => (current ? subtreeIds(nodes, current.id) : new Set<string>()), [current, nodes]);

  useEffect(() => {
    const measure = () => {
      const r = viewportRef.current?.getBoundingClientRect();
      if (r) setViewport({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /** 現在ステップのサブツリーが画面いっぱいに収まる変換を求める。 */
  const transform = useMemo(() => {
    const targets = layout.nodes.filter((p) => focusIds.has(p.node.id));
    const box = targets.length > 0 ? targets : layout.nodes;
    if (box.length === 0) return { tx: 0, ty: 0, scale: 1 };
    const minX = Math.min(...box.map((p) => p.x)) + origin.x;
    const minY = Math.min(...box.map((p) => p.y)) + origin.y;
    const maxX = Math.max(...box.map((p) => p.x + p.w)) + origin.x;
    const maxY = Math.max(...box.map((p) => p.y + p.h)) + origin.y;
    const w = maxX - minX + PAD * 2;
    const h = maxY - minY + PAD * 2;
    const scale = Math.min(1.6, Math.max(0.15, Math.min(viewport.w / w, viewport.h / h)));
    return {
      scale,
      tx: viewport.w / 2 - ((minX + maxX) / 2) * scale,
      ty: viewport.h / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [layout, focusIds, origin, viewport]);

  const next = useCallback(() => setIndex((i) => Math.min(steps.length - 1, i + 1)), [steps.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(steps.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, steps.length]);

  const goFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div ref={shellRef} className="fixed inset-0 z-40 flex flex-col bg-white">
      {/* ヘッダ */}
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-ink">{meta.title}</div>
          <div className="truncate text-xs text-ink/50">{current?.title ?? ""}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-ink/50">
            {steps.length === 0 ? 0 : index + 1} / {steps.length}
          </span>
          <button type="button" onClick={prev} disabled={index === 0} className="btn-ghost !py-1.5 !px-2" aria-label="前へ">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={next} disabled={index >= steps.length - 1} className="btn-ghost !py-1.5 !px-2" aria-label="次へ">
            <ChevronRight size={16} />
          </button>
          <button type="button" onClick={goFullscreen} className="btn-ghost !py-1.5 !px-2" aria-label="全画面">
            <Maximize size={16} />
          </button>
          <Link href={`/app/mindmaps/${meta.id}`} className="btn-ghost !py-1.5 !px-2" aria-label="終了">
            <X size={16} />
          </Link>
        </div>
      </div>

      {/* マップ */}
      <div ref={viewportRef} className="relative flex-1 overflow-hidden bg-mist-soft" onClick={next}>
        <div
          className="absolute top-0 left-0 origin-top-left transition-transform duration-500 ease-out"
          style={{ transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})` }}
        >
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={layout.width + PAD * 2}
            height={layout.height + PAD * 2}
          >
            {layout.edges.map((e) => {
              const active = focusIds.has(e.toId) || focusIds.has(e.fromId);
              const x1 = e.x1 + origin.x;
              const y1 = e.y1 + origin.y;
              const x2 = e.x2 + origin.x;
              const y2 = e.y2 + origin.y;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${e.fromId}-${e.toId}`}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={active ? 2.5 : 2}
                  opacity={active ? 0.9 : 0.15}
                  className="transition-opacity duration-500"
                />
              );
            })}
          </svg>

          {layout.nodes.map((p) => {
            const n = p.node;
            const active = focusIds.has(n.id);
            const isRoot = !n.parent_id;
            const color = n.color ?? p.color;
            const badge = markerBadge(n.marker);
            return (
              <div
                key={n.id}
                className={cn(
                  "absolute rounded-xl border-2 bg-white px-3 py-2 shadow-sm transition-opacity duration-500",
                  !active && "opacity-15",
                )}
                style={{
                  left: p.x + origin.x,
                  top: p.y + origin.y,
                  width: p.w,
                  minHeight: p.h,
                  borderColor: color,
                  backgroundColor: isRoot ? color : `${color}14`,
                  color: isRoot ? "#fff" : "#0D2828",
                }}
              >
                <div className="flex items-start gap-1.5">
                  {badge && (
                    <span
                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: badge.bg }}
                    >
                      {badge.text}
                    </span>
                  )}
                  <span className="whitespace-pre-wrap break-words text-[13.5px] font-medium leading-5">
                    {n.title || "（無題）"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* メモ(発表者ノート) */}
        {current?.note && (
          <div className="absolute bottom-4 left-1/2 max-w-2xl -translate-x-1/2 rounded-xl bg-white/95 px-4 py-2 text-sm text-ink/70 shadow-card">
            {current.note}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-ink/40">
          ←/→ または クリックで移動・Esc で全画面解除
        </div>
      </div>
    </div>
  );
}
