/**
 * P1.5 資料種別(カテゴリ)の定義と、種別ごとの取り扱いルール。
 * 「どこに保存するか」「静止点(凍結コピー)を取るか」「AI学習に含めるか」を
 * ユーザーではなくシステムが種別から決めるための一元定義。
 * 運用設計: docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md
 */

export const DOC_CATEGORIES = [
  "提案書",
  "企画書",
  "研修資料",
  "技術資料",
  "営業ツール",
  "テンプレート",
  "契約書類",
  "請求",
  "人事",
  "その他",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

/** 静止点(Supabase凍結コピー)を必ず取る種別(証跡固定: 2026-07-25決定)。 */
export const SNAPSHOT_FORCED: DocCategory[] = ["契約書類"];
/** 静止点を既定ONのチェックボックスで選べる種別(提出版の提案書など)。 */
export const SNAPSHOT_DEFAULT_ON: DocCategory[] = ["提案書"];
/** AI学習(インデックス)から既定で除外する種別。 */
export const INDEX_EXCLUDED: DocCategory[] = ["契約書類", "請求", "人事"];

/** 画面(添付対象)ごとに選択肢へ出す種別。 */
export const CATEGORIES_BY_TARGET: Record<string, DocCategory[]> = {
  opportunity: ["提案書", "企画書", "技術資料", "営業ツール", "契約書類", "請求", "その他"],
  account: ["提案書", "企画書", "技術資料", "営業ツール", "契約書類", "請求", "その他"],
  lead: ["提案書", "営業ツール", "その他"],
  candidate: ["人事"],
  project: ["提案書", "企画書", "技術資料", "契約書類", "その他"],
  knowledge: ["研修資料", "技術資料", "営業ツール", "テンプレート", "その他"],
  library: [...DOC_CATEGORIES],
};

/** 静止点コピーの上限(サーバー経由ダウンロードの保護)。 */
export const SNAPSHOT_MAX_BYTES = 30 * 1024 * 1024; // 30MB
