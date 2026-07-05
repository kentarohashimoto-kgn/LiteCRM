"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveProductAction, deleteProductAction } from "@/server/actions/masters";
import { cn } from "@/lib/utils";

export interface ProductRow {
  id: string; name: string; category: string | null; product_type: string | null;
  default_price: number | null; unit_cost: number | null; priority_flag: boolean; status: string;
}

export function ProductMaster({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      {products.map((p) => <Row key={p.id} p={p} onDone={() => router.refresh()} />)}
      {adding ? (
        <Row p={{ id: "", name: "", category: null, product_type: null, default_price: null, unit_cost: null, priority_flag: false, status: "active" }} isNew onDone={() => { setAdding(false); router.refresh(); }} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-teal-deep hover:underline"><Plus size={15} /> 商材を追加</button>
      )}
    </div>
  );
}

function Row({ p, isNew = false, onDone }: { p: ProductRow; isNew?: boolean; onDone: () => void }) {
  const [name, setName] = useState(p.name);
  const [category, setCategory] = useState(p.category ?? "");
  const [ptype, setPtype] = useState(p.product_type ?? "");
  const [price, setPrice] = useState(p.default_price?.toString() ?? "");
  const [cost, setCost] = useState(p.unit_cost?.toString() ?? "");
  const [prio, setPrio] = useState(p.priority_flag);
  const [status, setStatus] = useState(p.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    const r = await saveProductAction({
      id: isNew ? null : p.id, name, category: category || null, product_type: ptype || null,
      default_price: price ? Number(price) : null, unit_cost: cost ? Number(cost) : null, priority_flag: prio, status,
    });
    setBusy(false);
    if (r.ok) onDone(); else setErr(r.error ?? "失敗");
  }
  async function del() {
    if (!confirm(`${p.name} を削除しますか？`)) return;
    setBusy(true);
    const r = await deleteProductAction({ id: p.id });
    setBusy(false);
    if (r.ok) onDone(); else setErr(r.error ?? "失敗");
  }

  return (
    <div className={cn("rounded-lg border p-2 flex flex-wrap items-end gap-2", isNew ? "border-teal-primary/40 bg-teal-light/20" : "border-black/[0.06]")}>
      <Field label="名称" w="flex-1 min-w-[140px]"><input value={name} onChange={(e) => setName(e.target.value)} className="input py-1 text-sm" /></Field>
      <Field label="分類"><input value={category} onChange={(e) => setCategory(e.target.value)} className="input py-1 text-sm w-24" /></Field>
      <Field label="種別"><input value={ptype} onChange={(e) => setPtype(e.target.value)} placeholder="研修/開発/顧問" className="input py-1 text-sm w-24" /></Field>
      <Field label="標準価格"><input value={price} onChange={(e) => setPrice(e.target.value)} type="number" className="input py-1 text-sm w-24 text-right" /></Field>
      <Field label="原価"><input value={cost} onChange={(e) => setCost(e.target.value)} type="number" className="input py-1 text-sm w-24 text-right" /></Field>
      <label className="flex items-center gap-1 text-xs text-ink/60 pb-1"><input type="checkbox" checked={prio} onChange={(e) => setPrio(e.target.checked)} className="accent-teal-primary" />優先</label>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm">
        <option value="active">有効</option>
        <option value="archived">無効</option>
      </select>
      <button type="button" disabled={busy} onClick={save} className="btn-accent text-xs py-1">{isNew ? "追加" : "保存"}</button>
      {!isNew && <button type="button" disabled={busy} onClick={del} className="text-ink/30 hover:text-rose-500 pb-1" title="削除"><Trash2 size={15} /></button>}
      {err && <span className="text-[11px] text-rose-500 w-full">{err}</span>}
    </div>
  );
}

function Field({ label, children, w = "" }: { label: string; children: React.ReactNode; w?: string }) {
  return <div className={w}><label className="block text-[10px] text-ink/45 mb-0.5">{label}</label>{children}</div>;
}
