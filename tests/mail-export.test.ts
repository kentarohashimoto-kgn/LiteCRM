/**
 * メール送信履歴のCSVダウンロード 回帰テスト。
 * 期間はJSTの日付で指定し「終了日を含む」ことと、CSVの値の作り方を固定する。
 */
import { describe, expect, it } from "vitest";
import {
  csvJstStamp, jstRangeToUtc, mailExportValue, mailRangePresets,
  MAIL_EXPORT_DEFAULT_COLUMNS, MAIL_EXPORT_FIELD_MAP, type MailHistoryRow,
} from "@/lib/mail-export";
import { csvCell } from "@/lib/lead-export";

const row: MailHistoryRow = {
  sentAt: "2026-07-30T05:26:00.000Z",   // 14:26 JST
  company: "株式会社サンプル",
  contact: "山田 太郎",
  email: "taro@example.com",
  subject: "【展示会お礼】ご来場ありがとうございました",
  status: "sent",
  sentVia: "smtp",
  errorText: null,
  openCount: 2,
  lastOpenedAt: "2026-07-30T06:00:00.000Z",
  clickCount: 1,
  lastClickedAt: null,
  replied: true,
  senderName: "橋本　健太郎",
  templateName: "展示会お礼",
  segmentTitle: "AIDX有明1日目",
  event: "202607_AIDX有明",
  unsubscribed: false,
};

describe("CSVの日時(JST・0埋め)", () => {
  it("UTCをJSTの YYYY/MM/DD HH:MM にする", () => {
    expect(csvJstStamp("2026-07-30T05:26:00.000Z")).toBe("2026/07/30 14:26");
  });
  it("日付をまたぐ変換", () => {
    // 2026-07-30 16:00 UTC = 2026-07-31 01:00 JST
    expect(csvJstStamp("2026-07-30T16:00:00.000Z")).toBe("2026/07/31 01:00");
  });
  it("空・不正値は空文字", () => {
    expect(csvJstStamp(null)).toBe("");
    expect(csvJstStamp("not-a-date")).toBe("");
  });
});

describe("期間指定(JST) → UTC範囲", () => {
  it("開始日はその日の0時(JST)", () => {
    expect(jstRangeToUtc("2026-07-30", undefined).gte).toBe("2026-07-29T15:00:00.000Z");
  });
  it("終了日は「その日を含む」ため翌日0時(JST)が排他的上限", () => {
    expect(jstRangeToUtc(undefined, "2026-07-30").lt).toBe("2026-07-30T15:00:00.000Z");
  });
  it("月末をまたいでも正しい", () => {
    expect(jstRangeToUtc("2026-07-31", "2026-07-31")).toEqual({
      gte: "2026-07-30T15:00:00.000Z", lt: "2026-07-31T15:00:00.000Z",
    });
  });
  it("未指定・不正な形式は範囲なし(=全期間)", () => {
    expect(jstRangeToUtc("", "")).toEqual({});
    expect(jstRangeToUtc("2026/07/30", "30-07-2026")).toEqual({});
  });
});

describe("セルの値", () => {
  it("要望の必須項目が出る", () => {
    expect(mailExportValue("company", row)).toBe("株式会社サンプル");
    expect(mailExportValue("contact", row)).toBe("山田 太郎");
    expect(mailExportValue("email", row)).toBe("taro@example.com");
    expect(mailExportValue("sent_at", row)).toBe("2026/07/30 14:26");
    expect(mailExportValue("status", row)).toBe("送信済み");
  });
  it("結果・送信方法は日本語ラベルに変換する", () => {
    expect(mailExportValue("status", { ...row, status: "failed" })).toBe("失敗");
    expect(mailExportValue("sent_via", row)).toBe("SMTP");
    expect(mailExportValue("sent_via", { ...row, sentVia: "gmail_api" })).toBe("Gmail");
  });
  it("未知のステータスはそのまま出す(情報を捨てない)", () => {
    expect(mailExportValue("status", { ...row, status: "bounced" })).toBe("bounced");
  });
  it("真偽値は空欄/ラベルで表す", () => {
    expect(mailExportValue("replied", row)).toBe("あり");
    expect(mailExportValue("replied", { ...row, replied: false })).toBe("");
    expect(mailExportValue("unsubscribed", { ...row, unsubscribed: true })).toBe("配信停止");
  });
  it("未設定の日時は空文字(ダッシュにしない=表計算で扱いやすく)", () => {
    expect(mailExportValue("last_clicked_at", row)).toBe("");
  });
  it("既定の列はすべて定義済み", () => {
    for (const c of MAIL_EXPORT_DEFAULT_COLUMNS) expect(MAIL_EXPORT_FIELD_MAP[c]).toBeTruthy();
  });
});

describe("CSVエスケープ", () => {
  it("カンマ・引用符を含む件名を壊さない", () => {
    const s = mailExportValue("subject", { ...row, subject: 'AI導入,研修の"ご案内"' });
    expect(csvCell(s)).toBe('"AI導入,研修の""ご案内"""');
  });
});

describe("期間プリセット", () => {
  // 2026-07-30 05:00 UTC = 14:00 JST(木)
  const now = Date.parse("2026-07-30T05:00:00.000Z");
  it("今日は開始=終了=当日(JST)", () => {
    const p = mailRangePresets(now).find((x) => x.key === "today")!;
    expect(p.from).toBe("2026-07-30");
    expect(p.to).toBe("2026-07-30");
  });
  it("過去7日は当日を含む7日間", () => {
    const p = mailRangePresets(now).find((x) => x.key === "7d")!;
    expect(p.from).toBe("2026-07-24");
    expect(p.to).toBe("2026-07-30");
  });
  it("今月は月初から当日まで", () => {
    const p = mailRangePresets(now).find((x) => x.key === "this_month")!;
    expect(p.from).toBe("2026-07-01");
    expect(p.to).toBe("2026-07-30");
  });
  it("先月は前月の1日〜末日", () => {
    const p = mailRangePresets(now).find((x) => x.key === "last_month")!;
    expect(p.from).toBe("2026-06-01");
    expect(p.to).toBe("2026-06-30");
  });
  it("JSTで日付が変わる深夜も当日判定が正しい", () => {
    // 2026-07-30 16:00 UTC = 2026-07-31 01:00 JST
    const p = mailRangePresets(Date.parse("2026-07-30T16:00:00.000Z")).find((x) => x.key === "today")!;
    expect(p.from).toBe("2026-07-31");
  });
});
