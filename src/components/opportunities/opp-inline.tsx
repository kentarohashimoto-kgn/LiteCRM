"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OppView } from "@/lib/data/select";
import { updateOppInlineAction, type OppInlineField } from "@/server/actions/opportunities";
import { YOMI_OPTIONS } from "@/lib/constants";
import { formatYen, formatDate, cn } from "@/lib/utils";

/** インライン編集の確定後、親のローカル状態へ反映するコールバック。 */
export type OnEdited = (id: string, patch: Record<string, unknown>, updatedAt: string) => void;

async function runSave(
  opp: OppView,
  field: OppInlineField,
  value: string | null,
  onEdited: OnEdited,
  onConflict: () => void,
): Promise<boolean> {
  const res = await updateOppInlineAction({ id: opp.id, updatedAt: opp.updated_at, field, value });
  if (res.ok) {
    onEdited(opp.id, res.patch, res.updated_at);
    return true;
  }
  // 検証エラー/競合は明示的に知らせる（クイック編集なので割り込み表示が適切）
  alert(res.error);
  if (res.conflict) onConflict();
  return false;
}

/** ヨミ（確度）のインライン変更。確度/ステージ/予測区分はサーバー側で連動更新される。 */
export function InlineYomi({ opp, onEdited }: { opp: OppView; onEdited: OnEdited }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  return (
    <select
      value={opp.yomi ?? ""}
      disabled={saving}
      onChange={async (e) => {
        setSaving(true);
        await runSave(opp, "yomi", e.target.value, onEdited, () => router.refresh());
        setSaving(false);
      }}
      className={cn(
        "rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary max-w-[112px]",
        saving && "opacity-50",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">未設定</option>
      {YOMI_OPTIONS.map((y) => (
        <option key={y.key} value={y.key}>{y.label}</option>
      ))}
    </select>
  );
}

/** 金額のインライン編集（クリックで入力、Enter/blurで保存）。 */
export function InlineAmount({ opp, onEdited }: { opp: OppView; onEdited: OnEdited }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(opp.amount ?? 0));
  const [saving, setSaving] = useState(false);

  async function commit() {
    const n = Number(val.replace(/[^\d.-]/g, "")) || 0;
    setEditing(false);
    if (n === opp.amount) return;
    setSaving(true);
    const ok = await runSave(opp, "amount", String(n), onEdited, () => router.refresh());
    if (!ok) setVal(String(opp.amount ?? 0));
    setSaving(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setVal(String(opp.amount ?? 0)); setEditing(true); }}
        className={cn("w-full text-right tabular-nums font-semibold hover:text-teal-deep", saving && "opacity-50")}
        title="クリックして編集"
      >
        {formatYen(opp.amount)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setEditing(false); setVal(String(opp.amount ?? 0)); }
      }}
      className="w-24 rounded-lg border border-teal-primary bg-white px-2 py-1 text-xs text-right tabular-nums outline-none"
    />
  );
}

/** 次回アクション日のインライン編集（date input）。 */
export function InlineNextDate({ opp, onEdited }: { opp: OppView; onEdited: OnEdited }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const cur = opp.next_action_date ? opp.next_action_date.slice(0, 10) : "";
  return (
    <input
      type="date"
      value={cur}
      disabled={saving}
      onChange={async (e) => {
        setSaving(true);
        await runSave(opp, "next_action_date", e.target.value || null, onEdited, () => router.refresh());
        setSaving(false);
      }}
      className={cn(
        "rounded-lg border bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary",
        cur ? "border-black/10" : "border-amber-300 bg-amber-50 text-accent-orange",
        saving && "opacity-50",
      )}
      title={cur ? undefined : "次回アクション未設定"}
    />
  );
}

/** 表示専用の次回アクション日（編集不可のとき）。 */
export function NextDateReadonly({ date }: { date?: string | null }) {
  if (!date) return <span className="pill bg-amber-50 text-accent-orange text-[10px]">未設定</span>;
  return <span className="text-xs">{formatDate(date)}</span>;
}
