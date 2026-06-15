/**
 * リード取込の共通ロジック(クライアント/サーバー共用・純粋関数)。
 * 元データの形式は毎回変わりうるため、列マッピング方式で正規化する。
 */

/** 取込先のリード項目。company は必須、他は任意。 */
export interface RawLeadInput {
  company?: string;
  contact_name?: string;
  last_name?: string;
  first_name?: string;
  email?: string;
  phone?: string;
  mobile_phone?: string;
  department?: string;
  job_title?: string;
  industry?: string;
  employee_size?: string;
  prefecture?: string;
  rank?: string;
  disposition?: string;
  call_owner?: string;
  deal_owner?: string;
  acquirer?: string;
  tags?: string;
  memo?: string;
  scanned_at?: string;
  /** 追加(任意)マッピングの拡張フィールド */
  extra?: Record<string, string>;
}

/** 優先度の必須項目の選択肢(編集UI・スコア用)。 */
export const ROLE_LEVELS = [
  { key: "exec", label: "代表", pts: 20 },
  { key: "officer", label: "役員", pts: 20 },
  { key: "manager", label: "管理職", pts: 10 },
  { key: "staff", label: "一般", pts: 0 },
];
export const NEEDS_OPTS = [
  { key: "high", label: "具体的に興味", pts: 20 },
  { key: "mid", label: "関心あり", pts: 10 },
  { key: "low", label: "低い/不明", pts: 0 },
];
export const TIMING_OPTS = [
  { key: "now", label: "すぐ導入したい", pts: 20 },
  { key: "soon", label: "数ヶ月以内", pts: 10 },
  { key: "unknown", label: "未定", pts: 0 },
];
export const AUTHORITY_OPTS = [
  { key: "decider", label: "決裁/主担当", pts: 20 },
  { key: "influencer", label: "影響あり", pts: 10 },
  { key: "none", label: "担当外", pts: 0 },
];
export const BUDGET_OPTS = [
  { key: "yes", label: "予算あり", pts: 20 },
  { key: "considering", label: "検討中", pts: 10 },
  { key: "no", label: "なし/不明", pts: 0 },
];
export const REVENUE_OPTS = [
  { key: "xl", label: "1000億円〜", pts: 20 },
  { key: "l", label: "100〜1000億円", pts: 15 },
  { key: "m", label: "10〜100億円", pts: 10 },
  { key: "s", label: "1〜10億円", pts: 5 },
  { key: "xs", label: "〜1億円", pts: 0 },
];
const optPts = (opts: { key: string; pts: number }[], v?: string | null) => opts.find((o) => o.key === v)?.pts ?? 0;

/** TSV/CSVを区切りで2次元配列にパース(クォート対応)。 */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/** 先頭行からタブ/カンマ区切りを推定。 */
export function detectDelim(text: string): string {
  const fl = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  return fl.split("\t").length > fl.split(",").length ? "\t" : ",";
}

/** ヘッダー＋マッピングから1行を RawLeadInput に変換。 */
export function rowToRawInput(
  headers: string[],
  row: string[],
  mapping: Record<string, string>,
  customFields: { key: string; header: string }[] = [],
): RawLeadInput {
  const get = (key: string) => {
    const h = mapping[key];
    if (!h) return "";
    const i = headers.indexOf(h);
    return i >= 0 && i < row.length ? row[i] : "";
  };
  const o: RawLeadInput = {};
  for (const f of TARGET_FIELDS) {
    const v = get(f.key as string);
    if (v) (o as Record<string, string>)[f.key as string] = v;
  }
  const extra: Record<string, string> = {};
  for (const cf of customFields) {
    if (!cf.key || !cf.header) continue;
    const i = headers.indexOf(cf.header);
    const v = i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";
    if (v) extra[cf.key] = v;
  }
  if (Object.keys(extra).length) o.extra = extra;
  return o;
}

/**
 * 同一人物の重複行を1件に集約。展示会では同じ人を複数回スキャンする/
 * 同じファイルを再取込するなどで重複が発生するため、取込前に名寄せする。
 * キー: メール(小文字)優先。メールが無い行は 会社+氏名+電話 で判定。
 */
export function dedupLeads(rows: RawLeadInput[]): RawLeadInput[] {
  const seen = new Set<string>();
  const out: RawLeadInput[] = [];
  for (const r of rows) {
    const email = (r.email ?? "").trim().toLowerCase();
    const name = (r.contact_name ?? `${r.last_name ?? ""}${r.first_name ?? ""}`).trim();
    const key = email || `${(r.company ?? "").trim()}|${name}|${(r.phone ?? r.mobile_phone ?? "").trim()}`;
    if (!key || key === "||") { out.push(r); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** マッピングUIで選べる取込先フィールド定義(自動サジェスト用キーワードつき)。 */
export const TARGET_FIELDS: { key: keyof RawLeadInput; label: string; required?: boolean; hints: string[] }[] = [
  { key: "company", label: "会社名", required: true, hints: ["会社", "法人", "組織", "company", "得意先", "企業"] },
  { key: "contact_name", label: "氏名(姓名まとめ)", hints: ["氏名", "お名前", "name", "担当者名", "来場者名"] },
  { key: "last_name", label: "姓", hints: ["姓", "名前：姓", "lastname"] },
  { key: "first_name", label: "名", hints: ["名", "名前：名", "firstname"] },
  { key: "email", label: "メール", hints: ["メール", "mail", "email", "e-mail"] },
  { key: "phone", label: "電話(代表)", hints: ["電話", "tel", "phone", "代表電話", "固定"] },
  { key: "mobile_phone", label: "携帯電話", hints: ["携帯", "mobile", "携帯番号", "携帯電話"] },
  { key: "department", label: "部署", hints: ["部署", "部門", "department"] },
  { key: "job_title", label: "役職", hints: ["役職", "title", "役職名"] },
  { key: "industry", label: "業種", hints: ["業種", "industry"] },
  { key: "employee_size", label: "従業員規模", hints: ["従業員", "規模", "社員数", "従業員規模"] },
  { key: "prefecture", label: "都道府県", hints: ["都道府県", "県", "pref"] },
  { key: "rank", label: "ランク/優先順位", hints: ["ランク", "rank", "優先順位", "優先", "判定"] },
  { key: "disposition", label: "決着/ステータス", hints: ["決着", "ステータス", "状態", "対応状況"] },
  { key: "call_owner", label: "架電担当(対応)", hints: ["対応", "架電担当", "コール担当"] },
  { key: "deal_owner", label: "商談担当", hints: ["商談担当", "営業担当", "担当"] },
  { key: "acquirer", label: "取得担当(ブース読取)", hints: ["担当者の氏名", "読取担当", "端末名", "スキャン担当", "取得担当", "acquirer"] },
  { key: "tags", label: "タグ/興味", hints: ["タグ", "tag", "商談希望度", "興味", "関心"] },
  { key: "memo", label: "メモ/備考", hints: ["メモ", "備考", "コメント", "議事", "理由", "課題"] },
  { key: "scanned_at", label: "取得日/来場日", hints: ["スキャン", "来場", "日時", "タイムスタンプ", "取得日", "登録日"] },
];

/** 施策区分(優先度の基礎点)。展示会管理表の区分→優先度に準拠(S50/A40/B30/C20)。 */
export const LEAD_KINDS: { key: string; label: string; base: number }[] = [
  { key: "inquiry", label: "問い合わせ", base: 50 },
  { key: "outbound_form", label: "アウトバウンド(フォーム)", base: 40 },
  { key: "matching_rm", label: "マッチング(レディクル)", base: 40 },
  { key: "seminar", label: "セミナー", base: 40 },
  { key: "existing", label: "既契約者", base: 40 },
  { key: "exhibition", label: "展示会", base: 30 },
  { key: "outbound_call", label: "アウトバウンド(コール)", base: 30 },
  { key: "matching_bt", label: "マッチング(BT)", base: 30 },
  { key: "sns", label: "SNS", base: 30 },
  { key: "media", label: "メディア/ポータル", base: 30 },
  { key: "networking", label: "交流会", base: 20 },
  { key: "alliance", label: "アライアンス", base: 20 },
  { key: "other", label: "その他", base: 20 },
];

/** ヘッダー名から取込先フィールドを推測(自動マッピング)。 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of TARGET_FIELDS) {
    const hit = headers.find((h) => {
      const hl = h.toLowerCase();
      return !used.has(h) && f.hints.some((k) => hl.includes(k.toLowerCase()));
    });
    if (hit) {
      map[f.key as string] = hit;
      used.add(hit);
    }
  }
  return map;
}

export function normCompany(c?: string): string {
  let s = (c ?? "").trim();
  // 法人格を除去(㈱㈲などの合字グリフ・全角括弧含む)。
  s = s.replace(/(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|学校法人|\(株\)|（株）|\(有\)|（有）|株\)|㈱|㈲)/g, "");
  return s.replace(/[\s　]/g, "").trim();
}

/**
 * 決着の判定は「決着」列の手入力値のみを正とする(人が手動でのみ更新するルール)。
 * 列が空白なら未決着(untouched)。架電担当/商談担当からの推測は行わない。
 */
export function normDisposition(raw?: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "untouched";
  if (s.includes("①") || /お断り|断り|NG/i.test(s)) return "ng";
  if (s.includes("②") || /架電中|実行中/.test(s)) return "calling";
  if (s.includes("③") || /継続/.test(s)) return "continuing";
  if (s.includes("④") || /不通|留守/.test(s)) return "no_answer";
  if (s.includes("⑤") || /アポ/.test(s)) return "appointment";
  if (/対象外|除外/.test(s) || s === "X") return "excluded";
  return "untouched";
}

export function normRank(raw?: string): { rank: string | null; excluded: boolean } {
  const s = (raw ?? "").trim().toUpperCase();
  if (["S", "A", "B", "C", "D"].includes(s)) return { rank: s, excluded: false };
  if (s === "X" || s.includes("対象外")) return { rank: null, excluded: true };
  return { rank: null, excluded: false };
}

function rolePts(t?: string): number {
  const s = t ?? "";
  if (/社長|代表|CEO|会長|役員|取締役/.test(s)) return 20;
  if (/本部長|部長|次長|部門長/.test(s)) return 10;
  return 0;
}
function sizePts(s?: string): number {
  const nums = (s ?? "").match(/[\d,]+/g)?.map((x) => parseInt(x.replace(/,/g, ""), 10)) ?? [];
  const m = nums.length ? Math.max(...nums) : 0;
  return m >= 1000 ? 20 : m >= 300 ? 10 : 0;
}
/** 役職テキストから役職区分(role_level)を推定。 */
export function deriveRoleLevel(jobTitle?: string): string {
  const s = jobTitle ?? "";
  if (/社長|代表|CEO|会長/.test(s)) return "exec";
  if (/役員|取締役|本部長|総括/.test(s)) return "officer";
  if (/部長|次長|課長|マネージャ|係長|主任|チーフ|部門長/.test(s)) return "manager";
  return "staff";
}

export interface ScoreFields {
  employee_size?: string | null;
  revenue_size?: string | null;
  role_level?: string | null;
  job_title?: string | null;
  needs?: string | null;
  timing?: string | null;
  authority?: string | null;
  budget_band?: string | null;
}

/** 優先度スコア＝区分(base)＋規模×役職×ニーズ×時期×権限×予算の各点の合計。 */
export function priorityScore(base: number, f: ScoreFields): number {
  const sizePt = Math.max(sizePts(f.employee_size ?? ""), optPts(REVENUE_OPTS, f.revenue_size));
  const role = f.role_level ? optPts(ROLE_LEVELS, f.role_level) : rolePts(f.job_title ?? "");
  return base + sizePt + role + optPts(NEEDS_OPTS, f.needs) + optPts(TIMING_OPTS, f.timing) + optPts(AUTHORITY_OPTS, f.authority) + optPts(BUDGET_OPTS, f.budget_band);
}

function pdate(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}
/** 日付＋時刻(あれば)をJSTのISOで返す。時間帯分析のため時刻を保持。 */
function pdatetime(s?: string): string | null {
  const d = pdate(s);
  if (!d) return null;
  const tm = (s ?? "").match(/(\d{1,2}):(\d{2})/);
  return tm ? `${d}T${String(+tm[1]).padStart(2, "0")}:${tm[2]}:00+09:00` : `${d}T00:00:00+09:00`;
}

/** RawLeadInput を leads テーブルのレコードへ正規化。 */
export function normalizeLead(
  r: RawLeadInput,
  opts: { tenantId: string; campaignId?: string | null; leadSourceId?: string | null; rawEvent: string; base: number; eventDate?: string | null; acquiredDate?: string | null; importBatchId?: string | null },
): Record<string, unknown> {
  const company = (r.company ?? "").trim();
  // 姓・名は別管理。明示があればそれを、無ければ氏名を空白で分割して推定。
  let lastName = (r.last_name ?? "").trim();
  let firstName = (r.first_name ?? "").trim();
  const fullRaw = (r.contact_name ?? "").trim();
  if (!lastName && !firstName && fullRaw) {
    const parts = fullRaw.split(/[\s　]+/).filter(Boolean);
    if (parts.length >= 2) { lastName = parts[0]; firstName = parts.slice(1).join(" "); }
  }
  const name = fullRaw || `${lastName} ${firstName}`.trim();
  const { rank, excluded } = normRank(r.rank);
  let disposition = normDisposition(r.disposition);
  if (excluded) disposition = "excluded";
  const status = disposition === "appointment" ? "qualified" : disposition === "ng" || disposition === "excluded" ? "disqualified" : "new";
  const roleLevel = deriveRoleLevel(r.job_title);
  const score = priorityScore(opts.base, { employee_size: r.employee_size, role_level: roleLevel });
  const scanned = pdatetime(r.scanned_at);
  // 獲得日の優先: 行ごとのスキャン日 > 取込時に指定した獲得年月 > 施策(campaign)開催日 > 当日
  const acquired = (scanned ? scanned.slice(0, 10) : null) ?? opts.acquiredDate ?? opts.eventDate ?? new Date().toISOString().slice(0, 10);
  const t = (v?: string) => {
    const s = (v ?? "").trim();
    return s === "" ? null : s.slice(0, 300);
  };
  return {
    tenant_id: opts.tenantId,
    campaign_id: opts.campaignId ?? null,
    lead_source_id: opts.leadSourceId ?? null,
    status,
    rank,
    disposition,
    priority_base: opts.base,
    priority_score: score,
    role_level: roleLevel,
    call_owner: t(r.call_owner),
    deal_owner_name: t(r.deal_owner),
    acquirer: t(r.acquirer),
    company_name: t(company),
    company_norm: normCompany(company),
    title: (company + " / " + opts.rawEvent).slice(0, 200),
    contact_name: t(name),
    last_name: t(lastName),
    first_name: t(firstName),
    email: t(r.email),
    phone: t(r.phone),
    mobile_phone: t(r.mobile_phone),
    department: t(r.department),
    job_title: t(r.job_title),
    industry: t(r.industry),
    employee_size: t(r.employee_size),
    prefecture: t(r.prefecture),
    tags: t(r.tags),
    notes: t(r.memo),
    raw_event: opts.rawEvent,
    import_batch_id: opts.importBatchId ?? null,
    extra: r.extra ?? {},
    acquired_at: acquired,
    scanned_at: scanned,
  };
}
