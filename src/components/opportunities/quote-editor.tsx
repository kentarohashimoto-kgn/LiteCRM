"use client";

import { useState } from "react";
import { Plus, Printer, Trash2 } from "lucide-react";

export interface QuoteLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

const TAX_RATE = 0.1;

function yen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

function plusMonth(d: Date): string {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1);
  return x.toISOString().slice(0, 10);
}

/**
 * D-3 見積書エディタ: 画面上で宛名・品目を整えて、ブラウザ印刷(PDF保存)で提出する。
 * 入力値は保存しない(印刷用の下書き)。
 */
export function QuoteEditor({
  defaultClientName,
  defaultSubject,
  defaultLines,
}: {
  defaultClientName: string;
  defaultSubject: string;
  defaultLines: QuoteLine[];
}) {
  const today = new Date();
  const [docTitle, setDocTitle] = useState("御見積書");
  const [clientName, setClientName] = useState(defaultClientName);
  const [subject, setSubject] = useState(defaultSubject);
  const [issueDate, setIssueDate] = useState(today.toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(plusMonth(today));
  const [quoteNo, setQuoteNo] = useState(`Q-${today.toISOString().slice(0, 10).replace(/-/g, "")}-01`);
  const [issuer, setIssuer] = useState("株式会社カトルセ");
  const [issuerAddress, setIssuerAddress] = useState("");
  const [issuerContact, setIssuerContact] = useState("");
  const [notes, setNotes] = useState("・本見積の有効期限は上記のとおりです。\n・納期/支払条件は別途ご相談ください。");
  const [lines, setLines] = useState<QuoteLine[]>(defaultLines);

  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;

  const setLine = (i: number, patch: Partial<QuoteLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="max-w-3xl mx-auto">
      {/* 印刷時はアプリのサイドバー/ヘッダー等を隠す */}
      <style>{`
        @media print {
          aside, header, nav { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          body { background: #fff !important; }
          .quote-sheet { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="print:hidden mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-ink/50">各欄はクリックで編集できます。整えたら「印刷 / PDF保存」を押してください。</p>
        <button type="button" onClick={() => window.print()} className="btn-accent inline-flex items-center gap-1.5">
          <Printer size={15} /> 印刷 / PDF保存
        </button>
      </div>

      <div className="quote-sheet card bg-white p-10 text-ink">
        <div className="text-center mb-8">
          <input
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="text-2xl font-bold tracking-[0.3em] text-center w-full outline-none"
            aria-label="帳票タイトル"
          />
        </div>

        <div className="flex justify-between gap-8 mb-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-end gap-1 border-b-2 border-ink/70 pb-1 mb-2">
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="text-lg font-semibold outline-none flex-1 min-w-0"
                placeholder="宛名(会社名)"
                aria-label="宛名"
              />
              <span className="text-sm shrink-0">御中</span>
            </div>
            <div className="text-sm flex items-center gap-2">
              <span className="text-ink/50 shrink-0">件名:</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="outline-none flex-1 min-w-0" aria-label="件名" />
            </div>
            <p className="text-sm mt-4">下記のとおりお見積り申し上げます。</p>
            <div className="mt-3 rounded-lg bg-black/[0.03] px-4 py-2.5 inline-block">
              <span className="text-xs text-ink/50 mr-3">御見積金額（税込）</span>
              <span className="text-2xl font-bold tabular-nums">{yen(total)}</span>
            </div>
          </div>

          <div className="text-sm space-y-1 shrink-0 w-64">
            <div className="flex justify-between gap-2"><span className="text-ink/50">見積番号</span><input value={quoteNo} onChange={(e) => setQuoteNo(e.target.value)} className="outline-none text-right w-36" aria-label="見積番号" /></div>
            <div className="flex justify-between gap-2"><span className="text-ink/50">発行日</span><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="outline-none text-right" aria-label="発行日" /></div>
            <div className="flex justify-between gap-2"><span className="text-ink/50">有効期限</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="outline-none text-right" aria-label="有効期限" /></div>
            <div className="pt-3 space-y-0.5">
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="font-semibold outline-none w-full" aria-label="発行元" />
              <input value={issuerAddress} onChange={(e) => setIssuerAddress(e.target.value)} className="outline-none w-full text-xs" placeholder="住所(任意)" aria-label="発行元住所" />
              <input value={issuerContact} onChange={(e) => setIssuerContact(e.target.value)} className="outline-none w-full text-xs" placeholder="TEL / メール(任意)" aria-label="発行元連絡先" />
            </div>
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-y border-ink/30 text-xs text-ink/60">
              <th className="py-2 text-left">品目</th>
              <th className="py-2 text-right w-16">数量</th>
              <th className="py-2 text-right w-28">単価</th>
              <th className="py-2 text-right w-32">金額</th>
              <th className="w-8 print:hidden" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-black/[0.06]">
                <td className="py-1.5"><input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="outline-none w-full" aria-label={`品目${i + 1}`} /></td>
                <td className="py-1.5 text-right"><input type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} className="outline-none w-full text-right tabular-nums" aria-label={`数量${i + 1}`} /></td>
                <td className="py-1.5 text-right"><input type="number" min={0} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} className="outline-none w-full text-right tabular-nums" aria-label={`単価${i + 1}`} /></td>
                <td className="py-1.5 text-right tabular-nums">{yen(l.quantity * l.unitPrice)}</td>
                <td className="print:hidden text-center">
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-ink/25 hover:text-rose-500" aria-label={`品目${i + 1}を削除`}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { name: "", quantity: 1, unitPrice: 0 }])}
          className="print:hidden inline-flex items-center gap-1 text-xs text-teal-deep hover:underline mb-4"
        >
          <Plus size={13} /> 行を追加
        </button>

        <div className="flex justify-end mb-8">
          <div className="w-64 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-ink/55">小計</span><span className="tabular-nums">{yen(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink/55">消費税（10%）</span><span className="tabular-nums">{yen(tax)}</span></div>
            <div className="flex justify-between border-t border-ink/30 pt-1.5 font-bold"><span>合計</span><span className="tabular-nums">{yen(total)}</span></div>
          </div>
        </div>

        <div>
          <div className="text-xs text-ink/50 mb-1">備考</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full text-sm outline-none resize-none" aria-label="備考" />
        </div>
      </div>
    </div>
  );
}
