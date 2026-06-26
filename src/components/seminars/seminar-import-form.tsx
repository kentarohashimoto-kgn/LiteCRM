"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, ChevronLeft } from "lucide-react";
import { parseDelimited, detectDelim, decodeFileText, uniquifyHeaders } from "@/lib/lead-import";
import { SEMINAR_TARGET_FIELDS, suggestSeminarMapping, rowToSeminarInput, dedupSeminar } from "@/lib/seminar-import";
import { importSeminarBatchAction, clearSeminarAction, recomputeEngagementAction } from "@/server/actions";

interface Opt { id: string; name: string; event_date?: string }

export function SeminarImportForm({ campaigns, leadSources }: { campaigns: Opt[]; leadSources: Opt[] }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState(leadSources.find((s) => s.name === "セミナー")?.id ?? "");
  const [seminarName, setSeminarName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  function sampleOf(header: string): string {
    if (!header) return "";
    const idx = headers.indexOf(header);
    if (idx < 0) return "";
    for (const row of dataRows.slice(0, 8)) { const v = (row[idx] ?? "").trim(); if (v) return v.length > 28 ? v.slice(0, 28) + "…" : v; }
    return "（空）";
  }

  async function onFile(file: File) {
    const text = decodeFileText(await file.arrayBuffer());
    const all = parseDelimited(text, detectDelim(text));
    if (all.length < 2) return;
    const hs = uniquifyHeaders(all[0].map((h) => h.trim()));
    setHeaders(hs);
    setDataRows(all.slice(1));
    setMapping(suggestSeminarMapping(hs));
    setFileName(file.name);
    setResult(null);
  }

  const camp = campaigns.find((c) => c.id === campaignId);
  const name = (seminarName || camp?.name || "").trim();
  const mappedCompany = mapping["company"];
  const inputs = dataRows.map((row) => rowToSeminarInput(headers, row, mapping));
  const preview = inputs.slice(0, 5);

  async function run() {
    if (!mappedCompany || !name) return;
    setRunning(true); setResult(null); setProgress(0);
    try {
      if (mode === "replace") await clearSeminarAction(name);
      const deduped = dedupSeminar(inputs);
      const opts = { campaignId: campaignId || null, leadSourceId: leadSourceId || null, seminarName: name, eventDate: (eventDate || camp?.event_date) ?? null };
      let inserted = 0, newLeads = 0;
      const CHUNK = 300;
      for (let i = 0; i < deduped.length; i += CHUNK) {
        const res = await importSeminarBatchAction(deduped.slice(i, i + CHUNK), opts);
        if (res.error) throw new Error(res.error);
        inserted += res.inserted; newLeads += res.newLeads;
        setProgress(Math.round(((i + CHUNK) / deduped.length) * 100));
      }
      await recomputeEngagementAction();
      setProgress(100);
      setResult(`✅ ${inserted}件の回答を取込（新規リード化 ${newLeads}件・既存はナーチャリング接点を追加）。エンゲージメントを更新しました。`);
    } catch (e) {
      setResult("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/app/analytics/seminars" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink"><ChevronLeft size={16} /> セミナー分析へ戻る</Link>

      <div className="card card-pad">
        <h2 className="section-title mb-3">1. ファイルを選択（CSV / TSV）</h2>
        <label className="inline-flex items-center gap-2 btn-ghost cursor-pointer">
          <Upload size={16} /> ファイルを選ぶ
          <input type="file" accept=".tsv,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {fileName && <span className="ml-3 text-sm text-ink/60">{fileName}（{dataRows.length}行・{headers.length}列）</span>}
      </div>

      {headers.length > 0 && (
        <>
          <div className="card card-pad space-y-3">
            <h2 className="section-title">2. セミナー情報</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">セミナー（施策・任意）</label>
                <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); const c = campaigns.find((x) => x.id === e.target.value); if (c) { setSeminarName(c.name); if (c.event_date) setEventDate(c.event_date.slice(0, 10)); } }} className="input">
                  <option value="">—（未選択）</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">セミナー名（置換・表示のキー）*</label>
                <input value={seminarName} onChange={(e) => setSeminarName(e.target.value)} className="input" placeholder="例：ODEX共催セミナー(5/13)" disabled={!!camp} />
              </div>
              <div>
                <label className="label">開催日</label>
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">流入経路</label>
                <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="input">
                  <option value="">—</option>
                  {leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">取込モード</label>
              <div className="flex flex-col gap-1.5 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-teal-primary" /><span><b>置換</b>：同じセミナー名の既存回答を入れ直す</span></label>
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} className="accent-teal-primary" /><span><b>追加</b>：既存はそのまま追加投入</span></label>
              </div>
            </div>
            <p className="text-[11px] text-ink/45">メール一致の参加者は<b>既存リードに接点を追加</b>（ナーチャリング）、未登録は<b>新規リード化</b>（流入元=セミナー）。アンケート回答者はエンゲージメントが加点されます。</p>
          </div>

          <div className="card card-pad">
            <h2 className="section-title mb-1">3. 列マッピング</h2>
            <p className="text-xs text-ink/40 mb-3">ヘッダー名から自動推測済み。違う場合は選び直してください（会社名は必須）。</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SEMINAR_TARGET_FIELDS.map((f) => {
                const src = mapping[f.key as string] ?? "";
                return (
                  <div key={f.key as string}>
                    <label className="label">{f.label}{f.required && <span className="text-accent-orange"> *</span>}</label>
                    <select value={src} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} className="input text-xs">
                      <option value="">（なし）</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <div className="text-[10px] text-ink/40 mt-0.5 truncate" title={src ? sampleOf(src) : ""}>{src ? `例: ${sampleOf(src)}` : "未設定"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="px-5 pt-4 pb-2 border-b border-black/[0.04]"><h2 className="section-title">4. プレビュー（先頭5件）</h2></div>
            <table className="w-full text-xs">
              <thead className="text-ink/40"><tr><th className="th">会社</th><th className="th">氏名</th><th className="th">メール</th><th className="th">満足度</th><th className="th">希望フォロー</th></tr></thead>
              <tbody className="divide-y divide-black/[0.04]">
                {preview.map((p, i) => <tr key={i}><td className="td">{p.company || "—"}</td><td className="td">{p.contact_name || "—"}</td><td className="td">{p.email || "—"}</td><td className="td">{p.satisfaction || "—"}</td><td className="td">{p.follow_up || "—"}</td></tr>)}
              </tbody>
            </table>
          </div>

          <div className="card card-pad">
            <div className="flex items-center gap-3">
              <button onClick={run} disabled={running || !mappedCompany || !name} className="btn-primary disabled:opacity-40">{running ? `取込中… ${progress}%` : `${dataRows.length}件を取り込む`}</button>
              {!mappedCompany && <span className="text-xs text-accent-orange">会社名のマッピングが必要です</span>}
              {!name && <span className="text-xs text-accent-orange">セミナー名が必要です</span>}
            </div>
            {running && <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden mt-3"><div className="h-full rounded-full bg-teal-primary transition-all" style={{ width: `${progress}%` }} /></div>}
            {result && <p className={`text-sm mt-3 ${result.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{result}</p>}
          </div>
        </>
      )}
    </div>
  );
}
