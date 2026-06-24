/**
 * セミナー参加者の攻略リスト: 過去履歴(流入元/商談/エンゲージメント/接点)を突合し、
 * フォロー優先度スコアと推奨アクションを算出する。セミナー横断で再利用可能。
 */

export interface FollowupLead {
  id: string;
  raw_event: string | null;
  source: string | null;
  acquired_at: string | null;
  funnel_stage: string | null;
  disposition: string | null;
  status: string | null;
  rank: string | null;
  owner_user_id: string | null;
}
export interface FollowupOpp {
  name: string | null;
  stage: string | null;
  status: string | null;
  amount: number | null;
  first_meeting_date: string | null;
  expected_close_date: string | null;
  notes: string | null;
  yomi: string | null;
}
export interface FollowupTouch {
  source: string | null;
  type: string | null;
}
export interface FollowupParticipant {
  email: string;
  name: string | null;
  company: string | null;
  company_norm: string | null;
  job_title: string | null;
  employee_size: string | null;
  follow_up: string | null; // 次回セミナー参加希望
  memo: string | null; // 営業メモ(受講/申込のみ・ランク・商談メモ)
  challenges: string | null;
  ai_usage: string | null;
  responded_at: string | null;
  lead: FollowupLead | null;
  engagement: { score: number | null; rank: string | null; touch_count: number | null };
  history: FollowupTouch[];
  prior_sources: number;
  opps: FollowupOpp[];
  opp_count: number;
  open_count: number;
  lost_count: number;
}

export type FollowupRank = "S" | "A" | "B" | "C";

export interface FollowupScore {
  total: number;
  rank: FollowupRank;
  reasons: string[];
  /** 推奨アクションの分類キー */
  actionKey:
    | "live_deal" // 進行中商談あり → 再アタック
    | "revive" // 過去失注 → 掘り起こし
    | "appointment" // アポ獲得済 → フォロー
    | "hot" // 高エンゲージ/決裁者 → 優先架電
    | "warm" // 次回参加希望/接点複数 → 育成架電
    | "nurture"; // 通常ナーチャリング
  action: string;
}

const ACTION_LABEL: Record<FollowupScore["actionKey"], string> = {
  live_deal: "進行中商談あり → 同席/再アタック",
  revive: "過去失注 → 掘り起こし架電",
  appointment: "アポ獲得済 → 次アクション設定",
  hot: "ホット → 優先架電(当日中)",
  warm: "次回誘導 + 育成架電",
  nurture: "ナーチャリング(メルマガ/次回案内)",
};

const RANK_ORDER: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

/** 決裁レイヤー(代表/役員/部長クラス)か。 */
function isDecisionMaker(job?: string | null): boolean {
  const j = job ?? "";
  return /代表|役員|社長|取締役|部（室）長|部長|次長|本部長|CxO|CEO|COO|執行/.test(j);
}
/** 大企業(1000名以上/100〜1000)か。 */
function isLargeCompany(size?: string | null): boolean {
  return /1000名以上|100～1000/.test(size ?? "");
}
function openOppStage(opps: FollowupOpp[]): FollowupOpp | null {
  return opps.find((o) => o.status === "open") ?? null;
}

const STAGE_LABEL: Record<string, string> = {
  meeting_scheduled: "商談設定",
  meeting_done: "商談済",
  proposal: "提案中",
  negotiation: "交渉中",
  won: "受注",
  lost: "失注",
};
export function stageLabel(s?: string | null): string {
  return s ? STAGE_LABEL[s] ?? s : "—";
}

/**
 * フォロー優先度スコア。過去の関係性が深いほど、温度が高いほど高得点。
 * 「ヨミの前にファネルを進める」思想に沿い、商談実績/エンゲージメント/役職/規模/温度を加点。
 */
export function scoreFollowup(p: FollowupParticipant): FollowupScore {
  const reasons: string[] = [];
  let total = 0;
  let actionKey: FollowupScore["actionKey"] = "nurture";

  const live = openOppStage(p.opps);
  const hasLost = p.lost_count > 0;
  const engRank = p.engagement.rank ?? "";
  const engScore = RANK_ORDER[engRank] ?? 0;

  // 1) 過去商談(最重要シグナル)
  if (live) {
    total += 45;
    reasons.push(`進行中商談(${stageLabel(live.stage)})`);
    actionKey = "live_deal";
  } else if (hasLost) {
    total += 28;
    reasons.push("過去失注あり");
    actionKey = "revive";
  } else if (p.opp_count > 0) {
    total += 22;
    reasons.push("過去商談あり");
    actionKey = "revive";
  }

  // 2) アポ獲得済(リードファネル)
  if (p.lead?.funnel_stage === "appointment" || p.lead?.disposition === "appointment") {
    total += 18;
    reasons.push("アポ獲得済");
    if (actionKey === "nurture") actionKey = "appointment";
  }

  // 3) エンゲージメント(接点の蓄積)
  if (engScore >= 4) { total += 22; reasons.push(`エンゲージ${engRank}`); }
  else if (engScore === 3) { total += 14; reasons.push(`エンゲージ${engRank}`); }
  else if (engScore === 2) { total += 7; reasons.push(`エンゲージ${engRank}`); }

  // 4) 複数接点(展示会・セミナーを跨ぐ)
  if (p.prior_sources >= 2) { total += 14; reasons.push(`接点${p.prior_sources}媒体`); }
  else if (p.prior_sources === 1) { total += 7; reasons.push("既存接点あり"); }

  // 5) 役職(決裁レイヤー)
  if (isDecisionMaker(p.job_title)) { total += 12; reasons.push("決裁レイヤー"); }

  // 6) 企業規模
  if (isLargeCompany(p.employee_size)) { total += 8; reasons.push("大企業"); }

  // 7) 温度(次回セミナー参加希望)
  if ((p.follow_up ?? "").includes("希望")) { total += 8; reasons.push("次回参加希望"); }

  // 8) 受講(申込のみより加点)
  if ((p.memo ?? "").includes("受講")) { total += 4; reasons.push("当日受講"); }

  // アクション分類の確定(商談が無い場合の温度判断)
  if (actionKey === "nurture") {
    if (engScore >= 4 || (isDecisionMaker(p.job_title) && p.prior_sources >= 1)) actionKey = "hot";
    else if ((p.follow_up ?? "").includes("希望") || p.prior_sources >= 1) actionKey = "warm";
  }

  const rank: FollowupRank = total >= 60 ? "S" : total >= 40 ? "A" : total >= 22 ? "B" : "C";
  return { total, rank, reasons, actionKey, action: ACTION_LABEL[actionKey] };
}

export const FOLLOWUP_RANK_COLOR: Record<FollowupRank, string> = {
  S: "bg-rose-100 text-rose-700",
  A: "bg-amber-100 text-amber-700",
  B: "bg-teal-light/40 text-teal-deep",
  C: "bg-mist-soft text-ink/50",
};
export const ACTION_COLOR: Record<FollowupScore["actionKey"], string> = {
  live_deal: "bg-rose-100 text-rose-700",
  revive: "bg-orange-100 text-orange-700",
  appointment: "bg-violet-100 text-violet-700",
  hot: "bg-amber-100 text-amber-700",
  warm: "bg-teal-light/40 text-teal-deep",
  nurture: "bg-mist-soft text-ink/55",
};

export const ENG_RANK_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-700",
  A: "bg-amber-100 text-amber-700",
  B: "bg-teal-light/40 text-teal-deep",
  C: "bg-sky-100 text-sky-700",
  D: "bg-mist-soft text-ink/45",
};
