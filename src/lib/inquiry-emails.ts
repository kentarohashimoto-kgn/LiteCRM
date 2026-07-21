/**
 * D-1b HP問い合わせフォーム由来メールの本文組み立て。
 * - clientAutoReply : 問い合わせ元クライアントへの自動返信(受付確認)
 * - internalNotify   : 社内関係者への新規問い合わせ通知
 *
 * いずれもプレーンテキスト + シンプルなHTMLの両方を返す(text/htmlマルチパート)。
 */

export interface InquiryFields {
  company: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string; // 流入詳細(種別/資料名。既定 "HP問合せ")
  media?: string; // 流入元メディア(カトルセHP/キャリプラ 等。任意)
}

/** HTMLエスケープ(メール本文にユーザー入力を差し込むため必須)。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 改行を <br> に(HTML本文用。エスケープ後に呼ぶこと)。 */
function nl2br(s: string): string {
  return s.replace(/\n/g, "<br>");
}

function orDash(s: string): string {
  return s.trim() === "" ? "—" : s;
}

/** 問い合わせ元クライアントへの自動返信(受付確認)。 */
export function buildClientAutoReply(f: InquiryFields, orgName: string): { subject: string; text: string; html: string } {
  const greetingName = f.name ? `${f.name} 様` : `${f.company || "ご担当者"} 様`;
  const subject = `【${orgName}】お問い合わせを受け付けました`;

  const text =
    `${greetingName}\n\n` +
    `この度は${orgName}へお問い合わせいただき、誠にありがとうございます。\n` +
    `以下の内容でお問い合わせを受け付けました。担当者より改めてご連絡いたします。\n` +
    `※本メールは送信専用アドレスから自動送信しています。ご返信いただいてもお答えできない場合があります。\n\n` +
    `──────────────────────\n` +
    `会社名 : ${orDash(f.company)}\n` +
    `お名前 : ${orDash(f.name)}\n` +
    `メール : ${orDash(f.email)}\n` +
    `電話   : ${orDash(f.phone)}\n` +
    `お問い合わせ内容:\n${orDash(f.message)}\n` +
    `──────────────────────\n\n` +
    `${orgName}`;

  const html =
    `<div style="font-family:sans-serif;line-height:1.7;color:#1a1a1a">` +
    `<p>${esc(greetingName)}</p>` +
    `<p>この度は${esc(orgName)}へお問い合わせいただき、誠にありがとうございます。<br>` +
    `以下の内容でお問い合わせを受け付けました。担当者より改めてご連絡いたします。</p>` +
    `<p style="color:#888;font-size:12px">※本メールは送信専用アドレスから自動送信しています。ご返信いただいてもお答えできない場合があります。</p>` +
    `<table style="border-collapse:collapse;margin:12px 0;font-size:14px">` +
    row("会社名", f.company) +
    row("お名前", f.name) +
    row("メール", f.email) +
    row("電話", f.phone) +
    `<tr><td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">お問い合わせ内容</td>` +
    `<td style="padding:6px 12px">${nl2br(esc(orDash(f.message)))}</td></tr>` +
    `</table>` +
    `<p style="margin-top:16px">${esc(orgName)}</p>` +
    `</div>`;

  return { subject, text, html };
}

/** 社内関係者への新規問い合わせ通知。leadUrl があれば CRM のリード詳細への導線を付ける。 */
export function buildInternalNotify(
  f: InquiryFields,
  orgName: string,
  leadUrl: string | null,
): { subject: string; text: string; html: string } {
  const subject = `【${f.source}】新規問い合わせ: ${f.company || f.name || "(会社名未入力)"}`;

  const text =
    `HPの問い合わせフォームから新しい問い合わせが届きました。\n\n` +
    (f.media ? `流入元 : ${f.media}\n` : "") +
    `流入詳細 : ${f.source}\n` +
    `会社名 : ${orDash(f.company)}\n` +
    `お名前 : ${orDash(f.name)}\n` +
    `メール : ${orDash(f.email)}\n` +
    `電話   : ${orDash(f.phone)}\n` +
    `内容   :\n${orDash(f.message)}\n\n` +
    (leadUrl ? `CRMで確認: ${leadUrl}\n\n` : "") +
    `※このリードは「対象外」に落とす/案件化するなど、CRMのリード画面でトリアージしてください。`;

  const html =
    `<div style="font-family:sans-serif;line-height:1.7;color:#1a1a1a">` +
    `<p><b>HPの問い合わせフォーム</b>から新しい問い合わせが届きました。</p>` +
    `<table style="border-collapse:collapse;margin:12px 0;font-size:14px">` +
    (f.media ? row("流入元", f.media) : "") +
    row("流入詳細", f.source) +
    row("会社名", f.company) +
    row("お名前", f.name) +
    row("メール", f.email) +
    row("電話", f.phone) +
    `<tr><td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">内容</td>` +
    `<td style="padding:6px 12px">${nl2br(esc(orDash(f.message)))}</td></tr>` +
    `</table>` +
    (leadUrl
      ? `<p><a href="${esc(leadUrl)}" style="display:inline-block;background:#008C8C;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px">CRMで確認する</a></p>`
      : "") +
    `<p style="color:#888;font-size:12px">※このリードは「対象外」に落とす/案件化するなど、CRMのリード画面でトリアージしてください。</p>` +
    `</div>`;

  return { subject, text, html };
}

function row(label: string, value: string): string {
  return (
    `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${esc(label)}</td>` +
    `<td style="padding:6px 12px">${esc(orDash(value))}</td></tr>`
  );
}
