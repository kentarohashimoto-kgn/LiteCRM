/**
 * リードのダウンロード(CSV)用フィールド定義と値の解決。
 * クライアント(列セレクタ・ラベル)とサーバー(CSV生成)で共有する。
 */
import { LEAD_DISPOSITION_MAP } from "@/lib/constants";

export interface ExportField { key: string; label: string }

export const EXPORT_FIELDS: ExportField[] = [
  { key: "company", label: "会社名" },
  { key: "company_norm", label: "会社名(正規化)" },
  { key: "contact_name", label: "氏名" },
  { key: "email", label: "メール" },
  { key: "phone", label: "電話(代表)" },
  { key: "mobile_phone", label: "携帯電話" },
  { key: "job_title", label: "役職" },
  { key: "department", label: "部署" },
  { key: "industry", label: "業種" },
  { key: "employee_size", label: "従業員規模" },
  { key: "prefecture", label: "都道府県" },
  { key: "event", label: "流入イベント" },
  { key: "disposition", label: "決着" },
  { key: "priority_score", label: "優先度スコア" },
  { key: "engagement_rank", label: "エンゲージランク" },
  { key: "engagement_score", label: "エンゲージスコア" },
  { key: "acquirer", label: "取得担当" },
  { key: "rank", label: "ランク" },
  { key: "tags", label: "タグ" },
  { key: "acquired_at", label: "獲得日" },
];

export const EXPORT_FIELD_MAP = Object.fromEntries(EXPORT_FIELDS.map((f) => [f.key, f]));

/** よく使う初期プリセット(保存が無い場合の候補)。 */
export const DEFAULT_EXPORT_PRESETS: { name: string; columns: string[] }[] = [
  { name: "メール配信(メアド・会社・氏名)", columns: ["email", "company", "contact_name"] },
  { name: "電話リスト", columns: ["company", "contact_name", "phone", "mobile_phone"] },
  { name: "フル", columns: EXPORT_FIELDS.map((f) => f.key) },
];

/** DBのリード行(snake_case)＋エンゲージから、指定キーの表示値を返す。 */
export function exportValue(
  key: string,
  lead: Record<string, unknown>,
  eng?: { rank?: string; score?: number },
): string {
  switch (key) {
    case "event": return String(lead.raw_event ?? "");
    case "disposition": return LEAD_DISPOSITION_MAP[String(lead.disposition ?? "")]?.label ?? String(lead.disposition ?? "");
    case "engagement_rank": return eng?.rank ?? "";
    case "engagement_score": return eng?.score != null ? String(eng.score) : "";
    case "contact_name": return String(lead.contact_name ?? "");
    default: {
      const v = lead[key];
      return v == null ? "" : String(v);
    }
  }
}

/** CSV 1セルのエスケープ。 */
export function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
