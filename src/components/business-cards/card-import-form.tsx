"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Link2, Upload, UserCheck, UserPlus } from "lucide-react";
import { decodeFileText, detectDelim, parseDelimited, uniquifyHeaders } from "@/lib/lead-import";
import { dedupCards, findHeaderRowIndex, rowsToCardInputs, type BusinessCardInput } from "@/lib/card-import";
import { importBusinessCardsAction, runCardMatchingAction, convertCardsToLeadsAction, logCardImportAudit, type MatchCardsResult, type ConvertCardsResult } from "@/server/actions/business-cards";

const CHUNK = 300;

type Phase = "select" | "preview" | "uploading" | "done" | "error";

/**
 * Eight CSVの取込フォーム。ヘッダー行を自動検出して列マッピング不要で取り込む。
 * 取込完了後にCRMマッチングを自動実行する。
 */
export function CardImportForm({ members, currentUserId }: { members: { id: string; name: string }[]; currentUserId: string }) {
  const [phase, setPhase] = useState<Phase>("select");
  const [exchangerId, setExchangerId] = useState(currentUserId);
  const [fileName, setFileName] = useState("");
  const [cards, setCards] = useState<BusinessCardInput[]>([]);
  const [dupCount, setDupCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [inserted, setInserted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [match, setMatch] = useState<MatchCardsResult | null>(null);
  // 取込した名刺をそのままリードとして扱う(既定ON)。OFFにすると名刺のみ登録され、
  // リード一覧・一括メール・スコアリングの対象にならない
  const [toLeads, setToLeads] = useState(true);
  const [converted, setConverted] = useState<ConvertCardsResult | null>(null);
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
    const newIds: string[] = [];
    try {
      for (let i = 0; i < cards.length; i += CHUNK) {
        const r = await importBusinessCardsAction(cards.slice(i, i + CHUNK), exchangerId);
        if (!r.ok) throw new Error(r.error ?? "取込に失敗しました");
        ins += r.inserted;
        skp += r.skipped;
        newIds.push(...(r.insertedIds ?? []));
        setProgress(Math.min(cards.length, i + CHUNK));
        setInserted(ins);
        setSkipped(skp);
      }
      // 取込全体を1件だけ監査記録（チャンクごとには残さない）
      await logCardImportAudit({ inserted: ins, skipped: skp, total: cards.length });
      // 取込後にCRMマッチングを自動実行
      setMatch(await runCardMatchingAction());
      // 取込した名刺をリード化(既定ON)。今回登録分のみを対象にする
      if (toLeads && newIds.length > 0) setConverted(await convertCardsToLeadsAction({ cardIds: newIds }));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const exchangerName = members.find((m) => m.id === exchangerId)?.name ?? "取込者";

  return (
    <div className="max-w-3xl space-y-4">
      {/* 名刺交換者の選択（この取込で登録する全名刺に適用） */}
      {(phase === "select" || phase === "preview" || phase === "error") && (
        <div className="card card-pad flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink/70">
            <UserCheck size={15} className="text-teal-primary" /> 名刺交換者
          </span>
          <select
            value={exchangerId}
            onChange={(e) => setExchangerId(e.target.value)}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm min-w-[200px]"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === currentUserId ? "（自分）" : ""}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink/45">この取込で登録する名刺の交換者として記録されます。</span>
          <label className="w-full flex items-start gap-2 pt-2 mt-1 border-t border-black/[0.06] cursor-pointer">
            <input type="checkbox" checked={toLeads} onChange={(e) => setToLeads(e.target.checked)} className="accent-teal-primary mt-0.5" />
            <span className="text-sm text-ink/70">
              <b>取込後にリード化する</b>（推奨）
              <span className="block text-xs text-ink/45">
                リードにすると<b>リード一覧に表示され</b>、スコアリング・一括メール・架電キューの対象になります。
                同じメールのリードが既にある場合は新規作成せず紐付けます。OFFにすると名刺としてのみ登録されます。
              </span>
            </span>
          </label>
        </div>
      )}

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
            <span className="block text-xs text-ink/50 mt-0.5">名刺交換者: <span className="font-medium text-ink/70">{exchangerName}</span></span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-black/[0.06]">
            <table className="text-xs" style={{ minWidth: 1600 }}>
              <thead className="border-b border-black/[0.06] bg-mist-soft/50">
                <tr>
                  <th className="th whitespace-nowrap">名刺交換日</th>
                  <th className="th">会社名</th>
                  <th className="th">部署名</th>
                  <th className="th">役職</th>
                  <th className="th">氏名</th>
                  <th className="th">e-mail</th>
                  <th className="th whitespace-nowrap">郵便番号</th>
                  <th className="th">住所</th>
                  <th className="th whitespace-nowrap">TEL会社</th>
                  <th className="th whitespace-nowrap">TEL部門</th>
                  <th className="th whitespace-nowrap">TEL直通</th>
                  <th className="th whitespace-nowrap">Fax</th>
                  <th className="th whitespace-nowrap">携帯電話</th>
                  <th className="th">URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {cards.slice(0, 8).map((c, i) => (
                  <tr key={i}>
                    <td className="td whitespace-nowrap">{c.exchanged_on ?? ""}</td>
                    <td className="td max-w-48"><div className="truncate" title={c.company_name}>{c.company_name}</div></td>
                    <td className="td max-w-36"><div className="truncate" title={c.department ?? ""}>{c.department ?? ""}</div></td>
                    <td className="td max-w-36"><div className="truncate" title={c.title ?? ""}>{c.title ?? ""}</div></td>
                    <td className="td whitespace-nowrap">{c.full_name}</td>
                    <td className="td max-w-48"><div className="truncate" title={c.email ?? ""}>{c.email ?? ""}</div></td>
                    <td className="td whitespace-nowrap">{c.postal_code ?? ""}</td>
                    <td className="td max-w-56"><div className="truncate" title={c.address ?? ""}>{c.address ?? ""}</div></td>
                    <td className="td whitespace-nowrap">{c.tel_company ?? ""}</td>
                    <td className="td whitespace-nowrap">{c.tel_department ?? ""}</td>
                    <td className="td whitespace-nowrap">{c.tel_direct ?? ""}</td>
                    <td className="td whitespace-nowrap">{c.fax ?? ""}</td>
                    <td className="td whitespace-nowrap">{c.mobile_phone ?? ""}</td>
                    <td className="td max-w-40"><div className="truncate" title={c.url ?? ""}>{c.url ?? ""}</div></td>
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
            {converted?.ok && (
              <li className="flex items-center gap-1.5">
                <UserPlus size={14} className="text-ink/40" />
                リード化: 新規 <b>{converted.created}</b> 件 / 既存リードへ紐付け {converted.linkedExisting} 件
                <span className="text-xs text-ink/40">（リード一覧・一括メールの対象になりました）</span>
              </li>
            )}
            {converted && !converted.ok && <li className="text-amber-600">リード化: {converted.error}</li>}
            {!toLeads && <li className="text-xs text-amber-600">リード化していないため、リード一覧には表示されません（名刺一覧の「リード化」から後で実行できます）。</li>}
          </ul>
          <div className="flex gap-2">
            <Link href="/app/business-cards" className="btn-primary inline-block">名刺一覧を見る</Link>
            {(converted?.created ?? 0) > 0 && <Link href="/app/leads" className="btn-ghost inline-block">リード一覧を見る</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
