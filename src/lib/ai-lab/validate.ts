/** AI Lab の入力検証と、画面に出す文言の組み立て。 */

/** /lab/{slug} と衝突する・誤解を招くスラッグは使わせない。 */
export const LAB_RESERVED_SLUGS = [
  "app",
  "api",
  "lab",
  "login",
  "logout",
  "help",
  "admin",
  "preview",
  "chat",
  "new",
  "static",
  "public",
  "assets",
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** 問題なければ null、あればエラーメッセージを返す。 */
export function validateSlug(slug: string): string | null {
  if (!slug) return "URL識別子を入力してください";
  if (!SLUG_RE.test(slug)) {
    return "URL識別子は英小文字・数字・ハイフンで、2〜63文字（先頭は英数字）にしてください";
  }
  if (slug.endsWith("-")) return "URL識別子の末尾にハイフンは使えません";
  if (LAB_RESERVED_SLUGS.includes(slug)) return "このURL識別子は予約語のため使用できません";
  return null;
}

/** 最初の質問から会話タイトルを作る。改行・空白は潰し、長ければ省略記号を付ける。 */
export function conversationTitleFrom(message: string, max = 30): string {
  const flat = (message ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "新しいチャット";
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** アセット1件あたりの文字数上限。プロンプト注入前の受け入れ検査。 */
export const MAX_ASSET_CHARS = 200_000;

export function validateAssetText(text: string): string | null {
  if (!text || !text.trim()) return "内容が空です";
  if (text.length > MAX_ASSET_CHARS) {
    return `内容が長すぎます（${MAX_ASSET_CHARS.toLocaleString()}文字以内）`;
  }
  return null;
}

/** ログインIDは会社内で一意。記号は誤入力の元なので英数と一部記号に限る。 */
export function validateLoginId(loginId: string): string | null {
  if (!loginId) return "ログインIDを入力してください";
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(loginId)) {
    return "ログインIDは英数字と . _ - @ で3〜64文字にしてください";
  }
  return null;
}
