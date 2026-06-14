"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSubscriptionAction } from "@/server/actions";
import { formatYen } from "@/lib/utils";

export function SubscriptionForm({ opportunityId, accountId }: { opportunityId: string; accountId?: string }) {
  const router = useRouter();
  const [monthly, setMonthly] = useState(1000000);
  const [term, setTerm] = useState(3);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(formData: FormData) {
    setSaving(true);
    setDone(false);
    await addSubscriptionAction(formData);
    setSaving(false);
    setDone(true);
    router.refresh();
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <details className="border-t border-black/[0.05] pt-3">
      <summary className="cursor-pointer text-sm font-medium text-violet-600">＋ サブスク契約で登録（月額×契約期間）</summary>
      <form action={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="opportunity_id" value={opportunityId} />
        {accountId && <input type="hidden" name="account_id" value={accountId} />}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">月額(円)</label>
            <input name="monthly_amount" type="number" value={monthly} onChange={(e) => setMonthly(parseInt(e.target.value || "0", 10))} className="input" />
          </div>
          <div>
            <label className="label">契約開始月</label>
            <input name="start_month" type="month" className="input" required />
          </div>
          <div>
            <label className="label">契約月数</label>
            <input name="term_months" type="number" min={1} value={term} onChange={(e) => setTerm(parseInt(e.target.value || "1", 10))} className="input" />
          </div>
        </div>
        <div className="text-xs text-ink/50">
          契約確定TCV ＝ <b className="stat-accent">{formatYen(monthly * Math.max(1, term))}</b>（月額 {formatYen(monthly)} × {Math.max(1, term)}ヶ月）。毎月の請求スケジュールを自動作成します。
        </div>
        <div className="border-t border-black/[0.05] pt-3">
          <div className="text-sm font-medium mb-2 text-ink/70">更新見込み（任意・b軸の見込みレイヤー）</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">想定継続終了月</label>
              <input name="renewal_until_month" type="month" className="input" placeholder="続くと見込む月まで" />
            </div>
            <div>
              <label className="label">更新確度(%)</label>
              <input name="renewal_probability" type="number" min={0} max={100} className="input" placeholder="例: 60" />
            </div>
          </div>
          <p className="text-[11px] text-ink/40 mt-1">契約満了の翌月〜想定継続終了月を「月額×更新確度」で売上予測に加重計上します。</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="make_task" value="1" defaultChecked className="accent-teal-primary" />
          契約満了前に「更新提案」タスクを自動作成する
        </label>
        <button type="submit" disabled={saving} className="btn-accent disabled:opacity-40">
          {saving ? "登録中…" : done ? "✓ 登録しました" : "サブスク契約を登録"}
        </button>
      </form>
    </details>
  );
}
