/**
 * 商談(案件)取込ロジック: Notion「商談ヨミ表」CSVエクスポート → CATORCE案件。
 * パース/復号/ヘッダ一意化は lead-import を再利用。全置換(import_source='notion_yomi')前提。
 */
import { parseDelimited, detectDelim, decodeFileText, uniquifyHeaders } from "@/lib/lead-import";

export { parseDelimited, detectDelim, decodeFileText, uniquifyHeaders };

/** 取込先フィールド(Notionプロパティ名に一致)。 */
export const DEAL_FIELDS: { key: string; label: string; hints: string[]; required?: boolean }[] = [
  { key: "company", label: "得意先(会社名)", hints: ["得意先", "会社", "顧客", "企業"], required: true },
  { key: "yomi", label: "ヨミ", hints: ["ヨミ", "よみ", "確度"] },
  { key: "product", label: "製品群", hints: ["製品群", "製品", "商品"] },
  { key: "source", label: "アポソース(流入元)", hints: ["アポソース", "流入", "ソース"] },
  { key: "detail", label: "詳細(展示会/施策)", hints: ["詳細", "施策", "展示会"] },
  { key: "owner", label: "担当", hints: ["担当"] },
  { key: "sales", label: "売上(受注金額)", hints: ["売上", "受注金額", "金額"] },
  { key: "fsales", label: "見込売上", hints: ["見込売上", "見込み売上"] },
  { key: "expMonth", label: "見込月", hints: ["見込月", "見込み月"] },
  { key: "wonDate", label: "受注日", hints: ["受注日"] },
  { key: "salesMonth", label: "売上月", hints: ["売上月"] },
  { key: "firstMeeting", label: "初回営業日", hints: ["初回営業日", "初回商談日", "初回"] },
  { key: "nextAcDate", label: "次回AC日", hints: ["次回AC日", "次回アクション日", "次回ac"] },
  { key: "nextAcText", label: "次回アクション内容", hints: ["次回アクション内容", "次回アクション"] },
  { key: "monthly", label: "月額単価", hints: ["月額単価", "月額"] },
  { key: "emp", label: "従業員数", hints: ["従業員数", "従業員"] },
  { key: "scale", label: "規模", hints: ["規模"] },
  { key: "lostReason", label: "失注・定期追い理由", hints: ["失注", "定期追い理由", "失注理由"] },
  { key: "memo", label: "メモ(事前情報)", hints: ["メモ", "備考"] },
  { key: "minutes", label: "議事録(まとめ)", hints: ["議事録"] },
  { key: "proposal", label: "提案", hints: ["提案"] },
];

export function suggestDealMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  // パス1: 完全一致を優先(「初回営業日」が「初回商談月」より、「見込月」が「売上見込月」より先に確定する)
  for (const f of DEAL_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.hints.some((k) => h === k));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  // パス2: 残りを部分一致で補完
  for (const f of DEAL_FIELDS) {
    if (map[f.key]) continue;
    const hit = headers.find((h) => {
      if (used.has(h)) return false;
      const hl = h.toLowerCase();
      return f.hints.some((k) => hl.includes(k.toLowerCase()) || h.includes(k));
    });
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

export interface DealRow {
  rowKey: string; // クライアント生成の一意キー(議事録ひも付け用)
  company?: string; yomi?: string; product?: string; source?: string; detail?: string; owner?: string;
  sales?: string; fsales?: string; expMonth?: string; wonDate?: string; salesMonth?: string;
  firstMeeting?: string; nextAcDate?: string; nextAcText?: string; monthly?: string; emp?: string; scale?: string;
  lostReason?: string; memo?: string; minutes?: string; proposal?: string;
}

export function rowToDealRow(headers: string[], row: string[], mapping: Record<string, string>, rowKey: string): DealRow {
  const get = (key: string) => {
    const h = mapping[key];
    if (!h) return "";
    const i = headers.indexOf(h);
    return i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";
  };
  const o: DealRow = { rowKey };
  for (const f of DEAL_FIELDS) {
    const v = get(f.key);
    if (v) (o as unknown as Record<string, string>)[f.key] = v;
  }
  return o;
}

/** ヨミ → ステージ/ステータス/予測区分/確度。既存612件の慣習に合わせる。 */
export function yomiToFields(yomi?: string): { stage: string; status: string; forecast: string; probability: number } {
  const y = (yomi ?? "").trim();
  if (y.startsWith("0")) return { stage: "won", status: "won", forecast: "commit", probability: 100 };
  if (y.startsWith("1")) return { stage: "internal_review", status: "open", forecast: "commit", probability: 80 };
  if (y.startsWith("2")) return { stage: "proposal_sent", status: "open", forecast: "best_case", probability: 50 };
  if (y.startsWith("3")) return { stage: "meeting_done", status: "open", forecast: "pipeline", probability: 30 };
  if (y.startsWith("4")) return { stage: "meeting_scheduled", status: "open", forecast: "pipeline", probability: 20 };
  if (y.startsWith("5")) return { stage: "meeting_scheduled", status: "open", forecast: "upside", probability: 10 };
  if (y.startsWith("6")) return { stage: "meeting_done", status: "open", forecast: "upside", probability: 10 };
  if (y.startsWith("7")) return { stage: "lost", status: "lost", forecast: "omitted", probability: 0 };
  if (y.startsWith("8")) return { stage: "lost", status: "lost", forecast: "omitted", probability: 0 };
  if (y.startsWith("9")) return { stage: "meeting_scheduled", status: "open", forecast: "pipeline", probability: 15 };
  return { stage: "lead_acquired", status: "open", forecast: "pipeline", probability: 5 };
}

/** 展示会タイプの「詳細」を YYYYMM_展示会名(リード側raw_event)へ統一。非展示会はそのまま。 */
const EXHIBITION_CANON: Record<string, string> = {
  "20260610_AINATIVEEXPO": "202606_AIEXPO幕張",
  "20250730_産業DX": "202507_産業DX総合展（ビッグサイト）",
  "20260225_AI World春": "202602_AIWorld",
  "20260513_ODEX": "202605_ODEX",
  "20260324_AIDX営業マーケティング展": "202603_AIDX営業マーケ",
  "20250917_生成AIワールド": "202509_生成AIワールド（幕張）",
  "20260204_バックオフィスWorld": "202602_バックオフィスW",
  "20251022_StartupJapanSummit（秋）": "202510_StartupJapanSummit（秋）（幕張）",
  "ODEX2506": "202506_ODEX（ビッグサイト）",
  "AIW2507": "202507_AIworld（幕張）",
  "sansan2505": "202505_StartupJAPAN",
  "RX2504": "202504_StartupJapanSummit（春）",
  "20251030_ODEX大阪": "202510_ODEX大阪",
  "20251217_StartupJapanEXPO大阪": "20251217_Startup大阪",
  "20251126_ビジネスチャンス": "20251126_ビジネスチャンスEXPO（ビッグサイト）",
  "DXPO": "202508_DXPO（ビッグサイト）",
};
export function canonicalExhibition(detail?: string | null): string | null {
  const d = (detail ?? "").trim();
  if (!d) return null;
  return EXHIBITION_CANON[d] ?? d;
}

/** 製品群 → 案件カテゴリ。 */
export function productToCategory(prod?: string): string | null {
  const p = (prod ?? "").trim();
  if (!p) return null;
  if (p.includes("研修")) return "training";
  if (p.includes("開発")) return "development";
  if (p.includes("顧問")) return "advisory_subscription";
  return "other";
}
