/** BO-5 HR(求人・候補者)で共有するラベル/選択肢。ページ(server)とフォーム(client)双方から利用。 */

export const KIND_LABEL: Record<string, string> = { client: "クライアント案件", internal: "カトルセ人員" };

/** 求人ステータス(募集中/選考中/クローズ の3種)。 */
export const OPENING_STATUSES: { key: string; label: string }[] = [
  { key: "open", label: "募集中" },
  { key: "interviewing", label: "選考中" },
  { key: "closed", label: "クローズ" },
];
export const OPENING_STATUS_LABEL: Record<string, string> = Object.fromEntries(OPENING_STATUSES.map((s) => [s.key, s.label]));

/** クローズ理由(充足はここに集約)。 */
export const CLOSE_REASONS: string[] = ["充足", "一時停止", "顧客都合で終了", "他社決定", "採用中止", "対応見送り", "その他"];

export const PRIORITIES: { key: string; label: string }[] = [
  { key: "high", label: "高" },
  { key: "mid", label: "中" },
  { key: "low", label: "低" },
];
export const PRIORITY_LABEL: Record<string, string> = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label]));

/** 契約形態(カトルセ人員・複数選択)。 */
export const EMPLOYMENT_TYPE_OPTIONS: string[] = ["業務委託", "正社員", "アルバイト"];

/** 候補者ステータス。 */
export const CANDIDATE_STATUSES: { key: string; label: string }[] = [
  { key: "applied", label: "応募" },
  { key: "screening", label: "書類選考" },
  { key: "first", label: "一次面接" },
  { key: "second", label: "二次面接" },
  { key: "final", label: "最終面接" },
  { key: "offer", label: "内定" },
  { key: "joined", label: "入社・稼働" },
  { key: "rejected", label: "見送り" },
  { key: "declined", label: "辞退" },
];
export const CANDIDATE_STATUS_LABEL: Record<string, string> = Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s.key, s.label]));
export const CANDIDATE_CLOSED = new Set(["joined", "rejected", "declined"]);

/** 選考ステップ。 */
export const INTERVIEW_STEPS: { key: string; label: string }[] = [
  { key: "screening", label: "書類" },
  { key: "first", label: "一次" },
  { key: "second", label: "二次" },
  { key: "final", label: "最終" },
];
export const INTERVIEW_STEP_LABEL: Record<string, string> = Object.fromEntries(INTERVIEW_STEPS.map((s) => [s.key, s.label]));

/** 選考結果(辞退を追加)。 */
export const INTERVIEW_RESULTS: { key: string; label: string }[] = [
  { key: "pass", label: "通過" },
  { key: "fail", label: "不合格" },
  { key: "hold", label: "保留" },
  { key: "declined", label: "辞退" },
];
export const INTERVIEW_RESULT_LABEL: Record<string, string> = Object.fromEntries(INTERVIEW_RESULTS.map((r) => [r.key, r.label]));
