/**
 * メール送信履歴のダウンロード(CSV)用フィールド定義 — 純粋ロジック。
 * クライアント(列の選択・ラベル)とサーバー(CSV生成)で共有する。
 *
 * 宛先の会社名・担当者名はメール自体には持たないため、紐づくリード
 * (lead_id) → 取引先担当者(contact_id) → 顧客(account_id) の順に解決した値を
 * サーバー側で MailHistoryRow に詰めてから、ここで文字列化する。
 */

export interface MailHistoryRow {
  sentAt: string | null;
  company: string;
  contact: string;
  email: string;
  subject: string | null;
  status: string;
  sentVia: string | null;
  errorText: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  replied: boolean;
  senderName: string;
  templateName: string;
  segmentTitle: string;
  event: string;
  unsubscribed: boolean;
}

export const MAIL_STATUS_LABEL: Record<string, string> = {
  sent: "送信済み", queued: "送信中", failed: "失敗", logged: "記録のみ",
};

export const MAIL_VIA_LABEL: Record<string, string> = {
  smtp: "SMTP", gmail_api: "Gmail", manual: "手動記録",
};

export interface MailExportField { key: string; label: string }

/** 既定は「誰にいつ送って、どうなったか」。先頭4つはユーザー要望の必須項目。 */
export const MAIL_EXPORT_FIELDS: MailExportField[] = [
  { key: "company", label: "会社名" },
  { key: "contact", label: "担当者名" },
  { key: "email", label: "メールアドレス" },
  { key: "sent_at", label: "送信日時" },
  { key: "status", label: "結果" },
  { key: "subject", label: "件名" },
  { key: "error_text", label: "エラー内容" },
  { key: "open_count", label: "開封回数" },
  { key: "last_opened_at", label: "最終開封日時" },
  { key: "click_count", label: "クリック回数" },
  { key: "last_clicked_at", label: "最終クリック日時" },
  { key: "replied", label: "返信あり" },
  { key: "sender", label: "送信者" },
  { key: "template", label: "テンプレート" },
  { key: "segment", label: "セグメント(一括送信名)" },
  { key: "event", label: "流入元" },
  { key: "sent_via", label: "送信方法" },
  { key: "unsubscribed", label: "配信停止済み" },
];

export const MAIL_EXPORT_FIELD_MAP = Object.fromEntries(MAIL_EXPORT_FIELDS.map((f) => [f.key, f]));

/** 既定で出力する列(要望の5項目＋反応)。 */
export const MAIL_EXPORT_DEFAULT_COLUMNS = [
  "company", "contact", "email", "sent_at", "status", "subject", "open_count", "click_count",
];

/**
 * CSV用のJST日時 "YYYY/MM/DD HH:MM"。
 * 表計算ソフトで並べ替えできるよう0埋めする(画面表示用の formatDateTimeJst とは別)。
 */
export function csvJstStamp(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

/** 1セル分の値を文字列にする。 */
export function mailExportValue(key: string, r: MailHistoryRow): string {
  switch (key) {
    case "company": return r.company;
    case "contact": return r.contact;
    case "email": return r.email;
    case "sent_at": return csvJstStamp(r.sentAt);
    case "status": return MAIL_STATUS_LABEL[r.status] ?? r.status;
    case "subject": return r.subject ?? "";
    case "error_text": return r.errorText ?? "";
    case "open_count": return String(r.openCount ?? 0);
    case "last_opened_at": return csvJstStamp(r.lastOpenedAt);
    case "click_count": return String(r.clickCount ?? 0);
    case "last_clicked_at": return csvJstStamp(r.lastClickedAt);
    case "replied": return r.replied ? "あり" : "";
    case "sender": return r.senderName;
    case "template": return r.templateName;
    case "segment": return r.segmentTitle;
    case "event": return r.event;
    case "sent_via": return r.sentVia ? (MAIL_VIA_LABEL[r.sentVia] ?? r.sentVia) : "";
    case "unsubscribed": return r.unsubscribed ? "配信停止" : "";
    default: return "";
  }
}

/**
 * 期間指定(JSTの日付)をUTCの範囲に変換する。
 * to は「その日を含む」ため翌日0時(JST)を排他的上限として返す。
 */
export function jstRangeToUtc(from?: string | null, to?: string | null): { gte?: string; lt?: string } {
  const out: { gte?: string; lt?: string } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    out.gte = new Date(`${from}T00:00:00+09:00`).toISOString();
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const d = new Date(`${to}T00:00:00+09:00`);
    d.setUTCDate(d.getUTCDate() + 1);
    out.lt = d.toISOString();
  }
  return out;
}

/** 期間プリセット(JSTの今日を基準)。画面のボタン用。 */
export function mailRangePresets(nowMs: number): { key: string; label: string; from: string; to: string }[] {
  const jstToday = new Date(nowMs + 9 * 3600 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const today = ymd(jstToday);
  const daysAgo = (n: number) => { const d = new Date(jstToday); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = new Date(`${monthStart}T00:00:00Z`);
  prevMonthEnd.setUTCDate(0);
  const prevMonthStart = `${ymd(prevMonthEnd).slice(0, 7)}-01`;
  return [
    { key: "today", label: "今日", from: today, to: today },
    { key: "7d", label: "過去7日", from: daysAgo(6), to: today },
    { key: "30d", label: "過去30日", from: daysAgo(29), to: today },
    { key: "this_month", label: "今月", from: monthStart, to: today },
    { key: "last_month", label: "先月", from: prevMonthStart, to: ymd(prevMonthEnd) },
  ];
}
