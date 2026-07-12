"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Link2, Upload } from "lucide-react";
import { decodeFileText, detectDelim, parseDelimited, uniquifyHeaders } from "@/lib/lead-import";
import { dedupCards, findHeaderRowIndex, rowsToCardInputs, type BusinessCardInput } from "@/lib/card-import";
import { importBusinessCardsAction, runCardMatchingAction, type MatchCardsResult } from "@/server/actions/business-cards";

const CHUNK = 300;

type Phase = "select" | "preview" | "uploading" | "done" | "error";

/**
 * Eight CSVの取込フォーム。ヘッダー行を自動検出して列マッピング不要で取り込む。
 * 取込完了後にCRMマッチングを自動実行する。
 */
export function CardImportForm() {
  const [phase, setPhase] = useState<Phase>("select");
  const [fileName, setFileName] = useState("");
  const [cards, setCards] = useState<BusinessCardInput[]>([]);
  const [dupCount, setDupCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [inserted, setInserted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [match, setMatch] = useState<MatchCardsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    try {
      const text = decodeFileText(await f.arrayBuffer());
      const rows = parseDelimited(text, detectDelim(text));
      const hi = findHeaderRowIndex(rows);
      if (hi < 0) {
        setError("ヘッダー行（会社名・氏名 など）が見つかりません。Eightのエクスポート形式のCSVを指定してください。");
        setPhase("error");
        return;
      }
      const headers = uniquifyHeaders(rows[hi].map((h) => h.trim()));
      const parsed = rowsToCardInputs(headers, rows.slice(hi + 1));
      const deduped = dedupCards(parsed);
      setDupCount(parsed.length - deduped.length);
      setCards(deduped);
      setFileName(f.name);
      setPhase("preview");
    } catch (e) {
      setError(`ファイルの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
    }
  };

  const run = async () => {
    setPhase("uploading");
    setProgress(0);
    let ins = 0;
    let skp = 0;
    try {
      for (let i = 0; i < cards.length; i += CHUNK) {
        const r = await importBusinessCardsAction(cards.slice(i, i + CHUNK));
        if (!r.ok) throw new Error(r.error ?? "取込に失敗しました");
        ins += r.inserted;
        skp += r.skipped;
        setProgress(Math.min(cards.length, i + CHUNK));
        setInserted(ins);
        setSkipped(skp);
      }
      // 取込後にCRMマッチングを自動実行
      setMatch(await runCardMatchingAction());
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      {(phase === "select" || phase === "error") && (
        <label className="card card-pad flex flex-col items-center justify-center gap-3 py-14 border-2 border-dashed border-black/10 cursor-pointer hover:border-teal-primary/40">
          <FileSpreadsheet size={32} className="text-ink/30" />
          <div className="text-sm text-ink/60">クリックしてCSVファイルを選択（Eightエクスポート）</div>
          <div className="text-xs text-ink/40">Shift_JIS / UTF-8 どちらも可。ヘッダー前の説明行は自動でスキップします。</div>
          <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</div>}

      {phase === "preview" && (
        <div className="card card-pad space-y-4">
          <div className="text-sm">
            <span className="font-medium">{fileName}</span> — 取込対象 <span className="font-bold text-teal-deep">{cards.length.toLocaleString()}</span> 件
            {dupCount > 0 && <span className="text-ink/50">（ファイル内重複 {dupCount}件を除外済み）</span>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-black/[0.06]">
            <table className="w-full text-xs">
              <thead className="border-b border-black/[0.06] bg-mist-soft/50">
                <tr>
                  <th className="th">会社名</th><th className="th">氏名</th><th className="th">役職</th><th className="th">メール</th><th className="th">交換日</th><th className="th">タグ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {cards.slice(0, 8).map((c, i) => (
                  <tr key={i}>
                    <td className="td">{c.company_name}</td>
                    <td className="td">{c.full_name}</td>
                    <td className="td">{c.title ?? ""}</td>
                    <td className="td">{c.email ?? ""}</td>
                    <td className="td">{c.exchanged_on ?? ""}</td>
                    <td className="td">{(c.tags ?? []).slice(0, 2).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cards.length > 8 && <div className="text-xs text-ink/40">…ほか {(cards.length - 8).toLocaleString()} 件</div>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={run} className="btn-primary">
              <Upload size={15} className="mr-1 inline" />
              {cards.length.toLocaleString()}件を取込む
            </button>
            <button type="button" onClick={() => { setPhase("select"); setCards([]); }} className="btn-ghost">選び直す</button>
            <span className="text-xs text-ink/40">再取込しても同じ名刺は重複登録されません。</span>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="card card-pad space-y-3">
          <div className="text-sm">取込中… {progress.toLocaleString()} / {cards.length.toLocaleString()} 件</div>
          <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden">
            <div className="h-full rounded-full bg-teal-primary transition-all" style={{ width: `${cards.length ? Math.round((progress / cards.length) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card card-pad space-y-3">
          <div className="text-sm font-medium text-teal-deep">取込が完了しました</div>
          <ul className="text-sm text-ink/70 space-y-1">
            <li>新規登録: <span className="font-bold">{inserted.toLocaleString()}</span> 件（既存スキップ {skipped.toLocaleString()} 件）</li>
            {match?.ok && (
              <li className="flex items-center gap-1.5">
                <Link2 size={14} className="text-ink/40" />
                CRM自動マッチング: メール一致 {match.email} / 会社+氏名 {match.companyContact} / 会社名 {match.company}
              </li>
            )}
            {match && !match.ok && <li className="text-rose-600">{match.error}</li>}
          </ul>
          <Link href="/app/business-cards" className="btn-primary inline-block">名刺一覧を見る</Link>
        </div>
      )}
    </div>
  );
}
