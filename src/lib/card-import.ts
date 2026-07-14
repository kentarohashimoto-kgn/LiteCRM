/**
 * 名刺取込（Eightエクスポート）の共通ロジック（クライアント/サーバー共用・純粋関数）。
 * EightのCSVはヘッダー行の前に説明行（生成日時・合計件数・注記）が入り、
 * 固定列（会社名〜名刺交換日）の後ろにユーザー定義のタグ列（展示会・交流会名）が
 * "1" フラグで並ぶ。ここではヘッダー行を自動検出し、固定列＋タグ列に正規化する。
 */

import { normCompany } from "@/lib/lead-import";

/** business_cards への取込1件分（サーバーアクションへ渡す形）。 */
export interface BusinessCardInput {
  company_name: string;
  department?: string;
  title?: string;
  full_name: string;
  last_name?: string;
  first_name?: string;
  email?: string;
  postal_code?: string;
  address?: string;
  tel_company?: string;
  tel_department?: string;
  tel_direct?: string;
  fax?: string;
  mobile_phone?: string;
  url?: string;
  exchanged_on?: string; // YYYY-MM-DD
  eight_connected?: boolean;
  rank?: string;
  memo?: string;
  tags?: string[];
}

/** Eightの固定列ヘッダー → 取込先フィールド。 */
const FIXED_HEADERS: Record<string, keyof BusinessCardInput> = {
  会社名: "company_name",
  部署名: "department",
  役職: "title",
  氏名: "full_name",
  姓: "last_name",
  名: "first_name",
  "e-mail": "email",
  "E-mail": "email",
  メール: "email",
  郵便番号: "postal_code",
  住所: "address",
  TEL会社: "tel_company",
  TEL部門: "tel_department",
  TEL直通: "tel_direct",
  Fax: "fax",
  FAX: "fax",
  携帯電話: "mobile_phone",
  URL: "url",
  名刺交換日: "exchanged_on",
  ランク: "rank",
  メモ: "memo",
};

/** 表記ゆれ吸収のためのヘッダー別名（正規化後キー → フィールド）。 */
const HEADER_ALIASES: [string, keyof BusinessCardInput][] = [
  ["交換日", "exchanged_on"],
  ["名刺交換", "exchanged_on"],
  ["eメール", "email"],
  ["mail", "email"],
  ["メールアドレス", "email"],
  ["ホームページ", "url"],
  ["web", "url"],
  ["携帯", "mobile_phone"],
  ["会社tel", "tel_company"],
  ["部門tel", "tel_department"],
  ["直通tel", "tel_direct"],
  ["電話", "tel_company"],
];

/**
 * ヘッダー照合用の正規化。NFKC(全角→半角)・小文字化・空白除去・各種ハイフンの統一。
 * これにより「ＴＥＬ会社」「e‑mail」「 URL 」等の表記ゆれも同じ列として扱える。
 * ※カタカナ長音「ー」(メール等)は変換しない。
 */
function normHeader(h: string): string {
  return h
    .normalize("NFKC")
    .replace(/[‐‑–—―−]/g, "-")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

/** 正規化ヘッダー → フィールドの索引（固定列＋別名）。 */
const NORM_HEADERS: Record<string, keyof BusinessCardInput> = (() => {
  const m: Record<string, keyof BusinessCardInput> = {};
  for (const [k, v] of Object.entries(FIXED_HEADERS)) m[normHeader(k)] = v;
  for (const [k, v] of HEADER_ALIASES) m[normHeader(k)] = v;
  return m;
})();

/** タグ列として扱わない管理用フラグ列。 */
const SKIP_TAG_HEADERS = new Set(["Eightでつながっている人", "再データ化中の名刺", "'?'を含んだデータ"]);

const isNameHeader = (c: string) => {
  const n = normHeader(c);
  return n === normHeader("氏名") || n === normHeader("姓");
};
const isCompanyHeader = (c: string) => normHeader(c) === normHeader("会社名");

/** パース済み2次元配列からヘッダー行のインデックスを検出（会社名＋氏名/姓がある行）。 */
export function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i];
    if (cells.some(isCompanyHeader) && cells.some(isNameHeader)) return i;
  }
  return -1;
}

function pdate(s?: string): string | undefined {
  const m = (s ?? "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return undefined;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}

/**
 * ヘッダー行＋データ行を BusinessCardInput[] へ変換。
 * 固定列は名前でマッピングし、未知のヘッダーは値が入っている場合にタグとして付与する。
 */
export function rowsToCardInputs(headers: string[], rows: string[][]): BusinessCardInput[] {
  const out: BusinessCardInput[] = [];
  for (const row of rows) {
    // Eightは複数名刺帳をつなげたエクスポートで途中にヘッダー行が再登場することがある
    if (row.some(isCompanyHeader) && row.some(isNameHeader)) continue;
    const o: BusinessCardInput = { company_name: "", full_name: "" };
    const tags: string[] = [];
    for (let i = 0; i < headers.length && i < row.length; i++) {
      const h = headers[i].trim();
      const v = (row[i] ?? "").trim();
      if (!v) continue;
      const key = NORM_HEADERS[normHeader(h)];
      if (key) {
        if (key === "exchanged_on") o.exchanged_on = pdate(v);
        else (o as unknown as Record<string, unknown>)[key] = v.slice(0, 500);
      } else if (h === "Eightでつながっている人") {
        o.eight_connected = v === "1";
      } else if (!SKIP_TAG_HEADERS.has(h)) {
        // タグ列: "1"フラグ形式ならヘッダー名を、値形式なら「ヘッダー:値」をタグにする
        tags.push(v === "1" ? h : `${h}:${v.slice(0, 60)}`);
      }
    }
    if (!o.full_name && (o.last_name || o.first_name)) {
      o.full_name = `${o.last_name ?? ""} ${o.first_name ?? ""}`.trim();
    }
    if (tags.length) o.tags = tags;
    // 会社名も氏名も無い行はスキップ（説明行・空行）
    if (!o.company_name && !o.full_name) continue;
    out.push(o);
  }
  return out;
}

/** 再取込時の重複排除キー。メール優先、無ければ 会社+氏名+交換日。 */
export function cardDedupKey(c: BusinessCardInput): string {
  const email = (c.email ?? "").trim().toLowerCase();
  const name = (c.full_name ?? "").replace(/[\s　]/g, "");
  if (email) return `e:${email}|${name}`;
  return `cn:${normCompany(c.company_name)}|${name}|${c.exchanged_on ?? ""}`;
}

/** 取込前のファイル内重複排除。 */
export function dedupCards(rows: BusinessCardInput[]): BusinessCardInput[] {
  const seen = new Set<string>();
  const out: BusinessCardInput[] = [];
  for (const r of rows) {
    const key = cardDedupKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
