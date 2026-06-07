/**
 * CATORCE 初期テンプレート + デモ用サンプルデータ。
 *
 * 要件定義書 6.2「CATORCE固有情報をコードにハードコードしない」方針に従い、
 * CATORCE固有のマスタは constants.ts のテンプレートから seed として投入する形にしている。
 * (本番では supabase/seed.sql 相当)
 *
 * 日付は「今日」を基準に相対生成し、放置案件検知・週次レビューが常に意味を持つようにする。
 */

import {
  CATORCE_LEAD_SOURCES,
  CATORCE_PRODUCTS,
  STAGE_MAP,
} from "@/lib/constants";
import { monthKey, addMonths } from "@/lib/utils";
import type {
  Account,
  Activity,
  Contact,
  ForecastSnapshot,
  Lead,
  LeadSource,
  Membership,
  Opportunity,
  OpportunityStage,
  Product,
  SalesTarget,
  StageHistory,
  Task,
  Tenant,
  User,
} from "@/lib/types";

export interface Database {
  tenants: Tenant[];
  users: User[];
  memberships: Membership[];
  accounts: Account[];
  contacts: Contact[];
  leadSources: LeadSource[];
  products: Product[];
  leads: Lead[];
  opportunities: Opportunity[];
  activities: Activity[];
  tasks: Task[];
  stageHistories: StageHistory[];
  salesTargets: SalesTarget[];
  forecastSnapshots: ForecastSnapshot[];
}

export const TENANT_ID = "catorce";

const now = new Date();
const iso = (offsetDays: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};
const dateStr = (offsetDays: number) => iso(offsetDays).slice(0, 10);

// ---- Tenant ----
const tenant: Tenant = {
  id: TENANT_ID,
  name: "株式会社カトルセ",
  slug: "catorce",
  status: "active",
};

// ---- Users / Memberships ----
const users: User[] = [
  { id: "u-daihyo", name: "橋本 健太郎", email: "kentaro.hashimoto@catorce.jp", avatarColor: "#008C8C" },
  { id: "u-ops", name: "佐藤 美咲", email: "ops@catorce.jp", avatarColor: "#006C6A" },
  { id: "u-ext1", name: "田中 亮", email: "tanaka@partner-sales.jp", avatarColor: "#F59A2A" },
  { id: "u-ext2", name: "鈴木 彩", email: "suzuki@partner-sales.jp", avatarColor: "#3F7A7A" },
  { id: "u-ext3", name: "山本 直樹", email: "yamamoto@partner-sales.jp", avatarColor: "#C77F1A" },
  { id: "u-partner", name: "井上 拓也", email: "inoue@agency.jp", avatarColor: "#5B6B6B" },
];

const memberships: Membership[] = [
  { id: "m1", tenant_id: TENANT_ID, user_id: "u-daihyo", role: "owner", status: "active" },
  { id: "m2", tenant_id: TENANT_ID, user_id: "u-ops", role: "sales_manager", status: "active" },
  { id: "m3", tenant_id: TENANT_ID, user_id: "u-ext1", role: "external_sales", status: "active" },
  { id: "m4", tenant_id: TENANT_ID, user_id: "u-ext2", role: "external_sales", status: "active" },
  { id: "m5", tenant_id: TENANT_ID, user_id: "u-ext3", role: "external_sales", status: "active" },
  { id: "m6", tenant_id: TENANT_ID, user_id: "u-partner", role: "partner", status: "active" },
];

// ---- Lead sources (from CATORCE template) ----
const leadSources: LeadSource[] = CATORCE_LEAD_SOURCES.map((s, i) => ({
  id: `ls-${i + 1}`,
  tenant_id: TENANT_ID,
  name: s.name,
  description: s.description,
  status: "active",
}));
const lsByName = Object.fromEntries(leadSources.map((l) => [l.name, l.id]));

// ---- Products (from CATORCE template) ----
const products: Product[] = CATORCE_PRODUCTS.map((p, i) => ({
  id: `p-${i + 1}`,
  tenant_id: TENANT_ID,
  category: p.category,
  name: p.name,
  notes: p.notes,
  is_recurring: p.is_recurring,
  default_price: p.default_price,
  default_gross_profit_rate: p.default_gross_profit_rate,
  status: "active",
}));
const prodByName = Object.fromEntries(products.map((p) => [p.name, p]));

// ---- Accounts ----
const accountSeed: Array<[string, string, string, Account["status"], Account["priority"]]> = [
  ["a1", "株式会社メルクロス", "製造", "customer", "A"],
  ["a2", "日本ロジテック株式会社", "物流", "prospect", "A"],
  ["a3", "グリーンフーズ株式会社", "食品", "prospect", "B"],
  ["a4", "さくら不動産株式会社", "不動産", "customer", "B"],
  ["a5", "東京メディカル株式会社", "医療", "prospect", "A"],
  ["a6", "ニッセイ商事株式会社", "商社", "prospect", "B"],
  ["a7", "株式会社アペックス", "IT", "customer", "A"],
  ["a8", "みらい銀行", "金融", "prospect", "A"],
  ["a9", "株式会社ベストプラン", "コンサル", "prospect", "C"],
  ["a10", "中央製薬株式会社", "製薬", "prospect", "B"],
  ["a11", "株式会社ハルカ教育", "教育", "customer", "B"],
  ["a12", "オリオン精機株式会社", "製造", "prospect", "B"],
];
const accounts: Account[] = accountSeed.map(([id, name, industry, status, priority]) => ({
  id,
  tenant_id: TENANT_ID,
  owner_user_id: "u-ops",
  name,
  industry,
  employee_size: ["~50", "51~300", "301~1000", "1001~"][Math.floor(Math.random() * 4)],
  area: ["東京", "大阪", "名古屋", "福岡"][Math.floor(Math.random() * 4)],
  status,
  priority,
  potential: priority === "A" ? "high" : priority === "B" ? "middle" : "low",
  notes: "",
  created_at: iso(-180),
  updated_at: iso(-2),
}));

// ---- Contacts ----
const contacts: Contact[] = accounts.map((a, i) => ({
  id: `c-${i + 1}`,
  tenant_id: TENANT_ID,
  account_id: a.id,
  name: ["山田 部長", "高橋 課長", "伊藤 マネージャー", "渡辺 取締役", "中村 担当"][i % 5],
  department: ["経営企画", "DX推進", "人事", "情報システム", "営業企画"][i % 5],
  title: ["部長", "課長", "マネージャー", "取締役", "主任"][i % 5],
  email: `contact${i + 1}@example.com`,
  decision_role: i % 3 === 0 ? "decision_maker" : i % 3 === 1 ? "influencer" : "user",
  temperature: i % 2 === 0 ? "high" : "middle",
  interest_topics: ["生成AI研修", "業務改善"],
}));

// ---- Opportunity generator ----
type OppSeed = {
  acc: string;
  owner: string;
  product: string;
  stage: OpportunityStage;
  yomi: Opportunity["forecast_category"];
  amount: number;
  source: string;
  closeOffset: number; // days from now
  lastActivityOffset: number; // days from now (negative = past)
  nextActionOffset: number | null; // days from now, null = unset
  status: Opportunity["status"];
  risk?: Opportunity["risk_level"];
};

const oppSeeds: OppSeed[] = [
  // --- 今月クロージング対象 / Commit ---
  { acc: "a1", owner: "u-ext1", product: "生成AI企業研修", stage: "verbal_commit", yomi: "commit", amount: 1800000, source: "既存顧客", closeOffset: 8, lastActivityOffset: -1, nextActionOffset: 2, status: "open", risk: "low" },
  { acc: "a7", owner: "u-ext2", product: "AI顧問スタンダード", stage: "internal_review", yomi: "commit", amount: 3600000, source: "紹介", closeOffset: 12, lastActivityOffset: -3, nextActionOffset: 1, status: "open", risk: "low" },
  { acc: "a5", owner: "u-ext1", product: "Dify/RAG開発", stage: "verbal_commit", yomi: "commit", amount: 3000000, source: "LP", closeOffset: 18, lastActivityOffset: -2, nextActionOffset: 3, status: "open", risk: "middle" },
  // --- Best Case ---
  { acc: "a2", owner: "u-ext3", product: "生成AI企業研修", stage: "proposal_sent", yomi: "best_case", amount: 1500000, source: "展示会", closeOffset: 20, lastActivityOffset: -9, nextActionOffset: null, status: "open", risk: "high" },
  { acc: "a8", owner: "u-ext2", product: "AIエージェント開発", stage: "needs_confirmed", yomi: "best_case", amount: 2500000, source: "ウェビナー", closeOffset: 35, lastActivityOffset: -4, nextActionOffset: 5, status: "open", risk: "middle" },
  { acc: "a4", owner: "u-ext1", product: "Copilot研修", stage: "proposal_sent", yomi: "best_case", amount: 1000000, source: "既存顧客", closeOffset: 15, lastActivityOffset: -10, nextActionOffset: null, status: "open", risk: "high" },
  // --- Pipeline ---
  { acc: "a3", owner: "u-ext3", product: "NotebookLM研修", stage: "meeting_done", yomi: "pipeline", amount: 800000, source: "X", closeOffset: 40, lastActivityOffset: -6, nextActionOffset: 4, status: "open" },
  { acc: "a6", owner: "u-ext2", product: "Dify研修", stage: "contacted", yomi: "pipeline", amount: 1200000, source: "交流会", closeOffset: 55, lastActivityOffset: -12, nextActionOffset: null, status: "open", risk: "middle" },
  { acc: "a9", owner: "u-partner", product: "営業AX支援", stage: "meeting_scheduled", yomi: "pipeline", amount: 800000, source: "代理店", closeOffset: 45, lastActivityOffset: -2, nextActionOffset: 6, status: "open" },
  { acc: "a10", owner: "u-ext3", product: "AI顧問ライト", stage: "needs_confirmed", yomi: "pipeline", amount: 1800000, source: "SEO", closeOffset: 30, lastActivityOffset: -5, nextActionOffset: 3, status: "open" },
  { acc: "a11", owner: "u-ext1", product: "Gemini研修", stage: "proposal_preparing", yomi: "pipeline", amount: 900000, source: "メルマガ", closeOffset: 28, lastActivityOffset: -8, nextActionOffset: 2, status: "open" },
  { acc: "a12", owner: "u-ext2", product: "議事録AI", stage: "meeting_done", yomi: "pipeline", amount: 600000, source: "LP", closeOffset: 50, lastActivityOffset: -1, nextActionOffset: 7, status: "open" },
  // --- Upside ---
  { acc: "a8", owner: "u-ext1", product: "AI顧問エンタープライズ", stage: "contacted", yomi: "upside", amount: 7200000, source: "紹介", closeOffset: 75, lastActivityOffset: -3, nextActionOffset: 10, status: "open" },
  { acc: "a2", owner: "u-ext3", product: "AIエージェント開発", stage: "lead_acquired", yomi: "upside", amount: 2500000, source: "展示会", closeOffset: 90, lastActivityOffset: -2, nextActionOffset: null, status: "open", risk: "middle" },
  // --- 来月以降 Commit/Best ---
  { acc: "a1", owner: "u-ext1", product: "AI顧問スタンダード", stage: "verbal_commit", yomi: "commit", amount: 3600000, source: "既存顧客", closeOffset: 38, lastActivityOffset: -2, nextActionOffset: 5, status: "open" },
  { acc: "a7", owner: "u-ext2", product: "Xジム", stage: "proposal_sent", yomi: "best_case", amount: 2400000, source: "X", closeOffset: 42, lastActivityOffset: -4, nextActionOffset: 6, status: "open" },
  // --- 受注済(won) 直近3ヶ月 ---
  { acc: "a1", owner: "u-ext1", product: "生成AI企業研修", stage: "won", yomi: "commit", amount: 1500000, source: "既存顧客", closeOffset: -10, lastActivityOffset: -10, nextActionOffset: null, status: "won" },
  { acc: "a7", owner: "u-ext2", product: "Dify研修", stage: "won", yomi: "commit", amount: 1200000, source: "紹介", closeOffset: -20, lastActivityOffset: -20, nextActionOffset: null, status: "won" },
  { acc: "a4", owner: "u-ext1", product: "Copilot研修", stage: "won", yomi: "commit", amount: 1000000, source: "既存顧客", closeOffset: -35, lastActivityOffset: -35, nextActionOffset: null, status: "won" },
  { acc: "a11", owner: "u-ext3", product: "NotebookLM研修", stage: "won", yomi: "commit", amount: 800000, source: "ウェビナー", closeOffset: -45, lastActivityOffset: -45, nextActionOffset: null, status: "won" },
  { acc: "a5", owner: "u-ext2", product: "生成AI企業研修", stage: "won", yomi: "commit", amount: 1700000, source: "LP", closeOffset: -60, lastActivityOffset: -60, nextActionOffset: null, status: "won" },
  { acc: "a3", owner: "u-ext3", product: "AI顧問ライト", stage: "won", yomi: "commit", amount: 150000, source: "X", closeOffset: -25, lastActivityOffset: -25, nextActionOffset: null, status: "won" },
  // --- 失注(lost) ---
  { acc: "a6", owner: "u-ext2", product: "生成AI企業研修", stage: "lost", yomi: "omitted", amount: 1500000, source: "交流会", closeOffset: -15, lastActivityOffset: -15, nextActionOffset: null, status: "lost" },
  { acc: "a9", owner: "u-partner", product: "営業AX支援", stage: "lost", yomi: "omitted", amount: 800000, source: "代理店", closeOffset: -30, lastActivityOffset: -30, nextActionOffset: null, status: "lost" },
  { acc: "a12", owner: "u-ext3", product: "Dify研修", stage: "lost", yomi: "omitted", amount: 1200000, source: "LP", closeOffset: -22, lastActivityOffset: -22, nextActionOffset: null, status: "lost" },
];

const lostReasons = ["価格が予算と合わなかった", "導入時期が後ろ倒し", "競合(他社研修)に決定", "社内検討が中断"];
const winReasons = ["実践型カリキュラムが評価された", "伴走支援の手厚さ", "既存顧客からの信頼", "提案スピード"];

const opportunities: Opportunity[] = oppSeeds.map((s, i) => {
  const stageDef = STAGE_MAP[s.stage];
  const product = prodByName[s.product];
  const gpRate = product?.default_gross_profit_rate ?? 0.6;
  const created = -60 - Math.floor(Math.random() * 60);
  return {
    id: `o-${i + 1}`,
    tenant_id: TENANT_ID,
    account_id: s.acc,
    owner_user_id: s.owner,
    name: `${accounts.find((a) => a.id === s.acc)?.name} / ${s.product}`,
    stage: s.stage,
    forecast_category: s.yomi,
    amount: s.amount,
    gross_profit: Math.round(s.amount * gpRate),
    gross_profit_rate: gpRate,
    probability: stageDef.probability,
    expected_close_date: dateStr(s.closeOffset),
    expected_revenue_month: monthKey(new Date(iso(s.closeOffset))),
    primary_product_id: product?.id,
    lead_source_id: lsByName[s.source],
    next_action_date: s.nextActionOffset == null ? undefined : dateStr(s.nextActionOffset),
    next_action_text:
      s.nextActionOffset == null ? undefined : "次回フォロー / 提案ブラッシュアップ",
    last_activity_at: iso(s.lastActivityOffset),
    status: s.status,
    lost_reason: s.status === "lost" ? lostReasons[i % lostReasons.length] : undefined,
    win_reason: s.status === "won" ? winReasons[i % winReasons.length] : undefined,
    risk_level: s.risk,
    notes: "",
    created_at: iso(created),
    updated_at: iso(s.lastActivityOffset),
  };
});

// ---- Stage histories (簡易: 各案件に1件、直近の進捗を記録) ----
const stageHistories: StageHistory[] = opportunities.map((o, i) => ({
  id: `sh-${i}-1`,
  tenant_id: TENANT_ID,
  opportunity_id: o.id,
  from_stage: "contacted",
  to_stage: o.stage,
  changed_by: o.owner_user_id,
  reason: "進捗更新",
  changed_at: o.updated_at,
}));

// ---- Activities ----
const activityTitles: Record<string, string> = {
  meeting: "初回商談を実施",
  call: "電話でヒアリング",
  email: "提案資料を送付",
  proposal: "提案書を提出",
  follow_up: "フォロー連絡",
};
const activities: Activity[] = opportunities.flatMap((o, i) => {
  const types = ["meeting", "call", "email", "proposal", "follow_up"];
  const count = 1 + (i % 3);
  return Array.from({ length: count }).map((_, j) => {
    const t = types[(i + j) % types.length] as Activity["activity_type"];
    return {
      id: `act-${i}-${j}`,
      tenant_id: TENANT_ID,
      account_id: o.account_id,
      opportunity_id: o.id,
      owner_user_id: o.owner_user_id,
      activity_type: t,
      title: activityTitles[t] ?? "活動記録",
      body: "顧客の課題感をヒアリング。生成AIの業務活用に前向き。社内展開の規模感を確認中。",
      activity_at: iso((o.last_activity_at ? -1 : -3) - j * 5),
      created_at: iso(-3 - j * 5),
    };
  });
});

// ---- Tasks (open案件の次アクションをタスク化) ----
const tasks: Task[] = opportunities
  .filter((o) => o.status === "open" && o.next_action_date)
  .map((o, i) => ({
    id: `t-${i + 1}`,
    tenant_id: TENANT_ID,
    opportunity_id: o.id,
    account_id: o.account_id,
    assigned_to: o.owner_user_id,
    created_by: "u-ops",
    title: o.next_action_text ?? "次アクション",
    due_date: o.next_action_date!,
    status: "todo",
    priority: o.forecast_category === "commit" ? "high" : "middle",
  }));

// 期限切れタスクを数件追加
tasks.push(
  {
    id: "t-overdue-1",
    tenant_id: TENANT_ID,
    opportunity_id: "o-4",
    account_id: "a2",
    assigned_to: "u-ext3",
    created_by: "u-ops",
    title: "提案後フォロー(未対応)",
    due_date: dateStr(-3),
    status: "todo",
    priority: "high",
  },
  {
    id: "t-overdue-2",
    tenant_id: TENANT_ID,
    opportunity_id: "o-6",
    account_id: "a4",
    assigned_to: "u-ext1",
    created_by: "u-ops",
    title: "見積の再提示",
    due_date: dateStr(-1),
    status: "todo",
    priority: "high",
  },
);

// ---- Leads ----
const leads: Lead[] = [
  ["l1", "a2", "展示会経由 物流DX相談", "qualified", "u-ext3", "展示会", "Dify研修"],
  ["l2", "a8", "ウェビナー参加 金融AI", "qualified", "u-ext2", "ウェビナー", "AIエージェント開発"],
  ["l3", "a10", "SEO問い合わせ 製薬", "new", "u-ext3", "SEO", "AI顧問ライト"],
  ["l4", "a9", "代理店紹介 コンサル", "contacted", "u-partner", "代理店", "営業AX支援"],
  ["l5", undefined as unknown as string, "X DM 経由 個人事業主", "new", "u-ext1", "X", "すらつく"],
  ["l6", "a6", "交流会名刺交換 商社", "disqualified", "u-ext2", "交流会", "生成AI企業研修"],
  ["l7", undefined as unknown as string, "LP問い合わせ 教育系", "new", "u-ext1", "LP", "NotebookLM研修"],
  ["l8", "a12", "メルマガ反応 製造業", "contacted", "u-ext2", "メルマガ", "議事録AI"],
].map((row, i) => {
  const [id, acc, title, status, owner, source, product] = row as string[];
  return {
    id,
    tenant_id: TENANT_ID,
    account_id: acc || undefined,
    lead_source_id: lsByName[source],
    owner_user_id: owner,
    primary_product_id: prodByName[product]?.id,
    title,
    status: status as Lead["status"],
    rank: (["A", "B", "C"] as const)[i % 3],
    acquired_at: dateStr(-20 - i * 3),
    first_contacted_at: status === "new" ? undefined : iso(-18 - i * 3),
    converted_at: undefined,
    disqualified_reason: status === "disqualified" ? "予算感が合わず" : undefined,
    notes: "",
    created_at: iso(-20 - i * 3),
  };
});

// ---- Sales targets (今月から6ヶ月) ----
const salesTargets: SalesTarget[] = Array.from({ length: 6 }).map((_, i) => {
  const m = addMonths(now, i);
  return {
    id: `st-${i}`,
    tenant_id: TENANT_ID,
    target_month: monthKey(m),
    target_amount: 6000000,
    target_gross_profit: 4000000,
  };
});

// ---- Forecast snapshots (先週/今週の比較用ダミー) ----
const forecastSnapshots: ForecastSnapshot[] = [
  {
    id: "fs-prev",
    tenant_id: TENANT_ID,
    snapshot_date: dateStr(-7),
    period_month: monthKey(now),
    commit_amount: 5400000,
    best_case_amount: 8200000,
    pipeline_amount: 12000000,
    upside_amount: 9700000,
    weighted_amount: 6100000,
    target_amount: 6000000,
    gap_amount: 600000,
  },
];

export function createSeedDatabase(): Database {
  return {
    tenants: [tenant],
    users,
    memberships,
    accounts,
    contacts,
    leadSources,
    products,
    leads,
    opportunities,
    activities,
    tasks,
    stageHistories,
    salesTargets,
    forecastSnapshots,
  };
}
