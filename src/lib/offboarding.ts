/**
 * P2 オフボーディング(退任処理)チェックリストの既定項目。
 * "use server" ファイルは非同期関数しかエクスポートできないため、定数はここに置く。
 * 外部委託メンバーにも権限を付与する運用のため、剥奪漏れを機械的に潰すのが目的。
 */

export interface ChecklistItemDef { key: string; label: string }

export const OFFBOARDING_ITEMS: ChecklistItemDef[] = [
  { key: "google_group", label: "Googleグループ(sales-mgr/sales-ext 等)から除外した" },
  { key: "folder_share", label: "案件フォルダの個別共有を剥奪した" },
  { key: "mail_oauth", label: "メール接続・OAuthトークンを失効させた" },
  { key: "nda_return", label: "NDA上の返却・破棄義務の履行を確認した(外部委託の場合)" },
];
