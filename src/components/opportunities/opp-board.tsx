"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OppView } from "@/lib/data/select";
import { updateOppInlineAction } from "@/server/actions/opportunities";
import type { OnEdited } from "./opp-inline";
import { Avatar } from "@/components/ui/primitives";
import { formatYen, cn } from "@/lib/utils";

// ボードに列として出すヨミ（0.受注・7/8失注は列にしない。要件書/WO-01）。
const BOARD_COLS = ["1.A(80%)", "2.B(50%)", "3.C(30%)", "4.アポ", "9.調整中", "5.リスケ", "6.定期追い"];

function isOverdue(d?: string | null): boolean {
  if (!d) return false;
  return d.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

export function OppBoard({ opps, onEdited }: { opps: OppView[]; onEdited: OnEdited }) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const byCol = new Map<string, OppView[]>();
  for (const c of BOARD_COLS) byCol.set(c, []);
  const others: OppView[] = [];
  for (const o of opps) {
    const arr = o.yomi ? byCol.get(o.yomi) : undefined;
    if (arr) arr.push(o);
    else others.push(o);
  }

  async function drop(col: string) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const opp = opps.find((o) => o.id === id);
    if (!opp || opp.yomi === col) return;
    setSavingId(id);
    const res = await updateOppInlineAction({ id, updatedAt: opp.updated_at, field: "yomi", value: col });
    setSavingId(null);
    if (res.ok) onEdited(id, res.patch, res.updated_at);
    else {
      alert(res.error);
      if (res.conflict) router.refresh();
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {BOARD_COLS.map((col) => {
        const list = byCol.get(col) ?? [];
        const total = list.reduce((s, o) => s + o.amount, 0);
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
            onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
            onDrop={() => drop(col)}
            className={cn(
              "shrink-0 w-64 rounded-xl border bg-mist-soft/40 flex flex-col",
              overCol === col ? "border-teal-primary bg-teal-light/40" : "border-black/[0.06]",
            )}
          >
            <div className="px-3 py-2 border-b border-black/[0.06] sticky top-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink/70">{col}</span>
                <span className="text-[11px] text-ink/40">{list.length}件</span>
              </div>
              <div className="text-[11px] text-ink/40 tabular-nums">{formatYen(total)}</div>
            </div>
            <div className="flex-1 p-2 space-y-2 min-h-[120px]">
              {list.map((o) => (
                <Card key={o.id} opp={o} saving={savingId === o.id} onDragStart={() => setDragId(o.id)} />
              ))}
              {list.length === 0 && <div className="text-[11px] text-ink/30 text-center py-6">—</div>}
            </div>
          </div>
        );
      })}

      {others.length > 0 && (
        <div className="shrink-0 w-64 rounded-xl border border-dashed border-black/[0.1] bg-white/40 flex flex-col">
          <div className="px-3 py-2 border-b border-black/[0.06]">
            <span className="text-xs font-bold text-ink/50">その他（受注/失注/未設定）</span>
            <div className="text-[11px] text-ink/40">{others.length}件・ドラッグで移動可</div>
          </div>
          <div className="flex-1 p-2 space-y-2">
            {others.map((o) => (
              <Card key={o.id} opp={o} saving={savingId === o.id} onDragStart={() => setDragId(o.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ opp, saving, onDragStart }: { opp: OppView; saving: boolean; onDragStart: () => void }) {
  return (
    <div
      draggable={!saving}
      onDragStart={onDragStart}
      className={cn(
        "rounded-lg border border-black/[0.06] bg-white p-2.5 shadow-sm cursor-grab active:cursor-grabbing",
        saving && "opacity-50",
      )}
    >
      <Link href={`/app/opportunities/${opp.id}`} className="block" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium text-xs text-ink truncate hover:text-teal-deep">{opp.account?.name ?? "—"}</div>
        <div className="text-[11px] text-ink/45 truncate">{opp.name}</div>
      </Link>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold tabular-nums">{formatYen(opp.amount)}</span>
        {opp.owner && <Avatar user={opp.owner} size={18} />}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px]">
        {opp.expected_revenue_month && (
          <span className="text-ink/40">{opp.expected_revenue_month.slice(0, 7)}</span>
        )}
        {opp.next_action_date ? (
          <span className={cn("ml-auto", isOverdue(opp.next_action_date) ? "text-rose-500 font-medium" : "text-ink/40")}>
            AC {opp.next_action_date.slice(5, 10)}
          </span>
        ) : (
          <span className="ml-auto pill bg-amber-50 text-accent-orange text-[9px]">AC未</span>
        )}
      </div>
    </div>
  );
}
