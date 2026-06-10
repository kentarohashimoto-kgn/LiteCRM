"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { BillingSchedule, OpportunityCategory } from "@/lib/types";
import { CATEGORY_MAP } from "@/lib/constants";
import { createBillingScheduleAction, deleteBillingScheduleAction } from "@/server/actions";
import { formatYen, formatDateFull, formatMonth } from "@/lib/utils";

function monthsBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()) + 1;
}

export function BillingSection({
  schedules,
  opportunityId,
  accountId,
  category,
}: {
  schedules: BillingSchedule[];
  opportunityId: string;
  accountId?: string;
  category?: OpportunityCategory;
}) {
  const [kind, setKind] = useState<"one_time" | "recurring">(
    category === "advisory_subscription" ? "recurring" : "one_time",
  );
  const hint = category ? CATEGORY_MAP[category]?.billingHint : undefined;

  const total = schedules.reduce((s, b) => {
    if (b.kind === "recurring" && b.recurring_start_month) {
      const n = b.recurring_end_month ? monthsBetween(b.recurring_start_month, b.recurring_end_month) : 1;
      return s + b.amount * Math.max(1, n);
    }
    return s + b.amount;
  }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-ink/45">{hint}</span>
        <span className="text-sm">請求総額 <b className="stat-accent">{formatYen(total)}</b></span>
      </div>

      {schedules.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">請求予定はまだありません</p>
      ) : (
        <ul className="divide-y divide-black/[0.05] mb-3">
          {schedules.map((b) => (
            <li key={b.id} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {b.kind === "recurring" ? (
                  <>
                    <div className="text-sm font-medium">
                      <span className="pill bg-violet-50 text-violet-600 text-[10px] mr-1.5">毎月</span>
                      {formatMonth(b.recurring_start_month)} 〜 {b.recurring_end_month ? formatMonth(b.recurring_end_month) : "—"}
                    </div>
                    <div className="text-xs text-ink/50">
                      月額 {formatYen(b.amount)}
                      {b.recurring_start_month && b.recurring_end_month && (
                        <span className="ml-1">（計 {formatYen(b.amount * Math.max(1, monthsBetween(b.recurring_start_month, b.recurring_end_month)))}）</span>
                      )}
                      {b.note ? ` ・ ${b.note}` : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium">
                      <span className="pill bg-mist-soft text-ink/60 text-[10px] mr-1.5">都度</span>
                      {formatDateFull(b.billing_date)}
                    </div>
                    <div className="text-xs text-ink/50">請求額 {formatYen(b.amount)}{b.note ? ` ・ ${b.note}` : ""}</div>
                  </>
                )}
              </div>
              <form action={deleteBillingScheduleAction}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="opportunity_id" value={opportunityId} />
                <button type="submit" className="text-ink/30 hover:text-rose-500" title="削除"><Trash2 size={15} /></button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <details className="border-t border-black/[0.05] pt-3">
        <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 請求予定を追加</summary>
        <form action={createBillingScheduleAction} className="mt-3 space-y-3">
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          {accountId && <input type="hidden" name="account_id" value={accountId} />}
          <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs">
            <button type="button" onClick={() => setKind("one_time")} className={`rounded-md px-3 py-1 font-medium ${kind === "one_time" ? "bg-teal-primary text-white" : "text-ink/55"}`}>都度請求</button>
            <button type="button" onClick={() => setKind("recurring")} className={`rounded-md px-3 py-1 font-medium ${kind === "recurring" ? "bg-teal-primary text-white" : "text-ink/55"}`}>毎月請求(SES/顧問)</button>
          </div>
          <input type="hidden" name="kind" value={kind} />

          {kind === "one_time" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">請求予定日</label>
                <input name="billing_date" type="date" className="input" />
              </div>
              <div>
                <label className="label">請求額(円)</label>
                <input name="amount" type="number" className="input" placeholder="1500000" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">請求開始月</label>
                <input name="recurring_start_month" type="month" className="input" />
              </div>
              <div>
                <label className="label">請求終了月</label>
                <input name="recurring_end_month" type="month" className="input" />
              </div>
              <div>
                <label className="label">月額(円)</label>
                <input name="amount" type="number" className="input" placeholder="300000" />
              </div>
            </div>
          )}
          <div>
            <label className="label">メモ</label>
            <input name="note" className="input" placeholder="例：着手金 / 月額保守 / SES 1名" />
          </div>
          <button type="submit" className="btn-accent">請求予定を追加</button>
        </form>
      </details>
    </div>
  );
}
