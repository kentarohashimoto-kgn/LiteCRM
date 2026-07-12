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

/** タグ列として扱わない管理用フラグ列。 */
const SKIP_TAG_HEADERS = new Set(["Eightでつながっている人", "再データ化中の名刺", "'?'を含んだデータ"]);

/** パース済み2次元配列からヘッダー行のインデックスを検出（会社名＋氏名/姓がある行）。 */
export function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => c.trim());
    if (cells.includes("会社名") && (cells.includes("氏名") || cells.includes("姓"))) return i;
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
    if (row.includes("会社名") && (row.includes("氏名") || row.includes("姓"))) continue;
    const o: BusinessCardInput = { company_name: "", full_name: "" };
    const tags: string[] = [];
    for (let i = 0; i < headers.length && i < row.length; i++) {
      const h = headers[i].trim();
      const v = (row[i] ?? "").trim();
      if (!v) continue;
      const key = FIXED_HEADERS[h];
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
