"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { GOAL_STATUSES, GOAL_STATUS_MAP } from "@/lib/constants";
import { updateGoalProgressAction, setGoalStatusAction } from "@/server/actions/tasks";
import type { GoalStatus } from "@/lib/types";

interface GoalLite {
  id: string;
  current: number;
  target: number | null;
  unit: string | null;
  kind: string;
  status: GoalStatus;
}

function pct(g: GoalLite): number {
  if (g.kind === "percent") return Math.min(100, Math.max(0, g.target ? (g.current / g.target) * 100 : g.current));
  if (!g.target || g.target === 0) return g.current > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (g.current / g.target) * 100));
}

function fmtVal(v: number, g: GoalLite): string {
  if (g.kind === "currency") return `¥${Math.round(v).toLocaleString()}`;
  if (g.kind === "percent") return `${v}%`;
  return `${v.toLocaleString()}${g.unit ? g.unit : ""}`;
}

export function GoalMeter({ goal, compact }: { goal: GoalLite; compact?: boolean }) {
  const [, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(goal.current));
  const p = Math.round(pct(goal));
  const st = GOAL_STATUS_MAP[goal.status];

  const save = () => {
    const n = Number(val.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) start(() => updateGoalProgressAction(goal.id, n));
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs text-ink/50">
          {editing ? (
            <input
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-24 rounded border border-teal-primary px-1.5 py-0.5 text-sm outline-none"
            />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="hover:text-teal-deep">
              <span className="text-base font-bold text-ink">{fmtVal(goal.current, goal)}</span>
              {goal.target != null && <span className="text-ink/40"> / {fmtVal(goal.target, goal)}</span>}
            </button>
          )}
        </div>
        <span className="text-sm font-bold tabular-nums text-teal-deep">{p}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", st.dot)} style={{ width: `${p}%` }} />
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-1">
          {GOAL_STATUSES.filter((s) => s.key !== "no_status").map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => start(() => setGoalStatusAction(goal.id, s.key))}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors",
                goal.status === s.key ? cn(s.bg, s.text) : "text-ink/40 hover:bg-mist-soft",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
