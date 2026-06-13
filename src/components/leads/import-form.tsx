"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, ChevronLeft } from "lucide-react";
import { TARGET_FIELDS, LEAD_KINDS, suggestMapping, type RawLeadInput } from "@/lib/lead-import";
import { importLeadsBatchAction, clearLeadsForEventAction, startImportBatchAction } from "@/server/actions";

interface Opt { id: string; name: string; event_date?: string }

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function ImportForm({ campaigns, leadSources }: { campaigns: Opt[]; leadSources: Opt[] }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState(leadSources.find((s) => s.name === "展示会")?.id ?? "");
  const [kind, setKind] = useState("exhibition");
  const [eventLabel, setEventLabel] = useState("");
  const [replace, setReplace] = useState(true);
  const [customFields, setCustomFields] = useState<{ key: string; header: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  // 指定ヘッダーの実データサンプル(先頭の非空値)
  function sampleOf(header: string): string {
    if (!header) return "";
    const idx = headers.indexOf(header);
    if (idx < 0) return "";
    for (const row of dataRows.slice(0, 8)) {
      const v = (row[idx] ?? "").trim();
      if (v) return v.length > 28 ? v.slice(0, 28) + "…" : v;
    }
    return "（空）";
  }

  async function onFile(file: File) {
    const text = await file.text();
    const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
    const delim = (firstLine.split("\t").length > firstLine.split(",").length) ? "\t" : ",";
    const all = parseDelimited(text, delim);
    if (all.length < 2) return;
    const hs = all[0].map((h) => h.trim());
    setHeaders(hs);
    setDataRows(all.slice(1));
    setMapping(suggestMapping(hs));
    setFileName(file.name);
    setResult(null);
  }

  function rowToInput(row: string[]): RawLeadInput {
    const get = (k: string) => {
      const h = mapping[k];
      if (!h) return "";
      const idx = headers.indexOf(h);
      return idx >= 0 && idx < row.length ? row[idx] : "";
    };
    const o: RawLeadInput = {};
    for (const f of TARGET_FIELDS) {
      const v = get(f.key as string);
      if (v) (o as Record<string, string>)[f.key as string] = v;
    }
    const extra: Record<string, string> = {};
    for (const cf of customFields) {
      if (!cf.key || !cf.header) continue;
      const idx = headers.indexOf(cf.header);
      const v = idx >= 0 && idx < row.length ? (row[idx] ?? "").trim() : "";
      if (v) extra[cf.key] = v;
    }
    if (Object.keys(extra).length) o.extra = extra;
    return o;
  }

  const camp = campaigns.find((c) => c.id === campaignId);
  const rawEvent = (camp?.name ?? eventLabel).trim();
  const base = LEAD_KINDS.find((k) => k.key === kind)?.base ?? 20;
  const mappedCompany = mapping["company"];
  const preview = dataRows.slice(0, 5).map(rowToInput);

  async function run() {
    if (!mappedCompany || !rawEvent) return;
    setRunning(true);
    setResult(null);
    setProgress(0);
    try {
      if (replace) await clearLeadsForEventAction(rawEvent);
      const inputs = dataRows.map(rowToInput);
      const { batchId } = await startImportBatchAction({ rawEvent, label: rawEvent, sourceName: fileName, rowCount: inputs.length });
      const opts = { campaignId: campaignId || null, leadSourceId: leadSourceId || null, rawEvent, base, eventDate: camp?.event_date ?? null, importBatchId: batchId };
      let inserted = 0;
      const CHUNK = 300;
      for (let i = 0; i < inputs.length; i += CHUNK) {
        const res = await importLeadsBatchAction(inputs.slice(i, i + CHUNK), opts);
        if (res.error) throw new Error(res.error);
        inserted += res.inserted;
        setProgress(Math.round(((i + CHUNK) / inputs.length) * 100));
      }
      setProgress(100);
      setResult(`✅ ${inserted}件を取り込みました（${rawEvent}）。`);
    } catch (e) {
      setResult("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/app/leads" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink">
        <ChevronLeft size={16} /> リードへ戻る
      </Link>

      {/* 1. ファイル */}
      <div className="card card-pad">
        <h2 className="section-title mb-3">1. ファイルを選択（TSV / CSV）</h2>
        <label className="inline-flex items-center gap-2 btn-ghost cursor-pointer">
          <Upload size={16} />
          ファイルを選ぶ
          <input type="file" accept=".tsv,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {fileName && <span className="ml-3 text-sm text-ink/60">{fileName}（{dataRows.length}行・{headers.length}列）</span>}
      </div>

      {headers.length > 0 && (
        <>
          {/* 2. 取込先 */}
          <div className="card card-pad space-y-3">
            <h2 className="section-title">2. 取込先と区分</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">展示会・施策（任意）</label>
                <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); const c = campaigns.find((x) => x.id === e.target.value); if (c) setEventLabel(c.name); }} className="input">
                  <option value="">—（campaign未選択）</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">イベント名（置換・表示のキー）*</label>
                <input value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} className="input" placeholder="例：AIDX展(3/24)" disabled={!!camp} />
              </div>
              <div>
                <label className="label">施策区分（優先度の基礎点）</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="input">
                  {LEAD_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}（+{k.base}）</option>)}
                </select>
              </div>
              <div>
                <label className="label">流入経路</label>
                <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="input">
                  <option value="">—</option>
                  {leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-teal-primary" />
              同じイベント名の既存リードを置き換える（再取込で重複を防止）
            </label>
          </div>

          {/* 3. 列マッピング */}
          <div className="card card-pad">
            <h2 className="section-title mb-1">3. 列マッピング</h2>
            <p className="text-xs text-ink/40 mb-3">ヘッダー名から自動推測済み。違う場合は選び直してください（会社名は必須）。</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {TARGET_FIELDS.map((f) => {
                const src = mapping[f.key as string] ?? "";
                return (
                  <div key={f.key as string}>
                    <label className="label">{f.label}{f.required && <span className="text-accent-orange"> *</span>}</label>
                    <select value={src} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} className="input text-xs">
                      <option value="">（なし）</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <div className="text-[10px] text-ink/40 mt-0.5 truncate" title={src ? sampleOf(src) : ""}>
                      {src ? `例: ${sampleOf(src)}` : "未設定"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 項目追加(拡張フィールド) */}
            <div className="mt-4 border-t border-black/[0.05] pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">追加項目（不足分を拡張フィールドに保存）</span>
                <button type="button" onClick={() => setCustomFields((c) => [...c, { key: "", header: "" }])} className="text-xs text-teal-deep hover:underline">＋ 項目追加</button>
              </div>
              {customFields.map((cf, i) => (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <input value={cf.key} onChange={(e) => setCustomFields((c) => c.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="項目名(例: 興味製品)" className="input text-xs w-40" />
                  <span className="text-ink/30">←</span>
                  <select value={cf.header} onChange={(e) => setCustomFields((c) => c.map((x, j) => j === i ? { ...x, header: e.target.value } : x))} className="input text-xs flex-1">
                    <option value="">列を選択</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <span className="text-[10px] text-ink/40 w-28 truncate">{cf.header ? `例: ${sampleOf(cf.header)}` : ""}</span>
                  <button type="button" onClick={() => setCustomFields((c) => c.filter((_, j) => j !== i))} className="text-ink/30 hover:text-rose-500 text-xs">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* 4. プレビュー */}
          <div className="card overflow-x-auto">
            <div className="px-5 pt-4 pb-2 border-b border-black/[0.04]"><h2 className="section-title">4. プレビュー（先頭5件）</h2></div>
            <table className="w-full text-xs">
              <thead className="text-ink/40"><tr><th className="th">会社</th><th className="th">氏名</th><th className="th">メール</th><th className="th">役職</th><th className="th">決着(元)</th></tr></thead>
              <tbody className="divide-y divide-black/[0.04]">
                {preview.map((p, i) => (
                  <tr key={i}><td className="td">{p.company || "—"}</td><td className="td">{p.contact_name || `${p.last_name ?? ""} ${p.first_name ?? ""}`.trim() || "—"}</td><td className="td">{p.email || "—"}</td><td className="td">{p.job_title || "—"}</td><td className="td">{p.disposition || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 5. 実行 */}
          <div className="card card-pad">
            <div className="flex items-center gap-3">
              <button onClick={run} disabled={running || !mappedCompany || !rawEvent} className="btn-primary disabled:opacity-40">
                {running ? `取込中… ${progress}%` : `${dataRows.length}件を取り込む`}
              </button>
              {!mappedCompany && <span className="text-xs text-accent-orange">会社名のマッピングが必要です</span>}
              {!rawEvent && <span className="text-xs text-accent-orange">イベント名が必要です</span>}
            </div>
            {running && (
              <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden mt-3">
                <div className="h-full rounded-full bg-teal-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            {result && <p className={`text-sm mt-3 ${result.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{result}</p>}
          </div>
        </>
      )}
    </div>
  );
}
