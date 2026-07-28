"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { saveScoringConfigAction } from "@/server/actions/scoring";
import { MATCH_KINDS, MATCH_KIND_MAP, AGG_LABEL } from "@/lib/scoring";
import { cn } from "@/lib/utils";

/**
 * スコア設計エディタ: 軸(上限点)とルール(条件→点数)をインライン編集し、保存→全件再スコア。
 * スコアは「有効ルールを持つ軸の上限点の合計」で0-100に正規化される(rescore_leads / 0174)。
 */

export interface AxisRow { axis: string; label: string; cap: number; agg: string; sort_order: number }
export interface RuleRow { id?: string; axis: string; label: string; match_kind: string; match_value: string; points: number; sort_order: number; is_active: boolean }

export function ScoringDesigner({ axes: axes0, rules: rules0, canEdit }: { axes: AxisRow[]; rules: RuleRow[]; canEdit: boolean }) {
  const [axes, setAxes] = useState<AxisRow[]>(axes0);
  const [rules, setRules] = useState<RuleRow[]>(rules0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; dist?: Record<string, number> } | null>(null);

  const activeCapTotal = axes.filter((a) => rules.some((r) => r.axis === a.axis && r.is_active)).reduce((s, a) => s + a.cap, 0);

  const setAxis = (axis: string, patch: Partial<AxisRow>) => setAxes((prev) => prev.map((a) => (a.axis === axis ? { ...a, ...patch } : a)));
  const setRule = (i: number, patch: Partial<RuleRow>) => setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((prev) => prev.filter((_, j) => j !== i));
  const addRule = (axis: string) =>
    setRules((prev) => [...prev, { axis, label: "", match_kind: axis === "size" ? "employee_gte" : "text_includes", match_value: "", points: 5, sort_order: prev.length, is_active: true }]);

  const save = async () => {
    if (!confirm("保存すると全リードが新しいルールで再スコアされます（手動設定したランクは保持されます）。よろしいですか？")) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await saveScoringConfigAction(
        axes.map((a) => ({ axis: a.axis, label: a.label, cap: a.cap })),
        rules.map((r2, i) => ({ ...r2, sort_order: i })),
      );
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
      else setMsg({ ok: true, text: `保存し、${r.rescored?.toLocaleString()}件を再スコアしました`, dist: r.distribution });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card card-pad text-sm space-y-1">
        <p className="text-ink/70">
          <b>スコアの決まり方</b>: リードごとに各軸のルールを判定して点を出し、
          <b>「有効なルールがある軸の上限点の合計（現在 {activeCapTotal}点）」を100点満点に換算</b>します。
          ランクは S(80+) / A(65+) / B(50+) / C(35+) / D。手動で設定したランクは上書きされません。
        </p>
        <p className="text-xs text-ink/45">
          役職は取込時に役職名からレベル(経営層/部課長/担当)を自動判定し、さらに「役職名に含む」ルールで個別のパターンも拾えます。判定できない表記が増えてきたらルールに追加してください。
        </p>
      </div>

      {axes.map((a) => {
        const axisRules = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.axis === a.axis);
        return (
          <div key={a.axis} className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/[0.06] bg-mist-soft/40 flex flex-wrap items-center gap-3">
              <input
                value={a.label}
                onChange={(e) => setAxis(a.axis, { label: e.target.value })}
                disabled={!canEdit}
                className="font-semibold text-ink bg-transparent outline-none border-b border-transparent focus:border-teal-primary min-w-[180px]"
              />
              <label className="text-xs text-ink/50 inline-flex items-center gap-1.5">
                上限
                <input
                  type="number"
                  value={a.cap}
                  onChange={(e) => setAxis(a.axis, { cap: parseInt(e.target.value, 10) || 0 })}
                  disabled={!canEdit}
                  className="w-16 rounded-lg border border-black/10 px-2 py-0.5 text-sm tabular-nums"
                />
                点
              </label>
              <span className="pill bg-mist-soft text-ink/50 text-[10px]">{AGG_LABEL[a.agg] ?? a.agg}</span>
              {!rules.some((r) => r.axis === a.axis && r.is_active) && (
                <span className="pill bg-amber-100 text-amber-700 text-[10px]">有効ルールなし（この軸は計算に含まれません）</span>
              )}
            </div>
            <div className="p-3 space-y-1.5">
              {axisRules.map(({ r, i }) => (
                <div key={i} className={cn("flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5", r.is_active ? "" : "opacity-50 bg-mist-soft/30")}>
                  <input type="checkbox" checked={r.is_active} onChange={(e) => setRule(i, { is_active: e.target.checked })} disabled={!canEdit} className="accent-teal-primary" title="有効/無効" />
                  <input
                    value={r.label}
                    onChange={(e) => setRule(i, { label: e.target.value })}
                    disabled={!canEdit}
                    placeholder="ルール名（例: 従業員300名以上）"
                    className="rounded-lg border border-black/10 px-2 py-1 text-sm min-w-[200px] flex-1"
                  />
                  <select value={r.match_kind} onChange={(e) => setRule(i, { match_kind: e.target.value })} disabled={!canEdit} className="rounded-lg border border-black/10 px-2 py-1 text-xs">
                    {MATCH_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                  <input
                    value={r.match_value}
                    onChange={(e) => setRule(i, { match_value: e.target.value })}
                    disabled={!canEdit}
                    placeholder={MATCH_KIND_MAP[r.match_kind]?.hint ?? "条件値"}
                    title={MATCH_KIND_MAP[r.match_kind]?.hint}
                    className="rounded-lg border border-black/10 px-2 py-1 text-xs font-mono min-w-[220px] flex-1"
                  />
                  <label className="text-xs text-ink/50 inline-flex items-center gap-1">
                    <input
                      type="number"
                      value={r.points}
                      onChange={(e) => setRule(i, { points: parseInt(e.target.value, 10) || 0 })}
                      disabled={!canEdit}
                      className="w-14 rounded-lg border border-black/10 px-2 py-1 text-sm tabular-nums text-right"
                    />
                    点
                  </label>
                  {canEdit && (
                    <button onClick={() => removeRule(i)} className="text-ink/30 hover:text-rose-600" title="削除"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button onClick={() => addRule(a.axis)} className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline px-2 py-1">
                  <Plus size={13} /> ルールを追加
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && (
          <button onClick={save} disabled={saving} className="btn-accent inline-flex items-center gap-1.5 text-sm">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存して全件を再スコア
          </button>
        )}
        {!canEdit && <p className="text-xs text-ink/45">編集は管理者・営業マネージャーのみ可能です（閲覧のみ）。</p>}
        {msg && (
          <span className={`inline-flex items-center gap-1.5 text-sm ${msg.ok ? "text-teal-deep" : "text-rose-600"}`}>
            {msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.text}
            {msg.dist && (
              <span className="text-xs text-ink/55 tabular-nums ml-2">
                → S:{msg.dist.S} / A:{msg.dist.A} / B:{msg.dist.B} / C:{msg.dist.C} / D:{msg.dist.D}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
