import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx, type Ctx } from "@/lib/session";
import type {
  Account,
  Activity,
  Campaign,
  Contact,
  Lead,
  LeadSource,
  Membership,
  Opportunity,
  Product,
  SalesTarget,
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
  activities: Activity[];
  tasks: Task[];
  stageHistories: StageHistory[];
  salesTargets: SalesTarget[];
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
    activities,
    tasks,
    stageHistories,
    salesTargets,
  ] = await Promise.all([
    sb.from("profiles").select("id, email, display_name, avatar_color"),
    sb.from("memberships").select("*"),
    sb.from("accounts").select("*").order("name"),
    sb.from("contacts").select("*"),
    sb.from("lead_sources").select("*").order("created_at"),
    sb.from("campaigns").select("*").order("sort_order"),
    sb.from("products").select("*").order("created_at"),
    sb.from("leads").select("*").order("acquired_at", { ascending: false }),
    sb.from("opportunities").select("*"),
    sb.from("activities").select("*").order("activity_at", { ascending: false }),
    sb.from("tasks").select("*"),
    sb.from("stage_histories").select("*").order("changed_at", { ascending: false }),
    sb.from("sales_targets").select("*"),
  ]);

  const users: User[] = (profiles.data ?? []).map((p: ProfileRow) => ({
    id: p.id,
    name: p.display_name ?? p.email ?? "—",
    email: p.email ?? "",
    avatarColor: p.avatar_color ?? "#008C8C",
  }));

  const accountsArr = (accounts.data ?? []) as Account[];
  const leadSourcesArr = (leadSources.data ?? []) as LeadSource[];
  const campaignsArr = (campaigns.data ?? []) as Campaign[];
  const productsArr = (products.data ?? []) as Product[];

  return {
    ctx,
    users,
    usersById: new Map(users.map((u) => [u.id, u])),
    memberships: (memberships.data ?? []) as Membership[],
    accounts: accountsArr,
    accountsById: new Map(accountsArr.map((a) => [a.id, a])),
    contacts: (contacts.data ?? []) as Contact[],
    leadSources: leadSourcesArr,
    leadSourcesById: new Map(leadSourcesArr.map((l) => [l.id, l])),
    campaigns: campaignsArr,
    campaignsById: new Map(campaignsArr.map((c) => [c.id, c])),
    products: productsArr,
    productsById: new Map(productsArr.map((p) => [p.id, p])),
    leads: (leads.data ?? []) as Lead[],
    opportunities: (opportunities.data ?? []) as Opportunity[],
    activities: (activities.data ?? []) as Activity[],
    tasks: (tasks.data ?? []) as Task[],
    stageHistories: (stageHistories.data ?? []) as StageHistory[],
    salesTargets: (salesTargets.data ?? []) as SalesTarget[],
  };
});
