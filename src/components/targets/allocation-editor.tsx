"use client";

import { useState } from "react";
import { Plus, Trash2, Users, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveAllocationsAction } from "@/server/actions/targets-allocation";
import type { Allocation } from "@/lib/data/target-allocations";

type Opt = { id: string; name: string };
type Row = { key: number; ownerId: string; sourceId: string; label: string; amount: number };

const fmt = (n: number) => (n ? n.toLocaleString("ja-JP") : "");
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

export function AllocationEditor({
  month,
  monthLabel,
  companyTarget,
  members,
  sources,
  initial,
}: {
  month: string;
  monthLabel: string;
  companyTarget: number;
  members: Opt[];
  sources: Opt[];
  initial: Allocation[];
}) {
  const seed: Row[] =
    initial.length > 0
      ? initial.map((a, i) => ({ key: i, ownerId: a.owner_user_id ?? "", sourceId: a.lead_source_id ?? "", label: a.label ?? "", amount: Number(a.amount) || 0 }))
      : [{ key: 0, ownerId: "", sourceId: "", label: "", amount: 0 }];
  const [rows, setRows] = useState<Row[]>(seed);
  const [nextKey, setNextKey] = useState(seed.length);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => { setRows((rs) => [...rs, { key: nextKey, ownerId: "", sourceId: "", label: "", amount: 0 }]); setNextKey((k) => k + 1); };
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  /** 個人別に展開: 全メンバーを行に展開し、全社目標を均等割りの初期値に。 */
  const expandByMember = () => {
    const per = members.length ? Math.round(companyTarget / members.length) : 0;
    setRows(members.map((m, i) => ({ key: i, ownerId: m.id, sourceId: "", label: "", amount: per })));
    setNextKey(members.length);
  };

  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = companyTarget - sum;

  return (
    <form action={saveAllocationsAction} className="space-y-3">
      <input type="hidden" name="target_month" value={month} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-ink/60">{monthLabel} の全社目標</span>{" "}
          <span className="font-bold text-ink tabular-nums">{yen(companyTarget)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={expandByMember} className="btn-ghost inline-flex items-center gap-1 text-xs">
            <Users size={13} /> 個人別に展開（均等割り）
          </button>
          <button type="button" onClick={add} className="btn-ghost inline-flex items-center gap-1 text-xs">
            <Plus size={13} /> 行を追加
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th className="th">担当者</th>
              <th className="th">流入元</th>
              <th className="th">区分ラベル（パートナー/その他 等）</th>
              <th className="th text-right">配分額(円)</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-black/[0.04]">
                <td className="td">
                  <select name="alloc_owner" value={r.ownerId} onChange={(e) => set(r.key, { ownerId: e.target.value })} className="input">
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <select name="alloc_source" value={r.sourceId} onChange={(e) => set(r.key, { sourceId: e.target.value })} className="input">
                    <option value="">—</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <input name="alloc_label" value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} placeholder="例: パートナー / その他" className="input" />
                </td>
                <td className="td">
                  <input
                    name="alloc_amount"
                    inputMode="numeric"
                    value={fmt(r.amount)}
                    onChange={(e) => set(r.key, { amount: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                    placeholder="0"
                    className="input text-right"
                  />
                </td>
                <td className="td">
                  <button type="button" onClick={() => remove(r.key)} className="text-ink/30 hover:text-rose-600" title="削除" aria-label="削除">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-mist-soft/40 px-4 py-2 text-sm">
        <div className="flex items-center gap-4 tabular-nums">
          <span>配分合計 <span className="font-semibold">{yen(sum)}</span></span>
          <span className={cn("font-semibold", remaining === 0 ? "text-emerald-600" : remaining < 0 ? "text-rose-600" : "text-accent-orange")}>
            残り {yen(remaining)}
          </span>
        </div>
        <button type="submit" className="btn-primary inline-flex items-center gap-1.5">
          <Save size={15} /> 配分を保存（担当分は週報目標へ反映）
        </button>
      </div>
      <p className="text-xs text-ink/45">担当者を選んだ行の金額は、その営業マンの当月目標（`rep_targets`）として保存され、営業マン別週報に反映されます。同一担当が複数行にある場合は合算されます。</p>
    </form>
  );
}
