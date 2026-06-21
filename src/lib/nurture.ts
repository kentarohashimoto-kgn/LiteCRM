/** 既存顧客深耕のマスタ(深耕ステージ・関係性)。 */

export const NURTURE_STAGES: { key: string; label: string }[] = [
  { key: "just_won", label: "受注直後" },
  { key: "preparing", label: "実施準備中" },
  { key: "in_progress", label: "実施中" },
  { key: "follow_up", label: "実施後フォロー" },
  { key: "check_issue", label: "追加課題確認" },
  { key: "prep_proposal", label: "追加提案準備" },
  { key: "proposed", label: "追加提案済" },
  { key: "additional_won", label: "追加受注" },
  { key: "dormant", label: "休眠" },
];
export const NURTURE_STAGE_LABEL: Record<string, string> = Object.fromEntries(NURTURE_STAGES.map((s) => [s.key, s.label]));

export const RELATIONSHIP_OPTS: { key: string; label: string }[] = [
  { key: "strong", label: "強い" },
  { key: "normal", label: "普通" },
  { key: "weak", label: "弱い" },
  { key: "dormant", label: "休眠" },
];
export const RELATIONSHIP_LABEL: Record<string, string> = Object.fromEntries(RELATIONSHIP_OPTS.map((r) => [r.key, r.label]));

/** 接点なし日数のアラート閾値(既存顧客が40日以上接点なし)。 */
export const STALE_CONTACT_DAYS = 40;
