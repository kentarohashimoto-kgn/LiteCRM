/**
 * メモ・議事録ページの純ロジック（DBアクセスなし・vitest対象）。
 * - タイトル/本文の正規化と上限
 * - 議事録テンプレート生成
 * - 録音の文字起こし完了時にページ本文へ反映するテキストの組み立て
 */

export const MEMO_MAX_TITLE = 200;
export const MEMO_MAX_BODY = 100_000;

export type MemoKind = "memo" | "minutes";

export const MEMO_KIND_LABEL: Record<MemoKind, string> = {
  memo: "メモ",
  minutes: "議事録",
};

export function isMemoKind(v: unknown): v is MemoKind {
  return v === "memo" || v === "minutes";
}

/** タイトルの正規化（空は「無題」、上限あり）。 */
export function normalizeMemoTitle(raw: unknown): string {
  const t = String(raw ?? "").trim().slice(0, MEMO_MAX_TITLE);
  return t || "無題";
}

/** 本文の正規化（上限あり。null/undefinedは空文字）。 */
export function normalizeMemoBody(raw: unknown): string {
  return String(raw ?? "").slice(0, MEMO_MAX_BODY);
}

/** 新規ページの初期タイトル。議事録は日付入り（date はJSTの Date を渡す）。 */
export function defaultMemoTitle(kind: MemoKind, jstNow: Date): string {
  if (kind === "minutes") {
    const y = jstNow.getUTCFullYear();
    const m = jstNow.getUTCMonth() + 1;
    const d = jstNow.getUTCDate();
    return `議事録 ${y}/${m}/${d}`;
  }
  return "無題";
}

/** 議事録の書き出しテンプレート（本文が空のときに挿入する）。 */
export function minutesTemplate(dateLabel: string): string {
  return [
    `日時: ${dateLabel}`,
    "参加者: ",
    "",
    "■ アジェンダ",
    "- ",
    "",
    "■ 決定事項",
    "- ",
    "",
    "■ TODO・ネクストアクション",
    "- ",
    "",
    "■ メモ",
    "",
  ].join("\n");
}

/**
 * 録音の文字起こし完了時、ページ本文が空なら反映するテキストを組み立てる。
 * 要約(AI議事録)を先頭に、全文を後ろに置く。どちらも無ければ null。
 */
export function buildTranscriptBody(input: { summary?: string | null; transcript?: string | null }): string | null {
  const summary = (input.summary ?? "").trim();
  const transcript = (input.transcript ?? "").trim();
  if (!summary && !transcript) return null;
  const parts: string[] = [];
  if (summary) parts.push("■ AI議事録（録音の自動要約）", summary);
  if (transcript) {
    if (parts.length) parts.push("");
    parts.push("■ 文字起こし全文", transcript);
  }
  return parts.join("\n").slice(0, MEMO_MAX_BODY);
}

/** 本文が「実質空」か（テンプレート挿入・文字起こし反映の判定に使う）。 */
export function isBlankBody(body: string | null | undefined): boolean {
  return !String(body ?? "").trim();
}
