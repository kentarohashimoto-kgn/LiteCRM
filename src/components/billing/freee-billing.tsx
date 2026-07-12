"use client";

import { useState, useTransition } from "react";
import { FileText, Receipt, Send } from "lucide-react";
import { formatYen, formatDateFull, formatMonth } from "@/lib/utils";
import type { OppFreeeData } from "@/lib/data/freee";
import {
  createQuoteDraftAction,
  issueQuoteAction,
  recordAcceptanceAction,
  issueInvoiceAction,
} from "@/server/actions/freee";

const BILLING_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "未検収", cls: "bg-mist-soft text-ink/55" },
  accepted: { label: "検収済", cls: "bg-amber-50 text-amber-700" },
  drafted: { label: "請求下書き", cls: "bg-sky-50 text-sky-700" },
  issued: { label: "請求発行済", cls: "bg-teal-light text-teal-deep" },
  paid: { label: "入金済", cls: "bg-emerald-100 text-emerald-700" },
};

/**
 * 案件詳細の freee 連携パネル（経理ロールのみ描画）。
 * 見積: 下書き→承認発行 / 請求: 検収記録→下書き→承認発行。
 */
export function FreeeBillingPanel({ opportunityId, data }: { opportunityId: string; data: OppFreeeData }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [dateBy, setDateBy] = useState<Record<string, string>>({});

  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      notify(r.ok ? okMsg : r.error ?? "エラーが発生しました");
    });

  const invByBs = new Map(data.invoices.filter((i) => i.billing_schedule_id).map((i) => [i.billing_schedule_id as string, i]));
  const latestQuote = data.quotes[0];

  if (!data.connected) {
    return (
      <p className="text-sm text-ink/50">
        freee が未接続です。<a href="/app/settings/freee" className="text-teal-deep underline">設定 → freee連携</a> から接続すると、ここで見積・請求（検収時）を発行できます。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {msg && <p className="text-xs text-teal-deep bg-teal-light rounded-lg px-3 py-2">{msg}</p>}

      {/* 見積 */}
      <div className="rounded-xl border border-black/[0.05] p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium inline-flex items-center gap-1.5"><FileText size={15} className="text-teal-primary" /> 見積書</span>
          <button onClick={() => run(() => createQuoteDraftAction({ opportunity_id: opportunityId }), "見積の下書きを作成しました")} disabled={pending} className="text-xs rounded-lg border border-black/10 px-2.5 py-1 hover:bg-black/[0.03] disabled:opacity-50">
            ＋ 下書きを作成
          </button>
        </div>
        {data.quotes.length === 0 ? (
          <p className="text-xs text-ink/40">見積の下書きはありません。</p>
        ) : (
          <ul className="space-y-1.5">
            {data.quotes.map((q) => (
              <li key={q.id} className="flex items-center gap-2 text-sm">
                <span className={`pill text-[10px] ${q.status === "issued" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/55"}`}>{q.status === "issued" ? "発行済" : "下書き"}</span>
                <span className="tabular-nums">{formatYen(q.amount)}</span>
                {q.quote_number && <span className="text-xs text-ink/40">{q.quote_number}</span>}
                {q.status === "draft" && (
                  <button onClick={() => run(() => issueQuoteAction({ quote_id: q.id, opportunity_id: opportunityId }), "見積をfreeeへ発行しました")} disabled={pending} className="ml-auto text-xs inline-flex items-center gap-1 rounded-lg bg-teal-primary text-white px-2.5 py-1 disabled:opacity-50">
                    <Send size={12} /> 承認して発行
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {latestQuote && <p className="text-[11px] text-ink/40 mt-1.5">※ 下書きは freee に送信されません。「承認して発行」で freee 見積書を作成します。</p>}
      </div>

      {/* 検収 → 請求 */}
      <div className="rounded-xl border border-black/[0.05] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Receipt size={15} className="text-teal-primary" />
          <span className="text-sm font-medium">検収 → 請求</span>
          <span className="text-[11px] text-ink/40">（請求は検収時に下書き→承認→発行）</span>
        </div>
        {data.billing.length === 0 ? (
          <p className="text-xs text-ink/40">請求予定がありません。上の「請求予定」で追加してください。</p>
        ) : (
          <ul className="divide-y divide-black/[0.05]">
            {data.billing.map((b) => {
              const st = BILLING_STATUS[b.billing_status] ?? BILLING_STATUS.pending;
              const inv = invByBs.get(b.id);
              const label = b.kind === "recurring" ? `毎月 ${formatMonth(b.billing_date)}` : formatDateFull(b.billing_date);
              return (
                <li key={b.id} className="py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`pill text-[10px] ${st.cls}`}>{st.label}</span>
                    <span className="text-sm font-medium tabular-nums">{formatYen(b.amount)}</span>
                    <span className="text-xs text-ink/45">{label}{b.note ? ` ・ ${b.note}` : ""}</span>
                    {b.accepted_on && <span className="text-xs text-ink/40">検収 {formatDateFull(b.accepted_on)}</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {b.billing_status === "pending" && (
                      <>
                        <input
                          type="date"
                          className="input h-8 py-1 w-auto text-xs"
                          value={dateBy[b.id] ?? today}
                          onChange={(e) => setDateBy((p) => ({ ...p, [b.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => run(() => recordAcceptanceAction({ billing_schedule_id: b.id, opportunity_id: opportunityId, accepted_on: dateBy[b.id] ?? today }), "検収を記録し、請求の下書きを作成しました")}
                          disabled={pending}
                          className="text-xs rounded-lg bg-accent-orange text-white px-2.5 py-1 disabled:opacity-50"
                        >
                          検収を記録（請求下書き作成）
                        </button>
                      </>
                    )}
                    {inv && inv.status === "draft" && (
                      <button
                        onClick={() => run(() => issueInvoiceAction({ invoice_id: inv.id, opportunity_id: opportunityId }), "請求書をfreeeへ発行しました")}
                        disabled={pending}
                        className="text-xs inline-flex items-center gap-1 rounded-lg bg-teal-primary text-white px-2.5 py-1 disabled:opacity-50"
                      >
                        <Send size={12} /> 承認して請求発行
                      </button>
                    )}
                    {inv && inv.status !== "draft" && (
                      <span className="text-xs text-ink/50">
                        {inv.invoice_number ? `請求番号 ${inv.invoice_number}` : "発行済"}
                        {inv.due_date ? ` ・ 支払期日 ${formatDateFull(inv.due_date)}` : ""}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
