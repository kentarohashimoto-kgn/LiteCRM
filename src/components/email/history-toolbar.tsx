"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Filter, Plus, X, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import {
  MAIL_EXPORT_FIELDS, MAIL_EXPORT_FIELD_MAP, MAIL_EXPORT_DEFAULT_COLUMNS, mailRangePresets,
} from "@/lib/mail-export";
import { exportEmailHistoryCsvAction, type MailHistoryFilters } from "@/server/actions/mail-export";

/**
 * 送信履歴の絞り込み + CSV一括ダウンロード。
 * 画面に表示している条件と、ダウンロードする条件を同じにする(表示=出力)。
 * 期間はJSTの日付で指定し、終了日はその日を含む。
 */

interface SenderOpt { id: string; name: string }

const STATUS_OPTS = [
  { id: "sent", name: "送信済み" },
  { id: "failed", name: "失敗" },
  { id: "queued", name: "送信中" },
];
const REACTION_OPTS = [
  { id: "opened", name: "開封あり" },
  { id: "clicked", name: "クリックあり" },
];

export function HistoryToolbar({
  filters, senders, total,
}: { filters: MailHistoryFilters; senders: SenderOpt[]; total: number }) {
  const router = useRouter();
  const [f, setF] = useState<MailHistoryFilters>(filters);
  const [columns, setColumns] = useState<string[]>(MAIL_EXPORT_DEFAULT_COLUMNS);
  const [openCols, setOpenCols] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const presets = mailRangePresets(Date.now());
  const available = MAIL_EXPORT_FIELDS.filter((x) => !columns.includes(x.key));

  const set = (patch: Partial<MailHistoryFilters>) => setF({ ...f, ...patch });

  /** 絞り込みをURLに反映(一覧の表示もこの条件になる)。 */
  function apply(next: MailHistoryFilters = f) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, String(v));
    router.push(`/app/email/history${p.toString() ? `?${p}` : ""}`);
  }

  function applyPreset(key: string) {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    const next = { ...f, from: p.from, to: p.to };
    setF(next);
    apply(next);
  }

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };

  async function download() {
    if (busy || !columns.length) return;
    setBusy(true); setMsg(null);
    try {
      const res = await exportEmailHistoryCsvAction(f, columns);
      if (res.error) { setMsg("エラー: " + res.error); return; }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const span = f.from || f.to ? `_${f.from || "開始"}_${f.to || "本日"}` : "";
      a.href = url;
      a.download = `メール送信履歴${span}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg(`✅ ${res.count}件をダウンロードしました（${columns.length}項目）`);
    } catch (e) {
      setMsg("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad space-y-3 mb-4">
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-ink/50" />
        <h3 className="text-sm font-semibold text-ink">期間で絞り込み・ダウンロード</h3>
        <span className="text-xs text-ink/45 ml-auto tabular-nums">該当 {total.toLocaleString()} 件</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={`rounded-lg px-2.5 py-1 text-xs ${f.from === p.from && f.to === p.to ? "bg-teal-light text-teal-deep font-medium" : "bg-mist-soft text-ink/60 hover:bg-teal-light hover:text-teal-deep"}`}
          >
            {p.label}
          </button>
        ))}
        <button onClick={() => { const n = { ...f, from: "", to: "" }; setF(n); apply(n); }} className="rounded-lg bg-mist-soft px-2.5 py-1 text-xs text-ink/60 hover:bg-mist-soft/70">
          全期間
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Field label="開始日（この日を含む）">
          <input type="date" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value })} className="input text-sm" />
        </Field>
        <Field label="終了日（この日を含む）">
          <input type="date" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value })} className="input text-sm" />
        </Field>
        <Field label="結果">
          <Sel value={f.status ?? ""} onChange={(v) => set({ status: v })} opts={STATUS_OPTS} />
        </Field>
        <Field label="送信者">
          <Sel value={f.sender ?? ""} onChange={(v) => set({ sender: v })} opts={senders} />
        </Field>
        <Field label="反応">
          <Sel value={f.reaction ?? ""} onChange={(v) => set({ reaction: v })} opts={REACTION_OPTS} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => apply()} className="btn-ghost text-sm">この条件で表示</button>
        <button onClick={download} disabled={busy || !columns.length} className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {busy ? "出力中…" : "CSVをダウンロード"}
        </button>
        <button onClick={() => setOpenCols(!openCols)} className="text-xs text-ink/50 underline">
          出力する項目（{columns.length}）を{openCols ? "閉じる" : "変更"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{msg}</span>}
      </div>

      {openCols && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-black/[0.06] pt-3">
          <div>
            <div className="text-xs text-ink/50 mb-1.5">選択中（上から順に出力）</div>
            <ol className="space-y-1">
              {columns.map((c, i) => (
                <li key={c} className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-2 py-1 text-sm">
                  <span className="w-5 text-ink/40 tabular-nums text-xs">{i + 1}</span>
                  <span className="flex-1">{MAIL_EXPORT_FIELD_MAP[c]?.label ?? c}</span>
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
              {available.map((x) => (
                <button key={x.key} onClick={() => setColumns([...columns, x.key])} className="inline-flex items-center gap-1 rounded-lg bg-mist-soft px-2 py-1 text-xs text-ink/70 hover:bg-teal-light hover:text-teal-deep">
                  <Plus size={12} /> {x.label}
                </button>
              ))}
              {available.length === 0 && <span className="text-xs text-ink/40">全項目を選択中</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11px] text-ink/50 mb-0.5">{label}</label>{children}</div>;
}
function Sel({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { id: string; name: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input text-sm">
      <option value="">すべて</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
