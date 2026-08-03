/** 利用制限(レート・月間トークン予算)の判定ロジック。DBアクセスは含めない純関数。 */

/** 1分あたりの送信上限。研修中の連打・スクリプト送信を抑える。 */
export const RATE_LIMIT_TEXT_PER_MIN = 10;
export const RATE_LIMIT_IMAGE_PER_MIN = 3;

export function rateLimitFor(kind: "text" | "image"): number {
  return kind === "image" ? RATE_LIMIT_IMAGE_PER_MIN : RATE_LIMIT_TEXT_PER_MIN;
}

/** 直近1分の送信数が上限に達していれば true。 */
export function isRateLimited(recentCount: number, kind: "text" | "image"): boolean {
  return recentCount >= rateLimitFor(kind);
}

/** 月間トークン予算(入出力合算)。null は無制限。 */
export function isBudgetExceeded(usedTokens: number, budget: number | null | undefined): boolean {
  if (budget == null) return false;
  return usedTokens >= budget;
}

/** 予算の消化率(0〜1超)。無制限なら null。管理画面のバー表示に使う。 */
export function budgetRatio(usedTokens: number, budget: number | null | undefined): number | null {
  if (budget == null || budget <= 0) return null;
  return usedTokens / budget;
}

/** 当月の集計範囲(ローカル日付ベースのYYYY-MM-DD)。usage_daily の date と突き合わせる。 */
export function monthRange(now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { from: first, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

export interface UsageRow {
  input_tokens: number;
  output_tokens: number;
  requests?: number;
  images?: number;
}

export function sumTokens(rows: UsageRow[]): number {
  return rows.reduce((acc, r) => acc + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0), 0);
}

export function sumUsage(rows: UsageRow[]): {
  inputTokens: number;
  outputTokens: number;
  requests: number;
  images: number;
} {
  return rows.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + Number(r.input_tokens ?? 0),
      outputTokens: acc.outputTokens + Number(r.output_tokens ?? 0),
      requests: acc.requests + Number(r.requests ?? 0),
      images: acc.images + Number(r.images ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, requests: 0, images: 0 },
  );
}

/** 受講者に見せるエラー文言。原因ごとに次の行動が分かる書き方にする。 */
export const LAB_ERROR_MESSAGES: Record<string, string> = {
  model_not_allowed: "このモデルは現在利用できません。別のモデルを選んでください。",
  rate_limited: "送信が集中しています。1分ほど待って再度お試しください。",
  budget_exceeded: "利用上限に達しました。担当者にお問い合わせください。",
  config_error: "環境設定に問題があります。運営にご連絡ください。",
  provider_error: "AIの応答中にエラーが発生しました。もう一度お試しください。",
  empty_message: "メッセージを入力してください。",
  not_found: "会話が見つかりません。",
  unauthorized: "セッションが切れました。再度ログインしてください。",
};

export function labErrorMessage(code: string | null | undefined): string {
  if (!code) return LAB_ERROR_MESSAGES.provider_error;
  return LAB_ERROR_MESSAGES[code] ?? LAB_ERROR_MESSAGES.provider_error;
}
