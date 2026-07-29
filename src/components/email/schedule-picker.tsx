"use client";

import { useState } from "react";
import { Clock, X } from "lucide-react";
import { schedulePresets, isoToJstLocalInput, jstLocalInputToIso, formatJstSchedule, validateScheduleAt, isOutsideBusinessHours } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * 送信日時ピッカー（Gmailの「送信日時を設定」相当）。
 * プリセット（明日の朝/今日の夕方/来週の月曜）＋任意の日時指定。値はUTCのISOで返す。
 */
export function SchedulePicker({ value, onChange, disabled }: {
  value: string | null;              // UTC ISO。null=即時送信
  onChange: (iso: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value ? isoToJstLocalInput(value) : "");
  const [error, setError] = useState<string | null>(null);
  const presets = schedulePresets(Date.now());

  const pick = (iso: string) => {
    const v = validateScheduleAt(iso, Date.now());
    if (!v.ok) { setError(v.error); return; }
    setError(null);
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      {value ? (
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-teal-primary bg-teal-light/30 px-3 py-1.5 text-sm text-teal-deep">
          <Clock size={14} />
          <button onClick={() => setOpen(!open)} disabled={disabled} className="font-medium">
            {formatJstSchedule(value)} に送信
          </button>
          <button onClick={() => { onChange(null); setCustom(""); }} disabled={disabled} className="text-teal-deep/50 hover:text-rose-600" title="予約を解除して即時送信に戻す">
            <X size={13} />
          </button>
        </div>
      ) : (
        <button onClick={() => setOpen(!open)} disabled={disabled} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
          <Clock size={14} /> 送信日時を指定
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 w-72 rounded-xl border border-black/10 bg-white p-3 shadow-lg space-y-2">
            <p className="text-xs font-semibold text-ink/60">送信日時を設定</p>
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() => pick(p.iso)}
                className="w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-mist-soft/60 text-left"
              >
                <span>{p.label}</span>
                <span className="text-xs text-ink/40">{formatJstSchedule(p.iso)}</span>
              </button>
            ))}
            <div className="border-t border-black/[0.06] pt-2 space-y-1">
              <label className="text-xs text-ink/50 block">日時を指定（JST）</label>
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="input text-sm flex-1"
                />
                <button
                  onClick={() => custom && pick(jstLocalInputToIso(custom))}
                  disabled={!custom}
                  className="btn-accent text-xs px-3 disabled:opacity-40"
                >
                  設定
                </button>
              </div>
              {custom && isOutsideBusinessHours(jstLocalInputToIso(custom)) && (
                <p className="text-[11px] text-amber-600">営業時間外（平日8〜18時以外）です。相手に届く時間帯にご注意ください。</p>
              )}
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** 予約中バッジ（一覧・完了画面用）。 */
export function ScheduleBadge({ iso, className }: { iso: string; className?: string }) {
  return (
    <span className={cn("pill bg-teal-light text-teal-deep text-[10px] inline-flex items-center gap-1", className)}>
      <Clock size={9} /> {formatJstSchedule(iso)}
    </span>
  );
}
