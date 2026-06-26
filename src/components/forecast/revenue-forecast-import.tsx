"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { parseDelimited, detectDelim, decodeFileText, uniquifyHeaders } from "@/lib/lead-import";
import { importRevenueForecastAction, type RevForecastInput } from "@/server/actions";

const MAP: { key: keyof RevForecastInput; names: string[] }[] = [
  { key: "seq", names: ["No", "no"] },
  { key: "account", names: ["顧客", "得意先", "会社"] },
  { key: "product", names: ["商品", "製品"] },
  { key: "deal", names: ["案件"] },
  { key: "note", names: ["補足"] },
  { key: "period", names: ["期間"] },
  { key: "amount", names: ["売上予測", "売上"] },
  { key: "cost", names: ["原価予測", "原価"] },
  { key: "prob", names: ["確度"] },
  { key: "orderDate", names: ["受注日"] },
  { key: "owner", names: ["担当"] },
  { key: "memo", names: ["補足 (2)", "メモ"] },
  { key: "enteredOn", names: ["記入日"] },
  { key: "updatedOn", names: ["更新日"] },
];

export function RevenueForecastImport({ defaultFy }: { defaultFy: number }) {
  const [fy, setFy] = useState(defaultFy);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<RevForecastInput[]>([]);
  const [fileName, setFileName] = useState("");

  async function onFile(file: File) {
    const text = decodeFileText(await file.arrayBuffer());
    const all = parseDelimited(text, detectDelim(text));
    if (all.length < 2) return;
    const headers = uniquifyHeaders(all[0].map((h) => h.trim()));
    const idx: Partial<Record<keyof RevForecastInput, number>> = {};
    for (const m of MAP) {
      const h = headers.find((x) => m.names.includes(x));
      if (h) idx[m.key] = headers.indexOf(h);
    }
    const rows: RevForecastInput[] = all.slice(1).map((row) => {
      const o: RevForecastInput = {};
      for (const m of MAP) { const i = idx[m.key]; if (i != null) (o as Record<string, string>)[m.key] = (row[i] ?? "").trim(); }
      return o;
    }).filter((r) => (r.account ?? "").trim() || (r.deal ?? "").trim());
    setFileRows(rows);
    setFileName(file.name);
    setResult(null);
  }

  async function run() {
    setRunning(true); setResult(null);
    try {
      let inserted = 0;
      const CHUNK = 200;
      for (let i = 0; i < fileRows.length; i += CHUNK) {
        const res = await importRevenueForecastAction(fileRows.slice(i, i + CHUNK), { fyStart: fy, replaceAll: i === 0 });
        if (!res.ok) throw new Error(res.error ?? "取込エラー");
        inserted += res.inserted;
      }
      setResult(`✅ ${inserted}件を取り込みました（${fy}年度・全置換）。`);
    } catch (e) {
      setResult("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally { setRunning(false); }
  }

  return (
    <div className="card card-pad space-y-3">
      <h2 className="section-title">受注見込みシートを取込（TSV/CSV・全置換）</h2>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">対象年度:
          <select value={fy} onChange={(e) => setFy(parseInt(e.target.value, 10))} className="input ml-2 w-28 inline-block">
            {[defaultFy + 1, defaultFy, defaultFy - 1].map((y) => <option key={y} value={y}>{y}年度</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 btn-ghost cursor-pointer">
          <Upload size={16} /> ファイルを選ぶ
          <input type="file" accept=".tsv,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {fileName && <span className="text-sm text-ink/60">{fileName}（{fileRows.length}件）</span>}
        {fileRows.length > 0 && (
          <button onClick={run} disabled={running} className="btn-primary">{running ? "取込中…" : `${fileRows.length}件を取り込む`}</button>
        )}
      </div>
      <p className="text-[11px] text-ink/40">列「No/顧客/商品/案件/補足/期間/売上予測/原価予測/確度/受注日/担当/記入日/更新日」を自動認識。期間(例: 7月～8月)は年度内で月割りします。</p>
      {result && <p className={`text-sm ${result.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{result}</p>}
    </div>
  );
}
