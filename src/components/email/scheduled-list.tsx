"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, X, Loader2, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { cancelScheduledEmailAction, rescheduleEmailAction, type ScheduledRow } from "@/server/actions/mail-schedule";
import { formatJstSchedule, isoToJstLocalInput, jstLocalInputToIso } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/** 予約送信の一覧。送信前はキャンセル・日時変更ができる（本人分のみ）。 */

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "送信予定", cls: "bg-teal-light text-teal-deep" },
  sent: { label: "送信済み", cls: "bg-emerald-100 text-emerald-700" },
  canceled: { label: "取消", cls: "bg-mist-soft text-ink/50" },
  failed: { label: "失敗", cls: "bg-rose-100 text-rose-700" },
};

export function ScheduledList({ rows, senderNames }: { rows: ScheduledRow[]; senderNames: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cancel = async (id: string) => {
    if (!confirm("この予約をキャンセルします。よろしいですか？（送信は行われません）")) return;
    setBusy(id); setMsg(null);
    try {
      const r = await cancelScheduledEmailAction(id);
      setMsg(r.ok ? { ok: true, text: "予約をキャンセルしました" } : { ok: false, text: r.error ?? "失敗しました" });
      if (r.ok) router.refresh();
    } finally { setBusy(null); }
  };

  const save = async (id: string) => {
    setBusy(id); setMsg(null);
    try {
      const r = await rescheduleEmailAction(id, jstLocalInputToIso(editVal));
      setMsg(r.ok ? { ok: true, text: "送信日時を変更しました" } : { ok: false, text: r.error ?? "失敗しました" });
      if (r.ok) { setEditing(null); router.refresh(); }
    } finally { setBusy(null); }
  };

  const upcoming = rows.filter((r) => r.status === "scheduled");
  const past = rows.filter((r) => r.status !== "scheduled");

  const Row = ({ r }: { r: ScheduledRow }) => (
    <div className="card card-pad space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("pill text-[10px]", STATUS[r.status]?.cls ?? "bg-mist-soft text-ink/50")}>{STATUS[r.status]?.label ?? r.status}</span>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-ink tabular-nums">
          <Clock size={13} className="text-ink/40" /> {formatJstSchedule(r.scheduledAt)}
        </span>
        {r.batchTitle && <span className="pill bg-mist-soft text-ink/55 text-[10px]">一括: {r.batchTitle}</span>}
        <span className="text-xs text-ink/45 ml-auto">{senderNames[r.senderUserId] ?? ""}</span>
      </div>
      <p className="text-sm text-ink truncate">{r.subject || "(件名なし)"}</p>
      <p className="text-xs text-ink/50">宛先: {r.toAddr}</p>
      {r.errorText && <p className="text-xs text-rose-600">{r.errorText}</p>}

      {r.status === "scheduled" && r.isMine && (
        editing === r.id ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <input type="datetime-local" value={editVal} onChange={(e) => setEditVal(e.target.value)} className="input text-sm max-w-[220px]" />
            <button onClick={() => save(r.id)} disabled={busy === r.id} className="btn-accent text-xs px-3">保存</button>
            <button onClick={() => setEditing(null)} className="btn-ghost text-xs">やめる</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => { setEditing(r.id); setEditVal(isoToJstLocalInput(r.scheduledAt)); }}
              className="btn-ghost inline-flex items-center gap-1 text-xs"
            >
              <CalendarClock size={13} /> 日時を変更
            </button>
            <button onClick={() => cancel(r.id)} disabled={busy === r.id} className="btn-ghost inline-flex items-center gap-1 text-xs text-rose-600">
              {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} 予約を取消
            </button>
          </div>
        )
      )}
      {r.status === "scheduled" && !r.isMine && (
        <p className="text-[11px] text-ink/40 pt-0.5">他のメンバーの予約です（変更・取消は本人のみ）</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`inline-flex items-center gap-1.5 text-sm ${msg.ok ? "text-teal-deep" : "text-rose-600"}`}>
          {msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.text}
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold text-ink mb-2">送信予定（{upcoming.length}）</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center card">予約中のメールはありません。メール作成画面の「送信日時を指定」から予約できます。</p>
        ) : (
          <div className="space-y-2">{upcoming.map((r) => <Row key={r.id} r={r} />)}</div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-2">実行済み・取消（{past.length}）</h2>
          <div className="space-y-2">{past.slice(0, 50).map((r) => <Row key={r.id} r={r} />)}</div>
        </section>
      )}
    </div>
  );
}
