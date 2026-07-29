/**
 * 予約送信の時刻ユーティリティ（Gmailの「送信日時を設定」相当）— 純粋ロジック。
 * 画面はJSTで扱い、保存はUTC(ISO)。tests/schedule.test.ts で回帰固定。
 */

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** UTCのISO文字列 → JSTの "YYYY-MM-DDTHH:mm"（datetime-local入力の値）。 */
export function isoToJstLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** JSTの "YYYY-MM-DDTHH:mm" → UTCのISO文字列。 */
export function jstLocalInputToIso(local: string): string {
  // "2026-07-30T09:00" をJSTとして解釈する（末尾に+09:00を付けてパース）
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!m) return new Date(local).toISOString();
  return new Date(`${m[1]}T${m[2]}:00+09:00`).toISOString();
}

/** 表示用: "7/30(木) 09:00"。 */
export function formatJstSchedule(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd}) ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 予約プリセット（Gmail相当）。now は UTC ミリ秒。
 * ・明日の朝: 翌日 8:00 JST
 * ・今日の夕方: 当日 17:00 JST（過ぎていたら翌日）
 * ・来週の月曜: 次の月曜 9:00 JST
 */
export function schedulePresets(now: number): { key: string; label: string; iso: string }[] {
  const jst = new Date(now + JST_OFFSET_MS);
  const at = (dayOffset: number, hour: number) => {
    const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + dayOffset, hour, 0, 0));
    return new Date(d.getTime() - JST_OFFSET_MS).toISOString();
  };
  const todayEveningIso = at(0, 17);
  const eveningPassed = new Date(todayEveningIso).getTime() <= now;
  // 次の月曜(今日が月曜なら来週の月曜)
  const dow = jst.getUTCDay(); // 0=日
  const daysToMon = ((8 - dow) % 7) || 7;

  return [
    { key: "tomorrow_morning", label: "明日の朝 8:00", iso: at(1, 8) },
    eveningPassed
      ? { key: "tomorrow_evening", label: "明日の夕方 17:00", iso: at(1, 17) }
      : { key: "today_evening", label: "今日の夕方 17:00", iso: todayEveningIso },
    { key: "next_monday", label: "来週の月曜 9:00", iso: at(daysToMon, 9) },
  ];
}

/** 予約可能な時刻か（未来であること・1年以内）。 */
export function validateScheduleAt(iso: string, now: number): { ok: true } | { ok: false; error: string } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { ok: false, error: "日時の形式が正しくありません" };
  if (t <= now + 60_000) return { ok: false, error: "送信予定時刻は現在より1分以上あとにしてください" };
  if (t > now + 365 * 86400_000) return { ok: false, error: "1年以内の日時を指定してください" };
  return { ok: true };
}

/** 営業時間外(平日8-18時JST以外)かどうか。予約時に注意喚起するだけで、送信は妨げない。 */
export function isOutsideBusinessHours(iso: string): boolean {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  return day === 0 || day === 6 || hour < 8 || hour >= 18;
}
