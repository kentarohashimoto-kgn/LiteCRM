import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx, type Ctx } from "@/lib/session";
import type {
  AcquirerAlias,
  Account,
  Activity,
  BillingSchedule,
  Campaign,
  Contact,
  LeadImportBatch,
  LeadSource,
  Meeting,
  Membership,
  Opportunity,
  Product,
  RepTarget,
  SalesTarget,
  SeminarResponse,
  StageHistory,
  Task,
  User,
} from "@/lib/types";

/**
 * 1リクエストで必要な業務データをまとめて取得したスナップショット。
 * 行はすべて Supabase の RLS でスコープ済み(=ログインユーザーが見える範囲のみ)。
 * よって画面側の helper は role による再フィルタを行わない。
 */
export interface Workspace {
  ctx: Ctx;
  users: User[];
  usersById: Map<string, User>;
  memberships: Membership[];
  accounts: Account[];
  accountsById: Map<string, Account>;
  contacts: Contact[];
  leadSources: LeadSource[];
  leadSourcesById: Map<string, LeadSource>;
  campaigns: Campaign[];
  campaignsById: Map<string, Campaign>;
  products: Product[];
  productsById: Map<string, Product>;
  opportunities: Opportunity[];
  meetings: Meeting[];
  billingSchedules: BillingSchedule[];
  activities: Activity[];
  tasks: Task[];
  stageHistories: StageHistory[];
  salesTargets: SalesTarget[];
  repTargets: RepTarget[];
  seminarResponses: SeminarResponse[];
  leadImportBatches: LeadImportBatch[];
  acquirerAliases: AcquirerAlias[];
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_color: string | null;
}


export const getWorkspace = cache(async (): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  // 1往復のRPCで全参照データを取得(RLS準拠)。多数クエリの往復を排除。
  const { data } = await sb.rpc("workspace_full");
  const j = (data ?? {}) as Record<string, unknown[]>;
  const profiles = (j.profiles ?? []) as ProfileRow[];
  const memberships = (j.memberships ?? []) as Membership[];
  const accounts = (j.accounts ?? []) as Account[];
  const contacts = (j.contacts ?? []) as Contact[];
  const leadSources = (j.lead_sources ?? []) as LeadSource[];
  const campaigns = (j.campaigns ?? []) as Campaign[];
  const products = (j.products ?? []) as Product[];
  const opportunities = (j.opportunities ?? []) as Opportunity[];
  const meetings = (j.meetings ?? []) as Meeting[];
  const billingSchedules = (j.billing_schedules ?? []) as BillingSchedule[];
  const activities = (j.activities ?? []) as Activity[];
  const tasks = (j.tasks ?? []) as Task[];
  const stageHistories = (j.stage_histories ?? []) as StageHistory[];
  const salesTargets = (j.sales_targets ?? []) as SalesTarget[];
  const repTargets = (j.rep_targets ?? []) as RepTarget[];
  const seminarResponses = (j.seminar_responses ?? []) as SeminarResponse[];
  const leadImportBatches = (j.lead_import_batches ?? []) as LeadImportBatch[];
  const acquirerAliases = (j.acquirer_aliases ?? []) as AcquirerAlias[];

  accounts.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  campaigns.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  leadImportBatches.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const users: User[] = profiles.map((p) => ({
    id: p.id,
    name: p.display_name ?? p.email ?? "—",
    email: p.email ?? "",
    avatarColor: p.avatar_color ?? "#008C8C",
  }));

  const accountsArr = accounts;
  const leadSourcesArr = leadSources;
  const campaignsArr = campaigns;
  const productsArr = products;

  return {
    ctx,
    users,
    usersById: new Map(users.map((u) => [u.id, u])),
    memberships,
    accounts: accountsArr,
    accountsById: new Map(accountsArr.map((a) => [a.id, a])),
    contacts,
    leadSources: leadSourcesArr,
    leadSourcesById: new Map(leadSourcesArr.map((l) => [l.id, l])),
    campaigns: campaignsArr,
    campaignsById: new Map(campaignsArr.map((c) => [c.id, c])),
    products: productsArr,
    productsById: new Map(productsArr.map((p) => [p.id, p])),
    opportunities,
    meetings,
    billingSchedules,
    activities,
    tasks,
    stageHistories,
    salesTargets,
    repTargets,
    seminarResponses,
    leadImportBatches,
    acquirerAliases,
  };
});

/**
 * 軽量版ワークスペース。案件(OppView)とKPIに必要なテーブルのみ読み込む。
 * contacts / meetings / billing / activities / stage_histories / seminar /
 * 取込履歴 / 取得担当別名 は読み込まない(空配列)。
 * → ダッシュボード等、詳細データが不要な高頻度ページの初期表示を高速化。
 */
export const getWorkspaceLite = cache(async (): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  // 1往復のRPCで参照データをまとめて取得(RLS準拠)。逐次/並列の多数クエリを排除。
  const { data } = await sb.rpc("workspace_lite");
  const j = (data ?? {}) as Record<string, unknown[]>;
  const profiles = (j.profiles ?? []) as ProfileRow[];
  const memberships = (j.memberships ?? []) as Membership[];
  const accounts = (j.accounts ?? []) as Account[];
  const leadSources = (j.lead_sources ?? []) as LeadSource[];
  const campaigns = (j.campaigns ?? []) as Campaign[];
  const products = (j.products ?? []) as Product[];
  const opportunities = (j.opportunities ?? []) as Opportunity[];
  const tasks = (j.tasks ?? []) as Task[];
  const salesTargets = (j.sales_targets ?? []) as SalesTarget[];
  const repTargets = (j.rep_targets ?? []) as RepTarget[];

  accounts.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const users: User[] = profiles.map((p) => ({
    id: p.id, name: p.display_name ?? p.email ?? "—", email: p.email ?? "", avatarColor: p.avatar_color ?? "#008C8C",
  }));

  return {
    ctx,
    users,
    usersById: new Map(users.map((u) => [u.id, u])),
    memberships,
    accounts,
    accountsById: new Map(accounts.map((a) => [a.id, a])),
    contacts: [],
    leadSources,
    leadSourcesById: new Map(leadSources.map((l) => [l.id, l])),
    campaigns,
    campaignsById: new Map(campaigns.map((c) => [c.id, c])),
    products,
    productsById: new Map(products.map((p) => [p.id, p])),
    opportunities,
    meetings: [],
    billingSchedules: [],
    activities: [],
    tasks,
    stageHistories: [],
    salesTargets,
    repTargets,
    seminarResponses: [],
    leadImportBatches: [],
    acquirerAliases: [],
  };
});
