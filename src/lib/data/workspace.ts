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
  Lead,
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
  leads: Lead[];
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

/**
 * PostgREST の1リクエスト上限(既定1000行)を超えるテーブルを全件取得する。
 * 1000行未満なら1リクエストで終了するため、小さいテーブルに追加コストは無い。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const getWorkspace = cache(async (): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const [
    profiles,
    memberships,
    accounts,
    contacts,
    leadSources,
    campaigns,
    products,
    leads,
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
  ] = await Promise.all([
    fetchAll<ProfileRow>(() => sb.from("profiles").select("id, email, display_name, avatar_color")),
    fetchAll<Membership>(() => sb.from("memberships").select("*")),
    fetchAll<Account>(() => sb.from("accounts").select("*").order("name")),
    fetchAll<Contact>(() => sb.from("contacts").select("*").order("id")),
    fetchAll<LeadSource>(() => sb.from("lead_sources").select("*").order("created_at")),
    fetchAll<Campaign>(() => sb.from("campaigns").select("*").order("sort_order")),
    fetchAll<Product>(() => sb.from("products").select("*").order("created_at")),
    fetchAll<Lead>(() => sb.from("leads").select("*").order("acquired_at", { ascending: false }).order("id")),
    fetchAll<Opportunity>(() => sb.from("opportunities").select("*").order("id")),
    fetchAll<Meeting>(() => sb.from("meetings").select("*").order("meeting_date", { ascending: false }).order("id")),
    fetchAll<BillingSchedule>(() => sb.from("billing_schedules").select("*")),
    fetchAll<Activity>(() => sb.from("activities").select("*").order("activity_at", { ascending: false }).order("id")),
    fetchAll<Task>(() => sb.from("tasks").select("*").order("id")),
    fetchAll<StageHistory>(() => sb.from("stage_histories").select("*").order("changed_at", { ascending: false }).order("id")),
    fetchAll<SalesTarget>(() => sb.from("sales_targets").select("*")),
    fetchAll<RepTarget>(() => sb.from("rep_targets").select("*")),
    fetchAll<SeminarResponse>(() => sb.from("seminar_responses").select("*").order("responded_at")),
    fetchAll<LeadImportBatch>(() => sb.from("lead_import_batches").select("*").order("created_at", { ascending: false })),
    fetchAll<AcquirerAlias>(() => sb.from("acquirer_aliases").select("*")),
  ]);

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
    leads,
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
