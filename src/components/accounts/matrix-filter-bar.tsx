"use client";

import { Loader2, RotateCcw, Search } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  EMPTY_MATRIX_FILTER, hasMatrixFilter,
  MATRIX_DEAL_OPTIONS, MATRIX_OPEN_OPTIONS, MATRIX_PERIOD_OPTIONS,
  MATRIX_SIZE_OPTIONS, MATRIX_STATUS_OPTIONS,
  type MatrixFilterState,
} from "@/lib/account-matrix";

/**
 * 顧客分析マトリクスの絞り込みバー。
 * 会社名検索・営業担当・エリア・区分・会社規模・取引額・取引時期・案件状況。
 *
 * 絞り込みはセルの中身まで変わるため、状態は親(SegmentRankMatrix)が持ち、
 * ここは表示と変更通知だけを担当する。
 */
export function MatrixFilterBar({
  value,
  onChange,
  owners,
  areas,
  loading,
  shown,
  total,
}: {
  value: MatrixFilterState;
  onChange: (next: MatrixFilterState) => void;
  owners: { id: string; name: string }[];
  areas: string[];
  loading: boolean;
  /** 絞り込み後の社数 */
  shown: number;
  /** 絞り込み無しの社数 */
  total: number;
}) {
  const active = hasMatrixFilter(value);
  const set = (patch: Partial<MatrixFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="card card-pad mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            value={value.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="会社名で検索（株式会社・カナ表記のゆれは自動吸収）"
            className="input pl-9"
          />
        </div>

        {owners.length > 0 && (
          <MultiSelect
            selected={value.owner}
            onChange={(v) => set({ owner: v })}
            placeholder="営業担当"
            options={[{ id: "__none", name: "未割当" }, ...owners]}
          />
        )}

        {areas.length > 0 && (
          <MultiSelect
            selected={value.area}
            onChange={(v) => set({ area: v })}
            placeholder="エリア"
            options={areas.map((a) => ({ id: a, name: a }))}
          />
        )}

        <MultiSelect
          selected={value.status}
          onChange={(v) => set({ status: v })}
          placeholder="区分"
          options={MATRIX_STATUS_OPTIONS.map((s) => ({ id: s.key, name: s.label }))}
        />

        <Select value={value.size} onChange={(v) => set({ size: v })} allLabel="会社規模：すべて" options={MATRIX_SIZE_OPTIONS} />
        <Select value={value.deal} onChange={(v) => set({ deal: v })} allLabel="取引額：すべて" options={MATRIX_DEAL_OPTIONS} />
        <Select value={value.period} onChange={(v) => set({ period: v })} allLabel="取引時期：すべて" options={MATRIX_PERIOD_OPTIONS} />
        <Select value={value.openState} onChange={(v) => set({ openState: v })} allLabel="案件状況：すべて" options={MATRIX_OPEN_OPTIONS} />

        <button
          type="button"
          onClick={() => onChange(EMPTY_MATRIX_FILTER)}
          disabled={!active}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm text-ink/60 hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={14} /> 絞り込みをリセット
        </button>
      </div>

      <div className="flex items-center gap-3 px-1 text-xs text-ink/55">
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-ink/40">
            <Loader2 size={13} className="animate-spin" /> 絞り込み中…
          </span>
        ) : active ? (
          <span>
            該当 <b className="tabular-nums text-teal-deep">{shown}</b> 社
            <span className="ml-1 text-ink/35 tabular-nums">／ 全{total}社</span>
          </span>
        ) : (
          <span className="text-ink/40 tabular-nums">全{total}社</span>
        )}
        <span className="text-ink/35">
          取引額・取引時期は「受注済み案件」の合計と完了予定日で判定します。
        </span>
      </div>
    </div>
  );
}

/** プリセットから1つだけ選ぶ絞り込み(規模・取引額・時期・案件状況)。 */
function Select({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { key: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        "rounded-xl border bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary " +
        (value ? "border-teal-primary text-teal-deep" : "border-black/10 text-ink/70")
      }
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
}
