"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveLeadSourceAction, deleteLeadSourceAction, saveCampaignAction, deleteCampaignAction } from "@/server/actions/masters";
import { cn } from "@/lib/utils";

export interface NameRow { id: string; name: string; sub: string | null; }
type Kind = "lead_source" | "campaign";

async function save(kind: Kind, id: string | null, name: string, sub: string | null) {
  return kind === "lead_source"
    ? saveLeadSourceAction({ id, name, description: sub, status: "active" })
    : saveCampaignAction({ id, name, channel: sub, notes: null });
}
async function remove(kind: Kind, id: string) {
  return kind === "lead_source" ? deleteLeadSourceAction({ id }) : deleteCampaignAction({ id });
}

export function NameMaster({ kind, rows, subLabel }: { kind: Kind; rows: NameRow[]; subLabel: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      {rows.map((r) => <Row key={r.id} kind={kind} r={r} subLabel={subLabel} onDone={() => router.refresh()} />)}
      {adding ? (
        <Row kind={kind} r={{ id: "", name: "", sub: null }} subLabel={subLabel} isNew onDone={() => { setAdding(false); router.refresh(); }} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-teal-deep hover:underline"><Plus size={15} /> 追加</button>
      )}
    </div>
  );
}

function Row({ kind, r, subLabel, isNew = false, onDone }: { kind: Kind; r: NameRow; subLabel: string; isNew?: boolean; onDone: () => void }) {
  const [name, setName] = useState(r.name);
  const [sub, setSub] = useState(r.sub ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doSave() {
    setBusy(true); setErr(null);
    const res = await save(kind, isNew ? null : r.id, name, sub || null);
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error ?? "失敗");
  }
  async function doDel() {
    if (!confirm(`${r.name} を削除しますか？`)) return;
    setBusy(true);
    const res = await remove(kind, r.id);
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error ?? "失敗");
  }

  return (
    <div className={cn("rounded-lg border p-2 flex flex-wrap items-end gap-2", isNew ? "border-teal-primary/40 bg-teal-light/20" : "border-black/[0.06]")}>
      <div className="flex-1 min-w-[160px]"><label className="block text-[10px] text-ink/45 mb-0.5">名称</label><input value={name} onChange={(e) => setName(e.target.value)} className="input py-1 text-sm" /></div>
      <div className="flex-1 min-w-[140px]"><label className="block text-[10px] text-ink/45 mb-0.5">{subLabel}</label><input value={sub} onChange={(e) => setSub(e.target.value)} className="input py-1 text-sm" /></div>
      <button type="button" disabled={busy} onClick={doSave} className="btn-accent text-xs py-1">{isNew ? "追加" : "保存"}</button>
      {!isNew && <button type="button" disabled={busy} onClick={doDel} className="text-ink/30 hover:text-rose-500 pb-1" title="削除"><Trash2 size={15} /></button>}
      {err && <span className="text-[11px] text-rose-500 w-full">{err}</span>}
    </div>
  );
}
