/**
 * Googleカレンダー読み取り(マインドマップの週次自動生成で使用) — サーバー専用。
 * 既存の Google OAuth 接続(user_mail_accounts.auth_method='google_oauth')の
 * リフレッシュトークンを流用し、calendar.readonly スコープで予定を取得する。
 *
 * 既にGmailだけで接続済みのユーザーはスコープ不足(403)になるため、
 * 「設定 → メール連携」から再接続してもらう案内を返す。
 */

import "server-only";

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO日時。終日予定は null。 */
  startAt: string | null;
  endAt: string | null;
  /** JSTの YYYY-MM-DD(グルーピングのキー) */
  date: string;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  htmlLink: string | null;
  declined: boolean;
}

export type CalendarResult =
  | { ok: true; events: CalendarEvent[] }
  | { ok: false; error: string; needsReconnect?: boolean };

interface GEvent {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
}

function jstDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/**
 * primary カレンダーの [timeMin, timeMax) の予定を取得(単発予定に展開済み)。
 * 辞退した予定・キャンセル済みは除外する。
 */
export async function listCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  max = 250,
): Promise<CalendarResult> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true", // 繰り返し予定を実体に展開
    orderBy: "startTime",
    maxResults: String(Math.min(2500, max)),
    timeZone: "Asia/Tokyo",
  });
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Googleカレンダーへの接続に失敗しました(ネットワークエラー)" };
  }
  if (res.status === 403 || res.status === 401) {
    return {
      ok: false,
      error: "Googleカレンダーの参照権限がありません。設定→メール連携でGoogleを再接続してください（カレンダー権限の追加が必要）。",
      needsReconnect: true,
    };
  }
  if (!res.ok) return { ok: false, error: `Googleカレンダーの取得に失敗しました(${res.status})` };

  const json = (await res.json()) as { items?: GEvent[] };
  const events: CalendarEvent[] = [];
  for (const e of json.items ?? []) {
    if (e.status === "cancelled") continue;
    const self = (e.attendees ?? []).find((a) => a.self);
    const declined = self?.responseStatus === "declined";
    if (declined) continue;

    const startIso = e.start?.dateTime ?? null;
    const allDay = !startIso;
    const date = startIso ? jstDate(startIso) : (e.start?.date ?? "");
    if (!date) continue;

    events.push({
      id: e.id ?? `${date}-${e.summary ?? ""}`,
      title: (e.summary ?? "(タイトルなし)").slice(0, 200),
      startAt: startIso,
      endAt: e.end?.dateTime ?? null,
      date,
      allDay,
      location: e.location ? e.location.slice(0, 200) : null,
      attendees: (e.attendees ?? [])
        .filter((a) => !a.self)
        .map((a) => a.displayName || a.email || "")
        .filter(Boolean)
        .slice(0, 10),
      htmlLink: e.htmlLink ?? null,
      declined: false,
    });
  }
  return { ok: true, events };
}
