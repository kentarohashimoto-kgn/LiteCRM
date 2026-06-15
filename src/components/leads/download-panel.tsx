"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, X, ArrowUp, ArrowDown, Save, Trash2 } from "lucide-react";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { EXPORT_FIELDS, EXPORT_FIELD_MAP, DEFAULT_EXPORT_PRESETS } from "@/lib/lead-export";
import { exportLeadsCsvAction, saveExportPresetAction, deleteExportPresetAction } from "@/server/actions";

interface PresetRow { id: string; name: string; columns: string[] }
const RANKS = ["S", "A", "B", "C", "D"];

export function DownloadPanel({ events, presets }: { events: string[]; presets: PresetRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [event, setEvent] = useState("");
  const [disposition, setDisposition] = useState("");
  const [rank, setRank] = useState("");
  const [engRank, setEngRank] = useState("");
  const [converted, setConverted] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_EXPORT_PRESETS[0].columns);
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const available = EXPORT_FIELDS.filter((f) => !columns.includes(f.key));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };

  function loadPreset(value: string) {
    if (!value) return;
    const def = DEFAULT_EXPORT_PRESETS.find((p) => "d:" + p.name === value);
    const saved = presets.find((p) => p.id === value);
    const p = def ?? saved;
    if (p) { setColumns(p.columns.filter((c) => EXPORT_FIELD_MAP[c])); setPresetName(saved?.name ?? ""); }
  }

  async function download() {
    if (busy || !columns.length) return;
    setBusy(true); setMsg(null);
    try {
      const res = await exportLeadsCsvAction({ q, event, disposition, rank, engRank, converted }, columns);
      if (res.error) { setMsg("エラー: " + res.error); return; }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(presetName || "leads").replace(/[\\/:*?"<>|]/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg(`✅ ${res.count}件をダウンロードしました（${columns.length}項目）`);
    } catch (e) {
      setMsg("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function savePreset() {
    if (!presetName.trim() || !columns.length) return;
    setBusy(true);
    await saveExportPresetAction(presetName.trim(), columns);
    setBusy(false);
    router.refresh();
    setMsg(`💾 「${presetName.trim()}」を保存しました`);
  }
  async function removePreset(id: string) {
    if (!confirm("このプリセットを削除しますか？")) return;
    await deleteExportPresetAction(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/60 px-1">絞り込み→ダウンロードする項目と順序を指定→CSV出力。<b>形式は名前を付けて保存</b>でき（例：UTAGE用・公式LINE用・メルマガ用）、次回呼び出せます。</p>

      {/* 1. 絞り込み */}
      <div className="card card-pad space-y-3">
        <h3 className="text-sm font-semibold">1. 絞り込み</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="会社・担当者で検索"><input value={q} onChange={(e) => setQ(e.target.value)} className="input" placeholder="部分一致" /></Field>
          <Field label="流入イベント"><Sel value={event} onChange={setEvent} opts={events.map((e) => ({ id: e, name: e }))} /></Field>
          <Field label="決着"><Sel value={disposition} onChange={setDisposition} opts={LEAD_DISPOSITIONS.map((d) => ({ id: d.key, name: d.label }))} /></Field>
          <Field label="ランク"><Sel value={rank} onChange={setRank} opts={RANKS.map((r) => ({ id: r, name: r }))} /></Field>
          <Field label="エンゲージランク"><Sel value={engRank} onChange={setEngRank} opts={RANKS.map((r) => ({ id: r, name: r }))} /></Field>
          <Field label="案件化"><Sel value={converted} onChange={setConverted} opts={[{ id: "yes", name: "案件化済み" }, { id: "no", name: "未案件化" }]} /></Field>
        </div>
      </div>

      {/* 2. 形式(列・順序) */}
      <div className="card card-pad space-y-3">
        <h3 className="text-sm font-semibold">2. ダウンロードする項目と順序</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-ink/50 mb-1.5">選択中（上から順に出力）</div>
            <ol className="space-y-1">
              {columns.map((c, i) => (
                <li key={c} className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-2 py-1 text-sm">
                  <span className="w-5 text-ink/40 tabular-nums text-xs">{i + 1}</span>
                  <span className="flex-1">{EXPORT_FIELD_MAP[c]?.label ?? c}</span>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-ink/30 hover:text-ink disabled:opacity-20"><ArrowUp size={14} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === columns.length - 1} className="text-ink/30 hover:text-ink disabled:opacity-20"><ArrowDown size={14} /></button>
                  <button onClick={() => setColumns(columns.filter((x) => x !== c))} className="text-ink/30 hover:text-rose-500"><X size={14} /></button>
                </li>
              ))}
              {columns.length === 0 && <li className="text-xs text-ink/40 py-2">項目を追加してください</li>}
            </ol>
          </div>
          <div>
            <div className="text-xs text-ink/50 mb-1.5">追加できる項目</div>
            <div className="flex flex-wrap gap-1.5">
              {available.map((f) => (
                <button key={f.key} onClick={() => setColumns([...columns, f.key])} className="inline-flex items-center gap-1 rounded-lg bg-mist-soft px-2 py-1 text-xs text-ink/70 hover:bg-teal-light hover:text-teal-deep">
                  <Plus size={12} /> {f.label}
                </button>
              ))}
              {available.length === 0 && <span className="text-xs text-ink/40">全項目を選択中</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 3. プリセット */}
      <div className="card card-pad space-y-3">
        <h3 className="text-sm font-semibold">3. 形式プリセット（名前を付けて保存）</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select onChange={(e) => loadPreset(e.target.value)} defaultValue="" className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
            <option value="">プリセットを呼び出す…</option>
            {presets.length > 0 && <optgroup label="保存済み">{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
            <optgroup label="既定">{DEFAULT_EXPORT_PRESETS.map((p) => <option key={p.name} value={"d:" + p.name}>{p.name}</option>)}</optgroup>
          </select>
          <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="保存名（例：UTAGE用）" className="input max-w-[200px]" />
          <button onClick={savePreset} disabled={busy || !presetName.trim() || !columns.length} className="btn-ghost text-sm disabled:opacity-40"><Save size={15} /> 保存</button>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-lg bg-mist-soft/70 px-2 py-1 text-xs text-ink/60">
                {p.name}
                <button onClick={() => removePreset(p.id)} className="text-ink/30 hover:text-rose-500"><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 4. 実行 */}
      <div className="card card-pad flex items-center gap-3">
        <button onClick={download} disabled={busy || !columns.length} className="btn-primary disabled:opacity-40"><Download size={16} /> {busy ? "出力中…" : "CSVをダウンロード"}</button>
        {msg && <span className={`text-sm ${msg.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
function Sel({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { id: string; name: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">すべて</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
