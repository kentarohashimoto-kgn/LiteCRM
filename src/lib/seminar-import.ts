/**
 * セミナー取込のフィールド定義・正規化。リードとは別フォーマット(アンケート項目を含む)。
 * パース系(parseDelimited/detectDelim)は lead-import を再利用する。
 */
import { normCompany } from "@/lib/lead-import";

export interface SeminarInput {
  company?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  employee_size?: string;
  responded_at?: string;
  satisfaction?: string;
  satisfaction_reason?: string;
  understanding?: string;
  challenges?: string;
  ai_usage?: string;
  follow_up?: string;
  comment?: string;
  consent?: string;
}

export const SEMINAR_TARGET_FIELDS: { key: keyof SeminarInput; label: string; required?: boolean; hints: string[] }[] = [
  { key: "company", label: "会社名", required: true, hints: ["会社", "法人", "組織", "company", "企業", "勤務先"] },
  { key: "contact_name", label: "氏名", hints: ["氏名", "お名前", "name", "参加者", "担当者"] },
  { key: "email", label: "メール", hints: ["メール", "mail", "email", "e-mail"] },
  { key: "phone", label: "電話", hints: ["電話", "tel", "phone", "携帯"] },
  { key: "job_title", label: "役職", hints: ["役職", "title", "position", "肩書"] },
  { key: "employee_size", label: "従業員規模", hints: ["従業員", "規模", "人数", "size"] },
  { key: "responded_at", label: "回答日時", hints: ["日時", "タイムスタンプ", "timestamp", "回答日", "送信"] },
  { key: "satisfaction", label: "満足度(数値)", hints: ["満足", "satisfaction", "総合評価"] },
  { key: "satisfaction_reason", label: "満足度の理由", hints: ["満足.*理由", "理由"] },
  { key: "understanding", label: "理解度(数値)", hints: ["理解", "understanding", "わかり"] },
  { key: "challenges", label: "課題", hints: ["課題", "悩み", "challenge", "困っ"] },
  { key: "ai_usage", label: "AI活用度", hints: ["活用", "ai", "生成ai", "利用状況"] },
  { key: "follow_up", label: "希望フォロー", hints: ["フォロー", "希望", "follow", "今後", "資料"] },
  { key: "comment", label: "感想・コメント", hints: ["感想", "コメント", "自由", "comment", "ご意見"] },
  { key: "consent", label: "個人情報同意", hints: ["同意", "consent", "承諾"] },
];

export function suggestSeminarMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of SEMINAR_TARGET_FIELDS) {
    const hit = headers.find((h) => {
      if (used.has(h)) return false;
      const hl = h.toLowerCase();
      return f.hints.some((kw) => new RegExp(kw, "i").test(hl) || h.includes(kw));
    });
    if (hit) { map[f.key as string] = hit; used.add(hit); }
  }
  return map;
}

export function rowToSeminarInput(headers: string[], row: string[], mapping: Record<string, string>): SeminarInput {
  const get = (key: string) => {
    const h = mapping[key];
    if (!h) return "";
    const i = headers.indexOf(h);
    return i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";
  };
  const o: SeminarInput = {};
  for (const f of SEMINAR_TARGET_FIELDS) {
    const v = get(f.key as string);
    if (v) (o as Record<string, string>)[f.key as string] = v;
  }
  return o;
}

/** "5","★4","4点" などから 1-5 を抽出。 */
function parseScore(s?: string): number | null {
  const m = (s ?? "").match(/[1-5]/);
  return m ? parseInt(m[0], 10) : null;
}
function parseConsent(s?: string): boolean | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  return /同意|はい|yes|true|承諾|ok|✓|可/i.test(v);
}
function parseDate(s?: string): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const d = new Date(v.replace(/\//g, "-"));
  return isNaN(+d) ? null : d.toISOString();
}

/** SeminarInput を seminar_responses レコードへ正規化。 */
export function normalizeSeminar(
  r: SeminarInput,
  opts: { tenantId: string; campaignId?: string | null; seminarName: string; eventDate?: string | null },
): Record<string, unknown> {
  const company = (r.company ?? "").trim();
  const t = (v?: string) => { const s = (v ?? "").trim(); return s === "" ? null : s.slice(0, 2000); };
  return {
    tenant_id: opts.tenantId,
    campaign_id: opts.campaignId ?? null,
    seminar_name: opts.seminarName,
    responded_at: parseDate(r.responded_at) ?? (opts.eventDate ? opts.eventDate + "T00:00:00+09:00" : new Date().toISOString()),
    email: t(r.email)?.toLowerCase() ?? null,
    name: t(r.contact_name),
    company: t(company),
    company_norm: normCompany(company),
    phone: t(r.phone),
    employee_size: t(r.employee_size),
    job_title: t(r.job_title),
    satisfaction: parseScore(r.satisfaction),
    satisfaction_reason: t(r.satisfaction_reason),
    understanding: parseScore(r.understanding),
    challenges: t(r.challenges),
    ai_usage: t(r.ai_usage),
    follow_up: t(r.follow_up),
    comment: t(r.comment),
    consent: parseConsent(r.consent),
  };
}

/** メール基準で重複回答を集約(同一人物の二重送信対策)。 */
export function dedupSeminar(rows: SeminarInput[]): SeminarInput[] {
  const seen = new Set<string>();
  const out: SeminarInput[] = [];
  for (const r of rows) {
    const key = (r.email ?? "").trim().toLowerCase() || `${(r.company ?? "").trim()}|${(r.contact_name ?? "").trim()}`;
    if (!key || key === "|") { out.push(r); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
