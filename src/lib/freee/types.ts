/**
 * freee 会計連携の型定義。
 * ※ freee API の一部フィールドのみを扱う（連携に必要な範囲）。
 */

/** freee_connections（接続状態。秘匿列は含めない） */
export interface FreeeStatus {
  connected: boolean;
  company_id?: number | null;
  company_name?: string | null;
  connected_at?: string | null;
  token_expires_at?: string | null;
}

/** freee 取引先 */
export interface FreeePartner {
  id: number;
  name: string;
  company_id: number;
}

/** 取引先の名寄せ候補（初期インポート時にユーザーへ提示する） */
export interface PartnerMatch {
  freee_id: number;
  freee_name: string;
  /** 名寄せ先のCRM顧客（見つかった場合） */
  account_id: string | null;
  account_name: string | null;
  /** 完全一致 / 表記ゆれ（名称差分あり） / 未マッチ */
  kind: "exact" | "diff" | "unmatched";
  /** 既に freee_links がある場合は true（再確認不要） */
  already_linked: boolean;
}

/** 名寄せの意思決定（ユーザーが行ごとに選ぶ） */
export type LinkDecision =
  | { account_id: string; freee_id: number; freee_name: string; mode: "renamed" } // CRM名称をfreeeに合わせる
  | { account_id: string; freee_id: number; freee_name: string; mode: "linked" }; // 名称は各自維持し対応表のみ

export interface SyncResult {
  ok: boolean;
  message?: string;
  count?: number;
}

/** freee 請求書（pull時に扱う最小フィールド） */
export interface FreeeInvoice {
  id: number;
  invoice_number: string | null;
  invoice_status: string; // draft / applying / remanded / rejected / approved / submitted / unsubmitted 等
  payment_status: string | null; // unsettled / settled 等
  total_amount: number;
  billing_date: string | null;
  due_date: string | null;
}

export const FREEE_API_BASE = "https://api.freee.co.jp";
export const FREEE_OAUTH_BASE = "https://accounts.secure.freee.co.jp/public_api";
