"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2, X, Check, AlertTriangle,
} from "lucide-react";
import {
  saveSegmentAction,
  setSegmentVisibleAction,
  reorderSegmentsAction,
  deleteSegmentAction,
  saveRankSettingsAction,
} from "@/server/actions/account-segments";
import {
  DEFAULT_SEGMENT_COLOR, SEGMENT_COLOR_CHOICES,
  type MatrixSegment, type RankSettings,
} from "@/lib/account-matrix";
import { cn } from "@/lib/utils";

/**
 * セグメント(業界分類)の編集パネル。
 * 表示順の入れ替え・表示/非表示・名称/色/自動マッピング用キーワードの編集と、
 * ランク自動判定の閾値設定をまとめて扱う。
 * 並び替えは上下ボタン方式(ドラッグ&ドロップは依存を増やさず、タッチ端末でも確実に動くため)。
 */
export function SegmentEditor({
  segments,
  settings,
  counts,
  onClose,
}: {
  segments: MatrixSegment[];
  settings: RankSettings;
  /** セグメントIDごとの所属顧客数(削除時の影響を見せるため) */
  counts: Record<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<MatrixSegment[]>(segments);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);

  function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setOrderDirty(true);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "保存に失敗しました"); return false; }
    router.refresh();
    return true;
  }

  async function saveOrder() {
    const ok = await run(() => reorderSegmentsAction({ ids: order.map((s) => s.id) }));
    if (ok) setOrderDirty(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="セグメント設定"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-black/10 bg-white shadow-2xl lg:w-[560px]"
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-ink">セグメント設定</h2>
            <p className="text-[11px] text-ink/50">並び順・表示/非表示・自動マッピングの条件を変更します。</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink/45 hover:bg-mist-soft hover:text-ink" title="閉じる">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {err && (
            <div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>{err}</span>
            </div>
          )}

          {/* 並び順・表示切替 */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-bold text-ink/70">セグメント一覧</h3>
              {orderDirty && (
                <button onClick={() => void saveOrder()} disabled={busy} className="btn-primary inline-flex items-center gap-1 text-xs disabled:opacity-60">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 並び順を保存
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {order.map((s, i) =>
                editingId === s.id ? (
                  <SegmentForm
                    key={s.id}
                    segment={s}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (input) => {
                      const ok = await run(() => saveSegmentAction({ ...input, id: s.id }));
                      if (ok) setEditingId(null);
                    }}
                    onDelete={async () => {
                      const n = counts[s.id] ?? 0;
                      const msg = n > 0
                        ? `「${s.name}」を削除します。手動で割り当てた顧客は未分類に戻ります。よろしいですか？`
                        : `「${s.name}」を削除しますか？`;
                      if (!confirm(msg)) return;
                      const ok = await run(() => deleteSegmentAction({ id: s.id }));
                      if (ok) { setEditingId(null); setOrder((o) => o.filter((x) => x.id !== s.id)); }
                    }}
                  />
                ) : (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                      s.isVisible ? "border-black/[0.06]" : "border-dashed border-black/10 bg-mist-soft/40"
                    )}
                  >
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0 || busy} className="text-ink/35 hover:text-teal-primary disabled:opacity-25" title="上へ">
                        <ArrowUp size={13} />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={i === order.length - 1 || busy} className="text-ink/35 hover:text-teal-primary disabled:opacity-25" title="下へ">
                        <ArrowDown size={13} />
                      </button>
                    </div>

                    <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: s.color ?? DEFAULT_SEGMENT_COLOR }} />

                    <button onClick={() => setEditingId(s.id)} className="min-w-0 flex-1 text-left">
                      <span className={cn("block truncate text-sm font-medium", s.isVisible ? "text-ink" : "text-ink/40")}>
                        {s.name}
                        <span className="ml-1.5 text-[11px] font-normal text-ink/40 tabular-nums">{counts[s.id] ?? 0}社</span>
                      </span>
                      <span className="block truncate text-[10px] text-ink/40">
                        {s.keywords.length > 0 ? `業種キーワード: ${s.keywords.join(" / ")}` : "自動マッピングなし（手動割当のみ）"}
                      </span>
                    </button>

                    <button
                      onClick={() => void run(() => setSegmentVisibleAction({ id: s.id, isVisible: !s.isVisible }))}
                      disabled={busy}
                      title={s.isVisible ? "マトリクスから隠す" : "マトリクスに表示する"}
                      className={cn("shrink-0 rounded-lg p-1.5", s.isVisible ? "text-teal-primary hover:bg-teal-light/40" : "text-ink/30 hover:bg-mist-soft")}
                    >
                      {s.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </div>
                )
              )}

              {adding ? (
                <SegmentForm
                  isNew
                  busy={busy}
                  onCancel={() => setAdding(false)}
                  onSubmit={async (input) => {
                    const ok = await run(() => saveSegmentAction({ ...input, id: null }));
                    if (ok) setAdding(false);
                  }}
                />
              ) : (
                <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 pt-1 text-sm text-teal-deep hover:underline">
                  <Plus size={15} /> セグメントを追加
                </button>
              )}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
              非表示にしてもデータは消えません（マトリクスの行から外れるだけ）。
              キーワードは顧客の「業種」に部分一致でマッチし、上にあるセグメントが優先されます。
              個別に固定したい顧客は、顧客名をクリックして右ペインで直接セグメントを選んでください。
            </p>
          </section>

          <RankSettingsForm settings={settings} busy={busy} onSubmit={(s) => run(() => saveRankSettingsAction(s))} />
        </div>
      </aside>
    </>
  );
}

/** セグメント1件の追加/編集フォーム。 */
function SegmentForm({
  segment,
  isNew = false,
  busy,
  onSubmit,
  onCancel,
  onDelete,
}: {
  segment?: MatrixSegment;
  isNew?: boolean;
  busy: boolean;
  onSubmit: (input: { name: string; color: string | null; keywords: string }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(segment?.name ?? "");
  const [color, setColor] = useState(segment?.color ?? DEFAULT_SEGMENT_COLOR);
  const [keywords, setKeywords] = useState((segment?.keywords ?? []).join("、"));

  return (
    <div className="space-y-2 rounded-lg border border-teal-primary/40 bg-teal-light/20 p-2.5">
      <label className="block text-xs text-ink/60">
        セグメント名
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="住宅・建築業界" className="input mt-0.5 w-full text-sm" autoFocus />
      </label>

      <label className="block text-xs text-ink/60">
        業種キーワード（部分一致・読点かカンマ区切り）
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="住宅、建築、建設、不動産"
          className="input mt-0.5 w-full text-sm"
        />
      </label>

      <div className="text-xs text-ink/60">
        色
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SEGMENT_COLOR_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={cn("h-6 w-6 rounded-full transition", color === c ? "ring-2 ring-ink/50 ring-offset-1" : "hover:scale-110")}
              title={c}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={() => void onSubmit({ name, color, keywords })}
          disabled={busy || !name.trim()}
          className="btn-primary inline-flex items-center gap-1 text-xs disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {isNew ? "追加" : "保存"}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-ghost text-xs">キャンセル</button>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 text-xs text-rose-600 hover:underline disabled:opacity-60"
          >
            <Trash2 size={12} /> 削除
          </button>
        )}
      </div>
    </div>
  );
}

/** ランク自動判定の閾値フォーム。 */
function RankSettingsForm({
  settings,
  busy,
  onSubmit,
}: {
  settings: RankSettings;
  busy: boolean;
  onSubmit: (s: RankSettings) => Promise<boolean>;
}) {
  const [v, setV] = useState<Record<keyof RankSettings, string>>({
    s_revenue: String(settings.s_revenue),
    a_revenue: String(settings.a_revenue),
    a_potential: String(settings.a_potential),
    b_potential: String(settings.b_potential),
    s_employees: String(settings.s_employees),
    a_employees: String(settings.a_employees),
  });
  const [saved, setSaved] = useState(false);

  const set = (k: keyof RankSettings, val: string) => { setV((p) => ({ ...p, [k]: val })); setSaved(false); };

  return (
    <section className="border-t border-black/[0.06] pt-4">
      <h3 className="text-xs font-bold text-ink/70">ランク自動判定の基準</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-ink/45">
        顧客ごとにランクを手動設定していない場合、ここの基準で自動判定します（手動設定が常に優先）。
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Num label="Sランク：累計受注（円）" value={v.s_revenue} onChange={(x) => set("s_revenue", x)} />
        <Num label="Sランク：従業員数（名〜）" value={v.s_employees} onChange={(x) => set("s_employees", x)} />
        <Num label="Aランク：累計受注（円）" value={v.a_revenue} onChange={(x) => set("a_revenue", x)} />
        <Num label="Aランク：従業員数（名〜）" value={v.a_employees} onChange={(x) => set("a_employees", x)} />
        <Num label="Aランク：見込みポテンシャル（円）" value={v.a_potential} onChange={(x) => set("a_potential", x)} />
        <Num label="Bランク：見込みポテンシャル（円）" value={v.b_potential} onChange={(x) => set("b_potential", x)} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={async () => {
            const ok = await onSubmit({
              s_revenue: Number(v.s_revenue), a_revenue: Number(v.a_revenue),
              a_potential: Number(v.a_potential), b_potential: Number(v.b_potential),
              s_employees: Number(v.s_employees), a_employees: Number(v.a_employees),
            });
            setSaved(ok);
          }}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-1 text-xs disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 基準を保存
        </button>
        {saved && <span className="text-xs text-teal-primary">保存しました</span>}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
        Bランクは「累計受注あり、または見込みポテンシャルが基準以上」、
        Cランクは「案件はあるが受注・見込みなし」、Dランクは「案件なし」です。
      </p>
    </section>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px] text-ink/60">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        className="input mt-0.5 w-full text-right text-sm tabular-nums"
      />
    </label>
  );
}
