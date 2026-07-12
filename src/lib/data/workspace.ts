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


/**
 * 小さいマスタ群のみ取得（profiles/memberships/lead_sources/campaigns/products）。
 * 詳細ページ用のスコープ付きワークスペース構築に使う。約150KB（fullの2.1MBに対し軽量）。
 */
async function fetchMasters(sb: ReturnType<typeof getSupabaseServer>) {
  const [profilesR, membershipsR, leadSourcesR, campaignsR, productsR] = await Promise.all([
    sb.from("profiles").select("id,email,display_name,avatar_color"),
    sb.from("memberships").select("*"),
    sb.from("lead_sources").select("*"),
    sb.from("campaigns").select("*"),
    sb.from("products").select("*"),
  ]);
  const profiles = (profilesR.data ?? []) as ProfileRow[];
  const memberships = (membershipsR.data ?? []) as Membership[];
  const leadSources = (leadSourcesR.data ?? []) as LeadSource[];
  const campaigns = ((campaignsR.data ?? []) as Campaign[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const products = (productsR.data ?? []) as Product[];
  const users: User[] = profiles.map((p) => ({
    id: p.id, name: p.display_name ?? p.email ?? "—", email: p.email ?? "", avatarColor: p.avatar_color ?? "#008C8C",
  }));
  return {
    users,
    usersById: new Map(users.map((u) => [u.id, u])),
    memberships,
    leadSources,
    leadSourcesById: new Map(leadSources.map((l) => [l.id, l])),
    campaigns,
    campaignsById: new Map(campaigns.map((c) => [c.id, c])),
    products,
    productsById: new Map(products.map((p) => [p.id, p])),
  };
}

/**
 * メンバー一覧だけが必要なページ用の超軽量フェッチャ(profiles+membershipsのみ、数KB)。
 * listMembers(getWorkspaceLite()) の置き換え。lite(accounts+opps全件≈800KB)の転送を避ける。
 */
export const getMembersLite = cache(
  async (): Promise<{ user: User; role: Membership["role"]; repStatus?: string }[]> => {
    const sb = getSupabaseServer();
    const [profilesR, membershipsR] = await Promise.all([
      sb.from("profiles").select("id,email,display_name,avatar_color"),
      sb.from("memberships").select("*"),
    ]);
    const profiles = (profilesR.data ?? []) as ProfileRow[];
    const usersById = new Map(
      profiles.map((p) => [
        p.id,
        { id: p.id, name: p.display_name ?? p.email ?? "—", email: p.email ?? "", avatarColor: p.avatar_color ?? "#008C8C" } as User,
      ]),
    );
    return ((membershipsR.data ?? []) as Membership[]).flatMap((m) => {
      const user = usersById.get(m.user_id);
      return user ? [{ user, role: m.role, repStatus: m.rep_status as string | undefined }] : [];
    });
  },
);

/** 空配列の共通スロット（スコープ付きワークスペースで未使用の領域）。 */
const EMPTY_SLOTS = {
  salesTargets: [] as SalesTarget[],
  repTargets: [] as RepTarget[],
  seminarResponses: [] as SeminarResponse[],
  leadImportBatches: [] as LeadImportBatch[],
  acquirerAliases: [] as AcquirerAlias[],
};

/**
 * 案件詳細ページ用のスコープ付きワークスペース。対象案件1件＋その子(商談/活動/請求/
 * タスク/履歴)＋所属顧客とその担当者＋マスタのみ取得。full(2.1MB)を回避し数十KBに。
 */
export const getWorkspaceForOpportunity = cache(async (id: string): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data: oppRow } = await sb.from("opportunities").select("*").eq("id", id).maybeSingle();
  const opp = oppRow as Opportunity | null;
  const accountId = opp?.account_id;

  const [masters, accountR, meetingsR, activitiesR, billingR, tasksR, stageR, contactsR] = await Promise.all([
    fetchMasters(sb),
    accountId ? sb.from("accounts").select("*").eq("id", accountId).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("meetings").select("*").eq("opportunity_id", id),
    sb.from("activities").select("*").eq("opportunity_id", id),
    sb.from("billing_schedules").select("*").eq("opportunity_id", id),
    sb.from("tasks").select("*").eq("opportunity_id", id),
    sb.from("stage_histories").select("*").eq("opportunity_id", id),
    accountId ? sb.from("contacts").select("*").eq("account_id", accountId) : Promise.resolve({ data: [] }),
  ]);
  const accounts = (accountR.data ? [accountR.data] : []) as Account[];
  return {
    ctx,
    ...masters,
    accounts,
    accountsById: new Map(accounts.map((a) => [a.id, a])),
    contacts: (contactsR.data ?? []) as Contact[],
    opportunities: opp ? [opp] : [],
    meetings: (meetingsR.data ?? []) as Meeting[],
    billingSchedules: (billingR.data ?? []) as BillingSchedule[],
    activities: (activitiesR.data ?? []) as Activity[],
    tasks: (tasksR.data ?? []) as Task[],
    stageHistories: (stageR.data ?? []) as StageHistory[],
    ...EMPTY_SLOTS,
  };
});

/**
 * 顧客詳細ページ用のスコープ付きワークスペース。対象顧客1件＋その案件/商談/担当者＋マスタのみ。
 */
export const getWorkspaceForAccount = cache(async (id: string): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [masters, accountR, oppsR, meetingsR, contactsR] = await Promise.all([
    fetchMasters(sb),
    sb.from("accounts").select("*").eq("id", id).maybeSingle(),
    sb.from("opportunities").select("*").eq("account_id", id),
    sb.from("meetings").select("*").eq("account_id", id),
    sb.from("contacts").select("*").eq("account_id", id),
  ]);
  const accounts = (accountR.data ? [accountR.data] : []) as Account[];
  return {
    ctx,
    ...masters,
    accounts,
    accountsById: new Map(accounts.map((a) => [a.id, a])),
    contacts: (contactsR.data ?? []) as Contact[],
    opportunities: (oppsR.data ?? []) as Opportunity[],
    meetings: (meetingsR.data ?? []) as Meeting[],
    billingSchedules: [],
    activities: [],
    tasks: [],
    stageHistories: [],
    ...EMPTY_SLOTS,
  };
});

export const getWorkspace = cache(async (): Promise<Workspace> => {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  // 1往復のRPCで全参照データを取得(RLS準拠)。多数クエリの往復を排除。
  const { data, error } = await sb.rpc("workspace_full");
  // エラーを握り潰して空データで描画すると「目標0円で上書き保存」等の事故につながるため必ずthrow(error.tsxで再読込を促す)
  if (error) throw new Error(`workspace_full の取得に失敗しました: ${error.message}`);
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
  const { data, error } = await sb.rpc("workspace_lite");
  if (error) throw new Error(`workspace_lite の取得に失敗しました: ${error.message}`);
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
