"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink } from "lucide-react";
import { deleteXraySnapshotAction, type XraySnapshotListItem } from "@/server/actions/xray";
import { cn, formatYen } from "@/lib/utils";

function fmtDateJp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtPeriod(start: string, endExclusive: string): string {
  const e = new Date(endExclusive + "T00:00:00");
  e.setDate(e.getDate() - 1);
  const s = new Date(start + "T00:00:00");
  return `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getFullYear()}/${e.getMonth() + 1}/${e.getDate()}`;
}

export function XrayHistoryList({ items }: { items: XraySnapshotListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(item: XraySnapshotListItem) {
    if (!window.confirm(`「${item.label ?? "(名前なし)"}」を削除しますか？この操作は取り消せません。`)) return;
    setBusyId(item.id);
    const res = await deleteXraySnapshotAction({ id: item.id });
    setBusyId(null);
    if (res.ok) router.refresh();
    else alert("削除できませんでした（権限がない可能性があります）");
  }

  if (items.length === 0) {
    return (
      <div className="card card-pad text-center py-12 text-sm text-ink/45">
        まだ保存された分析結果はありません。
        <br />
        <span className="text-xs">営業レントゲンの「この分析を保存」で手動保存できるほか、毎月1日に前月分が自動保存されます。</span>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-black/[0.06]">
          <tr>
            <th className="th">保存日時</th>
            <th className="th">種別</th>
            <th className="th">ラベル</th>
            <th className="th">対象期間</th>
            <th className="th text-right">期間売上</th>
            <th className="th text-right">受注</th>
            <th className="th text-right">リード</th>
            <th className="th">保存者</th>
            <th className="th w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.04]">
          {items.map((it) => (
            <tr key={it.id} className="row-hover">
              <td className="td text-xs tabular-nums whitespace-nowrap">{fmtDateJp(it.taken_at)}</td>
              <td className="td">
                <span className={cn("pill text-[10px]", it.kind === "monthly" ? "bg-indigo-100 text-indigo-700" : "bg-teal-light text-teal-deep")}>
                  {it.kind === "monthly" ? "月次自動" : "手動"}
                </span>
              </td>
              <td className="td max-w-[240px]">
                <Link href={`/app/analytics/xray/history/${it.id}`} className="text-sm font-medium text-teal-deep hover:underline truncate block">
                  {it.label ?? "(名前なし)"}
                </Link>
              </td>
              <td className="td text-xs tabular-nums whitespace-nowrap">{fmtPeriod(it.period_start, it.period_end)}</td>
              <td className="td text-right tabular-nums font-semibold">{formatYen(it.revenue_booked)}</td>
              <td className="td text-right tabular-nums">{it.won_booked}</td>
              <td className="td text-right tabular-nums">{it.leads.toLocaleString("ja-JP")}</td>
              <td className="td text-xs text-ink/55">{it.created_by_name ?? "自動"}</td>
              <td className="td">
                <div className="flex items-center justify-end gap-1">
                  <Link href={`/app/analytics/xray/history/${it.id}`} title="開く"
                    className="rounded-lg p-1.5 text-ink/40 hover:text-teal-deep hover:bg-teal-light/40">
                    <ExternalLink size={14} />
                  </Link>
                  <button type="button" onClick={() => remove(it)} disabled={busyId === it.id} title="削除"
                    className="rounded-lg p-1.5 text-ink/30 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
