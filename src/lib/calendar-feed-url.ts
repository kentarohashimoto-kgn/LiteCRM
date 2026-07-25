/**
 * カレンダー非公開URLの検証(純関数)。
 *
 * 取得処理(server-only)とは分けている。ここはポリシーだけなのでテストから直接呼べる。
 */

/** 許可するホスト(Googleカレンダーの非公開URLのみ)。 */
export const ALLOWED_HOSTS = ["calendar.google.com"];

export type FeedUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * 貼り付けられたURLを検証する。
 * Googleの「カレンダーの統合 → 非公開URL(iCal形式)」で得られる
 * https://calendar.google.com/calendar/ical/<id>/private-<key>/basic.ics を想定。
 *
 * ホストを限定しているのは、ユーザー入力URLで社内ネットワークに到達させない(SSRF防止)ため。
 */
export function validateFeedUrl(input: string): FeedUrlCheck {
  // 「iCal形式で登録」からは webcal:// で渡ることがあるので https に読み替える。
  // URL標準では非特殊スキーム(webcal)→特殊スキーム(https)への変更ができないため、
  // パース前に文字列で置換する。
  const raw = input.trim().replace(/^webcal:\/\//i, "https://");
  if (!raw) return { ok: false, error: "URLを入力してください" };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "URLの形式が正しくありません" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "https のURLを指定してください" };
  if (!ALLOWED_HOSTS.includes(u.hostname)) {
    return { ok: false, error: "GoogleカレンダーのURL(calendar.google.com)を指定してください" };
  }
  if (!u.pathname.includes("/ical/")) {
    return { ok: false, error: "「非公開URL(iCal形式)」の .ics で終わるURLを指定してください" };
  }
  // 公開URL(/public/)は「カレンダーを一般公開している場合のみ」動くうえ、
  // 非公開URLと同じ画面に並んでいて取り違えやすいので、はっきり弾いて誘導する。
  if (u.pathname.includes("/public/")) {
    return {
      ok: false,
      error:
        "これは「公開URL」です。同じ「カレンダーの統合」欄にある「非公開URL(iCal形式)」" +
        "（目のアイコンを押すと表示され、/private- が入っているもの）をコピーしてください。",
    };
  }
  return { ok: true, url: u.toString() };
}
