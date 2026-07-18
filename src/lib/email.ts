/**
 * WO-20 メール連携(F-101a / 選択肢B・OAuth不要) — 純粋ロジック。
 *
 * テンプレートの変数差し込みと、Gmail の作成(compose)画面URLの組み立てを、
 * DB非依存の純関数として実装する。送信は「Gmail作成画面を開いて人が送る」=
 * 確定原則(送信は手動)。tests/email.test.ts で回帰固定する。
 */

/** テンプレートで使える差し込み変数(UIのヘルプに表示)。 */
export const EMAIL_TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: "contact", label: "担当者名" },
  { key: "company", label: "会社名" },
  { key: "opportunity", label: "案件名" },
  { key: "sender", label: "自分(署名)" },
];

export type EmailVars = Record<string, string | null | undefined>;

/**
 * "{contact} 様" のような単純プレースホルダを差し込む。
 * 未知の変数はそのまま残す(誤差し込みで情報を捏造しない)。null/空は空文字。
 */
export function renderEmailTemplate(tmpl: string, vars: EmailVars): string {
  return tmpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in vars)) return whole;
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** メールカテゴリの表示名。 */
export const EMAIL_CATEGORY_LABEL: Record<string, string> = {
  thanks: "お礼",
  material: "資料送付",
  schedule: "日程調整",
  followup: "フォロー",
  other: "その他",
};

export interface GmailComposeInput {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}

/**
 * Gmail の作成(compose)画面を開くURLを組み立てる。
 * view=cm(compose message)・fs=1(full screen)。to/su/body をURLエンコードして付与。
 * 送信はユーザーがGmail上で確認して行う(このURLは下書きを開くだけ)。
 */
export function buildGmailComposeUrl(input: GmailComposeInput): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (input.to) params.set("to", input.to);
  if (input.subject) params.set("su", input.subject);
  if (input.body) params.set("body", input.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** 本文抜粋(タイムライン表示・容量節約)。改行を詰めて先頭 n 文字。 */
export function emailSnippet(body: string | null | undefined, n = 140): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

/** メールアドレスの簡易妥当性チェック(空は許容=任意入力のため呼び出し側で判断)。 */
export function isValidEmail(addr: string | null | undefined): boolean {
  if (!addr) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
}
