/**
 * CATORCE Sales OS - マスタ/設定定数
 * 要件定義書 8章(初期設定テンプレート) / 11章(権限)に対応。
 * ※ これらは「設定データ」の既定値。将来テナントごとにDBで上書き可能にする。
 */

import type {
  ForecastCategory,
  OpportunityStage,
  Role,
  ActivityType,
  ChannelType,
  CampaignEventStatus,
} from "./types";

export const APP_NAME = "CATORCE Sales OS";
export const APP_TAGLINE = "未来の売上を作る AI営業OS";

/** 商談ステージ定義(8.3) — 基準確度つき */
export const STAGES: {
  key: OpportunityStage;
  label: string;
  probability: number;
  group: "open" | "won" | "lost" | "on_hold";
}[] = [
  { key: "lead_acquired", label: "リード獲得", probability: 5, group: "open" },
  { key: "contacted", label: "初回接触済", probability: 10, group: "open" },
  { key: "meeting_scheduled", label: "初回商談設定", probability: 20, group: "open" },
  { key: "meeting_done", label: "初回商談完了", probability: 30, group: "open" },
  { key: "needs_confirmed", label: "課題/予算/時期確認済", probability: 45, group: "open" },
  { key: "proposal_preparing", label: "提案準備中", probability: 55, group: "open" },
  { key: "proposal_sent", label: "提案済", probability: 65, group: "open" },
  { key: "internal_review", label: "稟議/社内検討中", probability: 75, group: "open" },
  { key: "verbal_commit", label: "口頭内諾", probability: 90, group: "open" },
  { key: "won", label: "受注", probability: 100, group: "won" },
  { key: "lost", label: "失注", probability: 0, group: "lost" },
  { key: "on_hold", label: "保留", probability: 0, group: "on_hold" },
];

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s]));

/** 提案以降のステージ(危険案件判定などで利用) */
export const PROPOSAL_OR_LATER: OpportunityStage[] = [
  "proposal_sent",
  "internal_review",
  "verbal_commit",
];

/** ヨミ区分(8.4) */
export const FORECAST_CATEGORIES: {
  key: ForecastCategory;
  label: string;
  description: string;
}[] = [
  { key: "commit", label: "Commit", description: "ほぼ受注。売上計画に入れてよい" },
  { key: "best_case", label: "Best Case", description: "条件が整えば受注見込み" },
  { key: "pipeline", label: "Pipeline", description: "まだ不確実だが追うべき案件" },
  { key: "upside", label: "Upside", description: "将来化ける可能性がある案件" },
  { key: "omitted", label: "除外", description: "予測から除外" },
];

export const FORECAST_MAP = Object.fromEntries(
  FORECAST_CATEGORIES.map((f) => [f.key, f]),
);

/** ロール定義(11.1) */
export const ROLES: { key: Role; label: string; description: string }[] = [
  { key: "owner", label: "代表(Owner)", description: "全権限" },
  { key: "admin", label: "管理者", description: "設定、メンバー管理、全データ管理" },
  { key: "sales_manager", label: "Sales Ops", description: "全商談閲覧、レビュー、分析" },
  { key: "sales_rep", label: "営業担当", description: "自分の担当案件を閲覧・編集" },
  { key: "external_sales", label: "外部営業", description: "割り当て案件のみ閲覧・編集" },
  { key: "partner", label: "パートナー営業", description: "自分の紹介案件のみ閲覧" },
  { key: "delivery", label: "講師/PM", description: "受注後案件・顧客情報のみ閲覧" },
  { key: "finance", label: "経理", description: "契約・請求関連のみ閲覧" },
  { key: "viewer", label: "閲覧者", description: "閲覧のみ" },
];

export const ROLE_MAP = Object.fromEntries(ROLES.map((r) => [r.key, r]));

/** tenant全体を閲覧できるロール(MVPの簡易RLS方針 14.2) */
export const FULL_VIEW_ROLES: Role[] = ["owner", "admin", "sales_manager", "viewer"];
/** 自分担当のみ参照のロール */
export const OWN_ONLY_ROLES: Role[] = ["sales_rep", "external_sales", "partner"];

export const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
  { key: "meeting", label: "商談" },
  { key: "call", label: "電話" },
  { key: "email", label: "メール" },
  { key: "dm", label: "DM" },
  { key: "proposal", label: "提案" },
  { key: "estimate", label: "見積" },
  { key: "follow_up", label: "フォロー" },
  { key: "note", label: "メモ" },
  { key: "internal_memo", label: "社内メモ" },
];

export const ACTIVITY_TYPE_MAP = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.key, a]),
);

/** 危険案件判定のしきい値(日数) */
export const STALE_DAYS = 7;
export const PROPOSAL_FOLLOWUP_DAYS = 7;

/** CATORCE 流入経路マスタ初期値(8.2) */
export const CATORCE_LEAD_SOURCES: { name: string; description: string }[] = [
  { name: "X", description: "X投稿、プロフィール、DM経由" },
  { name: "紹介", description: "顧客・知人・パートナーからの紹介" },
  { name: "既存顧客", description: "アップセル/クロスセル" },
  { name: "LP", description: "Webサイト/LP問い合わせ" },
  { name: "SEO", description: "オーガニック検索" },
  { name: "ウェビナー", description: "セミナー/オンラインイベント" },
  { name: "展示会", description: "展示会QR/名刺/ノベルティ" },
  { name: "交流会", description: "自社/外部交流会" },
  { name: "営業代行", description: "外部営業経由" },
  { name: "代理店", description: "パートナー/代理店経由" },
  { name: "Facebook", description: "Facebook営業/DM" },
  { name: "LinkedIn", description: "LinkedIn経由" },
  { name: "メルマガ", description: "メール配信経由" },
  { name: "その他", description: "その他" },
];

/**
 * 施策(マーケティングチャネル)種別マスタ。
 * 展示会を最重点に、代理店・セミナー・経営者アポ・コール・メディア・SNS・交流会へ拡張予定。
 */
export const CHANNELS: { key: ChannelType; label: string; short: string }[] = [
  { key: "exhibition", label: "展示会", short: "展示会" },
  { key: "agency", label: "代理店", short: "代理店" },
  { key: "seminar", label: "セミナー", short: "セミナー" },
  { key: "exec_appt_bt", label: "経営者アポ（ビジネスタンク）", short: "経営者アポ(BT)" },
  { key: "exec_appt_rm", label: "経営者アポ（ラフメイカー）", short: "経営者アポ(RM)" },
  { key: "whitelist_call", label: "ホワイトリストコール", short: "WLコール" },
  { key: "media_ipros", label: "メディア（イプロス）", short: "イプロス" },
  { key: "media_aismiley", label: "メディア（アイスマイリー）", short: "アイスマイリー" },
  { key: "sns", label: "SNS", short: "SNS" },
  { key: "networking", label: "交流会", short: "交流会" },
  { key: "other", label: "その他", short: "その他" },
];

export const CHANNEL_MAP = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

/** 施策インスタンスのステータス表示 */
export const CAMPAIGN_EVENT_STATUS: { key: CampaignEventStatus; label: string }[] = [
  { key: "done", label: "実施済み" },
  { key: "applied", label: "申込み済" },
  { key: "planned", label: "予定" },
];

export const CAMPAIGN_EVENT_STATUS_MAP = Object.fromEntries(
  CAMPAIGN_EVENT_STATUS.map((s) => [s.key, s]),
);

/** CATORCE 商材マスタ初期値(8.1) */
export const CATORCE_PRODUCTS: {
  category: string;
  name: string;
  notes: string;
  is_recurring: boolean;
  default_price: number;
  default_gross_profit_rate: number;
}[] = [
  { category: "AI研修", name: "生成AI企業研修", notes: "主力商材", is_recurring: false, default_price: 1500000, default_gross_profit_rate: 0.7 },
  { category: "AI研修", name: "Dify研修", notes: "AIエージェント/ワークフロー", is_recurring: false, default_price: 1200000, default_gross_profit_rate: 0.7 },
  { category: "AI研修", name: "Copilot研修", notes: "Microsoft系", is_recurring: false, default_price: 1000000, default_gross_profit_rate: 0.7 },
  { category: "AI研修", name: "NotebookLM研修", notes: "業務プロンプト/資料活用", is_recurring: false, default_price: 800000, default_gross_profit_rate: 0.72 },
  { category: "AI研修", name: "Gemini研修", notes: "Google Workspace系", is_recurring: false, default_price: 900000, default_gross_profit_rate: 0.7 },
  { category: "AI顧問", name: "AI顧問ライト", notes: "月額顧問", is_recurring: true, default_price: 150000, default_gross_profit_rate: 0.8 },
  { category: "AI顧問", name: "AI顧問スタンダード", notes: "月額顧問", is_recurring: true, default_price: 300000, default_gross_profit_rate: 0.8 },
  { category: "AI顧問", name: "AI顧問エンタープライズ", notes: "月額顧問", is_recurring: true, default_price: 600000, default_gross_profit_rate: 0.78 },
  { category: "AI開発", name: "Dify/RAG開発", notes: "受託開発", is_recurring: false, default_price: 3000000, default_gross_profit_rate: 0.45 },
  { category: "AI開発", name: "AIエージェント開発", notes: "受託/PoC", is_recurring: false, default_price: 2500000, default_gross_profit_rate: 0.45 },
  { category: "AI開発", name: "議事録AI", notes: "業務自動化", is_recurring: true, default_price: 500000, default_gross_profit_rate: 0.6 },
  { category: "SaaS/商品", name: "すらつく", notes: "AIスライド作成パッケージ", is_recurring: true, default_price: 50000, default_gross_profit_rate: 0.85 },
  { category: "SNS支援", name: "Xジム", notes: "X発信支援", is_recurring: true, default_price: 200000, default_gross_profit_rate: 0.75 },
  { category: "SNS支援", name: "FBGYM", notes: "Facebook営業支援", is_recurring: true, default_price: 200000, default_gross_profit_rate: 0.75 },
  { category: "営業AX", name: "営業AX支援", notes: "CRM/SFA/営業AI化支援", is_recurring: true, default_price: 800000, default_gross_profit_rate: 0.6 },
  { category: "展示会", name: "プロンプト100選導線", notes: "展示会リード獲得", is_recurring: false, default_price: 300000, default_gross_profit_rate: 0.7 },
];
