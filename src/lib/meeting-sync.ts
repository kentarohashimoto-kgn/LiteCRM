/**
 * 案件(opportunities)の「初回商談日(first_meeting_date)」「アポ日時(appointment_at)」を、
 * 実体である商談(meetings)レコードから導出するためのヘルパー。
 *
 * 背景: 初回商談の日付が案件側(first_meeting_date / appointment_at)と商談側(meeting_date /
 * meeting_at)の2か所に冗長に保存されている。商談を後から振り替えても案件側が追従せず、
 * アポカレンダー(appointment_calendar_events)が別日で二重表示される事故が起きていた。
 * → 商談レコードを唯一の正とし、商談の作成/更新時に案件側を「最も早い商談」に同期する。
 */

export interface MeetingDateLite {
  meeting_date: string | null;
  meeting_at: string | null;
}

/** timestamptz(ISO) を Asia/Tokyo の暦日(YYYY-MM-DD)へ。 */
export function jstDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 商談の「暦日(JST)」を返す。meeting_at優先、無ければmeeting_date。判定不能はnull。 */
function meetingDay(m: MeetingDateLite): string | null {
  if (m.meeting_at) return jstDate(m.meeting_at);
  if (m.meeting_date) return m.meeting_date.slice(0, 10);
  return null;
}

/** 並び替え用の絶対時刻(ms)。時刻なしはその日の 00:00 JST とみなす。判定不能はnull。 */
function meetingSortKey(m: MeetingDateLite): number | null {
  const day = meetingDay(m);
  if (!day) return null;
  const key = m.meeting_at ? Date.parse(m.meeting_at) : Date.parse(`${day}T00:00:00+09:00`);
  return Number.isNaN(key) ? null : key;
}

/** 有効な日付を持つ商談のうち、暦日/時刻が最も早い1件を返す。無ければnull。 */
export function earliestMeeting<T extends MeetingDateLite>(meetings: T[]): T | null {
  let best: { row: T; key: number } | null = null;
  for (const m of meetings) {
    const key = meetingSortKey(m);
    if (key === null) continue;
    if (!best || key < best.key) best = { row: m, key };
  }
  return best ? best.row : null;
}

/**
 * 商談群のうち「最も早い商談(=初回商談)」から、案件へ反映すべき
 * first_meeting_date / appointment_at を求める。
 * 有効な日付を持つ商談が1件も無ければ null(=案件側を変更しない)。
 */
export function deriveFirstMeeting(
  meetings: MeetingDateLite[],
): { first_meeting_date: string; appointment_at: string | null } | null {
  const e = earliestMeeting(meetings);
  if (!e) return null;
  return { first_meeting_date: meetingDay(e)!, appointment_at: e.meeting_at ?? null };
}
