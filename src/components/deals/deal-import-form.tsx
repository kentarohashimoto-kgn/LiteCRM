"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, ChevronLeft, AlertTriangle } from "lucide-react";
import {
  DEAL_FIELDS, suggestDealMapping, rowToDealRow, parseDelimited, detectDelim, decodeFileText, uniquifyHeaders,
} from "@/lib/deal-import";
import { importNotionDealsAction } from "@/server/actions";

export function DealImportForm() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function onFile(file: File) {
    const text = decodeFileText(await file.arrayBuffer());
    const all = parseDelimited(text, detectDelim(text));
    if (all.length < 2) return;
    const hs = uniquifyHeaders(all[0].map((h) => h.trim()));
    setHeaders(hs);
    setDataRows(all.slice(1));
    setMapping(suggestDealMapping(hs));
    setFileName(file.name);
    setResult(null);
  }

  function sampleOf(header: string): string {
    const idx = headers.indexOf(header);
    if (idx < 0) return "";
    for (const row of dataRows.slice(0, 10)) { const v = (row[idx] ?? "").trim(); if (v) return v.length > 24 ? v.slice(0, 24) + "…" : v; }
    return "（空）";
  }

  const mappedCompany = mapping["company"];

  async function run() {
    if (!mappedCompany) return;
    setRunning(true);
    setResult(null);
    try {
      const rows = dataRows
        .map((row) => rowToDealRow(headers, row, mapping, crypto.randomUUID()))
        .filter((r) => (r.company ?? "").trim());
      // 大量行はチャンク送信(サーバー側は全置換→以降は追記)
      let inserted = 0, meetings = 0, accounts = 0;
      const CHUNK = 250;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await importNotionDealsAction(rows.slice(i, i + CHUNK), { replaceAll: i === 0 });
        if (!res.ok) throw new Error(res.error ?? "取込エラー");
        inserted += res.inserted; meetings += res.meetings; accounts += res.accounts;
      }
      setResult(`✅ 案件${inserted}件・商談ログ${meetings}件・新規顧客${accounts}件を取り込みました（全置換）。`);
    } catch (e) {
      setResult("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/app/opportunities" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink">
        <ChevronLeft size={16} /> 案件へ戻る
      </Link>

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex gap-2">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <div>
          <b>全置換インポート</b>：実行すると<strong>既存の案件はすべてNotionの内容で置き換わります</strong>（請求・タスク・活動は案件ひも付けを外して保全。バックアップ済み）。
          Notion「商談ヨミ表」を <b>… → エクスポート → Markdown &amp; CSV（CSV）</b> で書き出してアップロードしてください。何度でも再同期できます。
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">1. CSVを選択</h2>
        <label className="inline-flex items-center gap-2 btn-ghost cursor-pointer">
          <Upload size={16} /> ファイルを選ぶ
          <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {fileName && <span className="ml-3 text-sm text-ink/60">{fileName}（{dataRows.length}行）</span>}
      </div>

      {headers.length > 0 && (
        <>
          <div className="card card-pad">
            <h2 className="section-title mb-1">2. 列マッピング</h2>
            <p className="text-xs text-ink/40 mb-3">Notionの列名から自動推定。違う場合は選び直してください（得意先=必須）。</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {DEAL_FIELDS.map((f) => {
                const src = mapping[f.key] ?? "";
                return (
                  <div key={f.key}>
                    <label className="label">{f.label}{f.required && <span className="text-accent-orange"> *</span>}</label>
                    <select value={src} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} className="input text-xs">
                      <option value="">（なし）</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <div className="text-[10px] text-ink/40 mt-0.5 truncate">{src ? `例: ${sampleOf(src)}` : "未設定"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card card-pad">
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="accent-teal-primary" />
              既存案件を全置換することを理解しました
            </label>
            <button onClick={run} disabled={running || !mappedCompany || !confirm} className="btn-primary disabled:opacity-40">
              {running ? "取込中…" : `${dataRows.length}件を全置換で取り込む`}
            </button>
            {!mappedCompany && <span className="ml-3 text-xs text-accent-orange">得意先のマッピングが必要です</span>}
            {result && <p className={`text-sm mt-3 ${result.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{result}</p>}
          </div>
        </>
      )}
    </div>
  );
}
