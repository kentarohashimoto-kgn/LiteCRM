"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const CONFETTI_COLORS = ["#008C8C", "#F59A2A", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16"];

/**
 * タスク完了チェックボックス。完了時にポップ＋チェック描画＋紙吹雪で達成感を出す。
 * 実際の状態更新は onToggle に委譲（親が楽観更新＋サーバーアクションを担う）。
 */
export function TaskCheckbox({
  done,
  onToggle,
  size = 20,
}: {
  done: boolean;
  onToggle: (next: boolean) => void;
  size?: number;
}) {
  const [burst, setBurst] = useState(0);

  const click = () => {
    const next = !done;
    if (next) setBurst((b) => b + 1);
    onToggle(next);
  };

  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={done}
      aria-label={done ? "未完了に戻す" : "完了にする"}
      title={done ? "未完了に戻す" : "完了にする"}
      className={cn("task-check", done && "task-check-done", burst > 0 && done && "animate-check-pop")}
      style={{ width: size, height: size }}
    >
      {done && (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16" fill="none">
          <path
            className="checkmark-path"
            d="M3.5 8.5l3 3 6-6.5"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {burst > 0 && done && (
        <span key={burst} aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: 10 }).map((_, i) => {
            const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
            const dist = 16 + Math.random() * 14;
            return (
              <span
                key={i}
                className="confetti-piece"
                style={
                  {
                    background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                    "--dx": `${Math.cos(angle) * dist}px`,
                    "--dy": `${Math.sin(angle) * dist}px`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </span>
      )}
    </button>
  );
}
