"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

/** A-1 アプリ内通知: 最新20件＋未読数。 */
export async function fetchNotificationsAction(): Promise<{ rows: NotificationRow[]; unread: number }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const [{ data }, { count }] = await Promise.all([
    sb
      .from("notifications")
      .select("id, kind, title, body, href, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return { rows: (data ?? []) as NotificationRow[], unread: count ?? 0 };
}

/** すべて既読にする。 */
export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  return { ok: true };
}
