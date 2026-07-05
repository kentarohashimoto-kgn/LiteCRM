"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AtSign, Bell, CheckCheck, Inbox, Loader2, Sun } from "lucide-react";
import {
  fetchNotificationsAction,
  markAllNotificationsReadAction,
  type NotificationRow,
} from "@/server/actions/notifications";

const KIND_ICON: Record<string, React.ElementType> = {
  mention: AtSign,
  lead: Inbox,
  digest: Sun,
};

function fmt(value: string): string {
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** A-1 アプリ内通知ベル: 未読バッジ＋ドロップダウン。 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      startTransition(async () => {
        const res = await fetchNotificationsAction();
        setRows(res.rows);
        setUnread(res.unread);
      });
    }
  };

  const markAll = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setUnread(0);
      setRows((prev) => (prev ?? []).map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="relative text-ink/40 hover:text-ink/70 p-1"
        title="通知"
        aria-label={`通知${unread > 0 ? `（未読${unread}件）` : ""}`}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[90vw] rounded-2xl border border-black/[0.06] bg-white shadow-lg z-30">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.04]">
            <span className="text-sm font-semibold text-ink">通知</span>
            <button
              type="button"
              onClick={markAll}
              disabled={pending || unread === 0}
              className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline disabled:opacity-40"
            >
              <CheckCheck size={13} /> すべて既読
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {rows === null ? (
              <div className="flex justify-center py-8 text-ink/30"><Loader2 size={18} className="animate-spin" /></div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-ink/40 py-8 text-center">通知はありません</p>
            ) : (
              <ul className="divide-y divide-black/[0.04]">
                {rows.map((n) => {
                  const Icon = KIND_ICON[n.kind] ?? Bell;
                  const inner = (
                    <div className={`flex gap-2.5 px-4 py-2.5 ${n.read_at ? "opacity-60" : "bg-teal-light/20"}`}>
                      <Icon size={15} className="text-teal-deep mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-ink font-medium">{n.title}</div>
                        {n.body && <div className="text-xs text-ink/55 mt-0.5 line-clamp-2 whitespace-pre-line">{n.body}</div>}
                        <div className="text-[11px] text-ink/35 mt-0.5">{fmt(n.created_at)}</div>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <Link href={n.href} onClick={() => setOpen(false)} className="block hover:bg-black/[0.02]">
                          {inner}
                        </Link>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
