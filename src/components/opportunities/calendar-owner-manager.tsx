"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, Palette } from "lucide-react";
import { CALENDAR_OWNER_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface OwnerMeta {
  id: string;
  name: string;
  color: string;
  hidden: boolean;
}

/** 1担当ぶんの色チップ選択ポップオーバー。 */
function ColorPicker({ color, onPick, disabled }: { color: string; onPick: (c: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-black/10 transition-opacity",
          disabled ? "opacity-30" : "hover:ring-black/25",
        )}
        style={{ background: color }}
        title="色を選ぶ"
        aria-label="色を選ぶ"
      >
        <Palette size={12} className="text-white/85" />
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 grid grid-cols-8 gap-1 rounded-lg border border-black/10 bg-white p-2 shadow-lg">
            {CALENDAR_OWNER_COLORS.map((c) => {
              const active = c.toUpperCase() === color.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onPick(c); setOpen(false); }}
                  className={cn("flex h-5 w-5 items-center justify-center rounded ring-1 ring-black/10", active && "ring-2 ring-ink/60")}
                  style={{ background: c }}
                  title={c}
                >
                  {active && <Check size={11} className="text-white" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * カレンダーの担当×色の編集パネル。
 *  - 色チップで担当ごとの色を変更（profiles.avatar_color を更新）。
 *  - 不要な担当を「非表示」にして凡例/カレンダーから隠す（戻すこともできる）。
 */
export function CalendarOwnerManager({
  owners,
  onSetColor,
  onSetHidden,
  onClose,
}: {
  owners: OwnerMeta[];
  onSetColor: (userId: string, color: string) => void;
  onSetHidden: (userId: string, hidden: boolean) => void;
  onClose: () => void;
}) {
  const visible = owners.filter((o) => !o.hidden);
  const hidden = owners.filter((o) => o.hidden);

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-ink/70">担当の色・表示を編集<span className="ml-2 font-normal text-ink/40">色チップで色変更／「非表示」でカレンダーから除外</span></div>
        <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs text-ink/60 hover:bg-mist-soft">完了</button>
      </div>

      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {visible.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <ColorPicker color={o.color} onPick={(c) => onSetColor(o.id, c)} />
            <span className="truncate text-sm text-ink/80">{o.name || "（名称未設定）"}</span>
            <button
              type="button"
              onClick={() => onSetHidden(o.id, true)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-[11px] text-ink/55 hover:bg-mist-soft"
              title="カレンダーから非表示にする"
            >
              <EyeOff size={12} /> 非表示
            </button>
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <div className="border-t border-black/[0.06] pt-2.5">
          <div className="mb-1.5 text-[11px] font-medium text-ink/45">非表示の担当（{hidden.length}）</div>
          <ul className="flex flex-wrap gap-1.5">
            {hidden.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onSetHidden(o.id, false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-mist-soft px-2 py-1 text-[11px] text-ink/50 hover:text-ink"
                  title="表示に戻す"
                >
                  <span className="h-2.5 w-2.5 rounded-sm opacity-50" style={{ background: o.color }} />
                  {o.name || "（名称未設定）"}
                  <Eye size={12} className="ml-0.5" /> 表示
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
