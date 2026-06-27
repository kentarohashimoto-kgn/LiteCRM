"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { parseDelimited, detectDelim, decodeFileText, uniquifyHeaders } from "@/lib/lead-import";
import { importDealCostsAction } from "@/server/actions";

/** 展示会/施策別の原価CSV/TSV取込。列「詳細(または展示会/施策)」「原価(または費用)」を認識。 */
export function DealCostImport() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    setRunning(true); setResult(null);
    try {
      const text = decodeFileText(await file.arrayBuffer());
      const all = parseDelimited(text, detectDelim(text));
      if (all.length < 2) { setResult("行がありません"); return; }
      const headers = uniquifyHeaders(all[0].map((h) => h.trim()));
      const di = headers.findIndex((h) => ["詳細", "展示会", "施策", "detail"].some((k) => h.includes(k)));
      const ci = headers.findIndex((h) => ["原価", "費用", "コスト", "cost"].some((k) => h.includes(k)));
      if (di < 0 || ci < 0) { setResult("「詳細」「原価」列が見つかりません"); return; }
      const rows = all.slice(1).map((r) => ({ detail: (r[di] ?? "").trim(), cost: (r[ci] ?? "").trim() })).filter((r) => r.detail);
      const res = await importDealCostsAction(rows);
      if (!res.ok) throw new Error(res.error ?? "取込エラー");
      setResult(`✅ 原価 ${res.upserted}件を反映しました。`);
    } catch (e) {
      setResult("エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally { setRunning(false); }
  }

  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex items-center gap-2 btn-ghost cursor-pointer text-sm">
        <Upload size={15} /> 原価CSVを取込
        <input type="file" accept=".csv,.tsv,.txt" className="hidden" disabled={running} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {result && <span className={`text-xs ${result.startsWith("エラー") ? "text-rose-600" : "text-emerald-700"}`}>{result}</span>}
    </div>
  );
}
