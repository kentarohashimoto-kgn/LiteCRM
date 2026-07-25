/**
 * Googleカレンダーの非公開URL(iCal)からの予定取得 — サーバー専用。
 *
 * OAuth(Google Cloud Console での同意画面設定)が不要なので、URLを貼るだけで連携できる。
 * URLは知っていれば誰でもカレンダーを読めてしまうため、暗号化して保存し、
 * 取得先ホストも Google のカレンダードメインに限定する(ユーザー入力URLでの
 * 社内ネットワークへの到達=SSRFを防ぐ)。
 */

import "server-only";
import { filterIcs, parseIcs, toLines, type IcsEvent } from "@/lib/ics";
import { validateFeedUrl } from "@/lib/calendar-feed-url";

export { validateFeedUrl } from "@/lib/calendar-feed-url";
export type { FeedUrlCheck } from "@/lib/calendar-feed-url";

/**
 * 読み込みバイト数の上限(暴走防止の安全弁)。
 * 実カレンダーの basic.ics は過去数年ぶんを含み数十MBになるため、全文はメモリに載せず
 * ストリームで読みながら対象週に関係するVEVENTだけを拾う(filterIcs)。
 */
const MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 30000;

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

  const body = res.body;
  if (!body) return { ok: false, error: "カレンダーの取得に失敗しました(応答が空です)" };

  // 全文をメモリに載せず、読みながら対象週に関係するVEVENTだけを拾う。
  let bytes = 0;
  let sawHeader = false;
  async function* chunks(): AsyncGenerator<string> {
    const reader = body!.getReader();
    const decoder = new TextDecoder("utf-8");
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new Error("too_large");
        const text = decoder.decode(value, { stream: true });
        if (!sawHeader && text.includes("BEGIN:VCALENDAR")) sawHeader = true;
        yield text;
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  try {
    const filtered = await filterIcs(toLines(chunks()), from, to);
    if (!sawHeader) return { ok: false, error: "iCal形式のデータではありません。URLを確認してください。" };
    return { ok: true, events: parseIcs(filtered.ics, from, to) };
  } catch (e) {
    if (e instanceof Error && e.message === "too_large") {
      return { ok: false, error: "カレンダーのデータが大きすぎます（64MB超）" };
    }
    return { ok: false, error: "カレンダーの解析に失敗しました" };
  }
}
