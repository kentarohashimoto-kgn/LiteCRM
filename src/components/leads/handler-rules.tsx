"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Loader2, CheckCircle2, AlertTriangle, Play, UserCheck } from "lucide-react";
import { saveHandlerRulesAction, runHandlerAssignmentAction, type HandlerRule } from "@/server/actions/lead-handlers";
import { cn } from "@/lib/utils";

/**
 * 対応者(FS接客者)ルールの編集＋判定実行。
 * 展示会では「獲得担当がQRスキャン → 社長/責任者が接客して名刺交換」の2段構えのため、
 * (メモのパターン一致) OR (その人の名刺と一致) の複合条件で"誰が接客したか"を判定する。
 */

export function HandlerRules({ rules: rules0, members, handlers: handlers0, canEdit }: {
  rules: HandlerRule[];
  members: { id: string; name: string }[];
  handlers: { name: string; leads: number }[];
  canEdit: boolean;
}) {
  const [rules, setRules] = useState<HandlerRule[]>(rules0);
  const [handlers, setHandlers] = useState(handlers0);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setRule = (i: number, patch: Partial<HandlerRule>) => setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((prev) => [...prev, {
    handler_name: "", memo_pattern: "", memo_exclude: "", card_owner_user_id: null, card_from: null, priority: (prev.length + 1) * 10, is_active: true,
  }]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await saveHandlerRulesAction(rules);
      setMsg(r.ok ? { ok: true, text: "ルールを保存しました。「判定を実行」で反映してください。" } : { ok: false, text: r.error ?? "保存に失敗しました" });
    } finally { setSaving(false); }
  };

  const run = async () => {
    if (!confirm("名刺とリードの突合 → 対応者の判定 → 全件の再スコアを実行します。\n（手動設定した対応者は保護されます）")) return;
    setRunning(true); setMsg(null);
    try {
      const r = await runHandlerAssignmentAction();
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "実行に失敗しました" }); return; }
      setHandlers(r.distribution ?? []);
      setMsg({
        ok: true,
        text: `名刺紐付け ${(r.cardsMatched?.byEmail ?? 0) + (r.cardsMatched?.byName ?? 0)}件 / 対応者判定 ${r.assigned}件${r.cleared ? `（解除 ${r.cleared}件）` : ""} / 再スコア ${r.rescored?.toLocaleString()}件`,
      });
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-3">
      <div className="card card-pad text-sm space-y-1">
        <p className="text-ink/70">
          <b>対応者（接客した人）の判定</b>: 展示会では「獲得担当がQRスキャン → <b>社長・責任者が接客して名刺交換</b>」という流れのため、
          獲得担当とは別に「誰が接客したか」を判定します。条件は <b>(メモのパターン一致) または (その人の名刺と一致)</b> のOR。
        </p>
        <p className="text-xs text-ink/50">
          判定された対応者は<b>リード一覧の「対応者(接客)」で絞り込め</b>、スコアの「責任者接客」軸にも反映されます（＝優先度が上がります）。
          誤判定はリード詳細パネルで手修正でき、手修正した分は再実行しても上書きされません。
        </p>
        {handlers.length > 0 && (
          <p className="text-xs text-ink/60 pt-1">
            現在の判定結果: {handlers.map((h) => `${h.name} ${h.leads}件`).join(" / ")}
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-black/[0.06] bg-mist-soft/40 flex items-center gap-2">
          <UserCheck size={14} className="text-ink/50" />
          <span className="text-sm font-semibold text-ink">対応者ルール</span>
        </div>
        <div className="p-3 space-y-2">
          {rules.map((r, i) => (
            <div key={i} className={cn("rounded-xl border border-black/10 p-3 space-y-2", r.is_active ? "" : "opacity-50 bg-mist-soft/30")}>
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" checked={r.is_active} onChange={(e) => setRule(i, { is_active: e.target.checked })} disabled={!canEdit} className="accent-teal-primary" title="有効/無効" />
                <input
                  value={r.handler_name}
                  onChange={(e) => setRule(i, { handler_name: e.target.value })}
                  disabled={!canEdit}
                  placeholder="対応者名（例: 橋本 健太郎）"
                  className="rounded-lg border border-black/10 px-2 py-1 text-sm font-medium min-w-[180px]"
                />
                {canEdit && (
                  <button onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))} className="ml-auto text-ink/30 hover:text-rose-600" title="削除"><Trash2 size={14} /></button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <label className="space-y-0.5">
                  <span className="text-ink/50">メモに含む（正規表現。複数は | 区切り）</span>
                  <input value={r.memo_pattern} onChange={(e) => setRule(i, { memo_pattern: e.target.value })} disabled={!canEdit}
                    placeholder="例: 橋" className="w-full rounded-lg border border-black/10 px-2 py-1 font-mono" />
                </label>
                <label className="space-y-0.5">
                  <span className="text-ink/50">除外（この語を含む場合は対象外）</span>
                  <input value={r.memo_exclude} onChange={(e) => setRule(i, { memo_exclude: e.target.value })} disabled={!canEdit}
                    placeholder="例: セミナーを聞いて" className="w-full rounded-lg border border-black/10 px-2 py-1 font-mono" />
                </label>
                <label className="space-y-0.5">
                  <span className="text-ink/50">名刺の交換者（この人の名刺と一致したら該当）</span>
                  <select value={r.card_owner_user_id ?? ""} onChange={(e) => setRule(i, { card_owner_user_id: e.target.value || null })} disabled={!canEdit}
                    className="w-full rounded-lg border border-black/10 px-2 py-1">
                    <option value="">（使わない）</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="space-y-0.5">
                  <span className="text-ink/50">名刺交換日の下限（古い知人を除外）</span>
                  <input type="date" value={r.card_from ?? ""} onChange={(e) => setRule(i, { card_from: e.target.value || null })} disabled={!canEdit}
                    className="w-full rounded-lg border border-black/10 px-2 py-1" />
                </label>
              </div>
            </div>
          ))}
          {rules.length === 0 && <p className="text-xs text-ink/40 px-1 py-2">ルールがありません。</p>}
          {canEdit && (
            <button onClick={addRule} className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline px-2 py-1">
              <Plus size={13} /> 対応者ルールを追加
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && (
          <>
            <button onClick={save} disabled={saving || running} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} ルールを保存
            </button>
            <button onClick={run} disabled={saving || running} className="btn-accent inline-flex items-center gap-1.5 text-sm">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} 判定を実行（名刺突合→判定→再スコア）
            </button>
          </>
        )}
        {msg && (
          <span className={`inline-flex items-center gap-1.5 text-sm ${msg.ok ? "text-teal-deep" : "text-rose-600"}`}>
            {msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
