/**
 * Googleカレンダーの非公開URL(iCal)からの予定取得 — サーバー専用。
 *
 * OAuth(Google Cloud Console での同意画面設定)が不要なので、URLを貼るだけで連携できる。
 * URLは知っていれば誰でもカレンダーを読めてしまうため、暗号化して保存し、
 * 取得先ホストも Google のカレンダードメインに限定する(ユーザー入力URLでの
 * 社内ネットワークへの到達=SSRFを防ぐ)。
 */

import "server-only";
import { parseIcs, type IcsEvent } from "@/lib/ics";

/** 許可するホスト(Googleカレンダーの非公開URLのみ)。 */
const ALLOWED_HOSTS = ["calendar.google.com"];

/** 取得サイズの上限(巨大なカレンダーでメモリを潰さない)。 */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;

export type FeedUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * 貼り付けられたURLを検証する。
 * Googleの「カレンダーの統合 → 非公開URL(iCal形式)」で得られる
 * https://calendar.google.com/calendar/ical/<id>/private-<key>/basic.ics を想定。
 */
export function validateFeedUrl(input: string): FeedUrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "URLを入力してください" };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "URLの形式が正しくありません" };
  }
  // webcal:// で渡されることがあるので https に読み替える
  if (u.protocol === "webcal:") u.protocol = "https:";
  if (u.protocol !== "https:") return { ok: false, error: "https のURLを指定してください" };
  if (!ALLOWED_HOSTS.includes(u.hostname)) {
    return { ok: false, error: "GoogleカレンダーのURL(calendar.google.com)を指定してください" };
  }
  if (!u.pathname.includes("/ical/")) {
    return { ok: false, error: "「非公開URL(iCal形式)」の .ics で終わるURLを指定してください" };
  }
  if (u.pathname.includes("/public/")) {
    return { ok: false, error: "公開URLではなく「非公開URL(iCal形式)」を指定してください" };
  }
  return { ok: true, url: u.toString() };
}

export type FeedResult =
  | { ok: true; events: IcsEvent[] }
  | { ok: false; error: string };

/** 非公開URLから [from, to) の予定を取得する(繰り返しは展開済み)。 */
export async function fetchCalendarFeed(url: string, from: Date, to: Date): Promise<FeedResult> {
  const checked = validateFeedUrl(url);
  if (!checked.ok) return { ok: false, error: checked.error };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(checked.url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "text/calendar" },
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: aborted ? "カレンダーの取得がタイムアウトしました" : "カレンダーの取得に失敗しました" };
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return { ok: false, error: "URLが無効です。Googleカレンダーで非公開URLをリセットした場合は貼り直してください。" };
  }
  if (!res.ok) return { ok: false, error: `カレンダーの取得に失敗しました(${res.status})` };

  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return { ok: false, error: "カレンダーのデータが大きすぎます" };

  const text = await res.text();
  if (text.length > MAX_BYTES) return { ok: false, error: "カレンダーのデータが大きすぎます" };
  if (!text.includes("BEGIN:VCALENDAR")) {
    return { ok: false, error: "iCal形式のデータではありません。URLを確認してください。" };
  }

  try {
    return { ok: true, events: parseIcs(text, from, to) };
  } catch {
    return { ok: false, error: "カレンダーの解析に失敗しました" };
  }
}
