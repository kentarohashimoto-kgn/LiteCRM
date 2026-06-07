/**
 * デモ用インメモリ・データストア + リポジトリ。
 *
 * 本番では Supabase(PostgreSQL + RLS)に置き換える。リポジトリ関数の
 * シグネチャを保てば、呼び出し側(画面)を変えずに差し替え可能。
 *
 * 役割スコープ(scopeOpportunities 等)は、要件 14.2 の簡易RLS方針を
 * アプリ層で再現したもの。Supabase化時は RLS policy が同じ役割を担う。
 */

import { createSeedDatabase, type Database } from "./seed";
import {
  FULL_VIEW_ROLES,
  STAGE_MAP,
} from "@/lib/constants";
import type {
  Account,
  Activity,
  Contact,
  Lead,
  LeadSource,
  Opportunity,
  Product,
  Role,
  Task,
  User,
} from "@/lib/types";

// Next.js dev のホットリロードでも状態を保つためグローバルに保持。
declare global {
  // eslint-disable-next-line no-var
  var __SOS_DB__: Database | undefined;
}

function getDb(): Database {
  if (!global.__SOS_DB__) {
    global.__SOS_DB__ = createSeedDatabase();
  }
  return global.__SOS_DB__;
}

export interface Ctx {
  userId: string;
  role: Role;
  tenantId: string;
}

// ---------- スコープ(RLS相当) ----------
function canSeeOpp(o: Opportunity, ctx: Ctx): boolean {
  if (o.tenant_id !== ctx.tenantId) return false;
  if (FULL_VIEW_ROLES.includes(ctx.role)) return true;
  // sales_rep / external_sales / partner / delivery / finance => 自分担当のみ
  return o.owner_user_id === ctx.userId;
}

export function canEdit(ctx: Ctx): boolean {
  return ctx.role !== "viewer" && ctx.role !== "partner" && ctx.role !== "delivery" && ctx.role !== "finance";
}

export function canExport(ctx: Ctx): boolean {
  // 外部営業はエクスポート不可(11.2)
  return FULL_VIEW_ROLES.includes(ctx.role) && ctx.role !== "viewer";
}

// ---------- マスタ参照 ----------
export function getUsers(): User[] {
  return getDb().users;
}
export function getUser(id?: string): User | undefined {
  if (!id) return undefined;
  return getDb().users.find((u) => u.id === id);
}
export function getMemberships(ctx: Ctx) {
  return getDb().memberships.filter((m) => m.tenant_id === ctx.tenantId);
}
export function getProducts(ctx: Ctx): Product[] {
  return getDb().products.filter((p) => p.tenant_id === ctx.tenantId);
}
export function getProduct(id?: string): Product | undefined {
  if (!id) return undefined;
  return getDb().products.find((p) => p.id === id);
}
export function getLeadSources(ctx: Ctx): LeadSource[] {
  return getDb().leadSources.filter((l) => l.tenant_id === ctx.tenantId);
}
export function getLeadSource(id?: string): LeadSource | undefined {
  if (!id) return undefined;
  return getDb().leadSources.find((l) => l.id === id);
}
export function getTenant(ctx: Ctx) {
  return getDb().tenants.find((t) => t.id === ctx.tenantId);
}
export function getSalesTargets(ctx: Ctx) {
  return getDb().salesTargets.filter((t) => t.tenant_id === ctx.tenantId);
}

// ---------- Accounts ----------
export function getAccount(id?: string): Account | undefined {
  if (!id) return undefined;
  return getDb().accounts.find((a) => a.id === id);
}
export function listAccounts(ctx: Ctx): Account[] {
  const db = getDb();
  const all = db.accounts.filter((a) => a.tenant_id === ctx.tenantId);
  if (FULL_VIEW_ROLES.includes(ctx.role)) return all;
  // own-only: 自分が担当する商談/リードに紐づくaccountのみ
  const visibleAccIds = new Set([
    ...db.opportunities.filter((o) => canSeeOpp(o, ctx)).map((o) => o.account_id),
    ...db.leads.filter((l) => l.owner_user_id === ctx.userId && l.account_id).map((l) => l.account_id!),
  ]);
  return all.filter((a) => visibleAccIds.has(a.id));
}

// ---------- Contacts ----------
export function listContacts(ctx: Ctx): Contact[] {
  const db = getDb();
  const accIds = new Set(listAccounts(ctx).map((a) => a.id));
  return db.contacts.filter((c) => c.tenant_id === ctx.tenantId && accIds.has(c.account_id));
}
export function getContactsByAccount(accountId: string): Contact[] {
  return getDb().contacts.filter((c) => c.account_id === accountId);
}

// ---------- Leads ----------
export function listLeads(ctx: Ctx): Lead[] {
  const db = getDb();
  const all = db.leads.filter((l) => l.tenant_id === ctx.tenantId);
  if (FULL_VIEW_ROLES.includes(ctx.role)) return all;
  return all.filter((l) => l.owner_user_id === ctx.userId);
}

// ---------- Opportunities ----------
export interface OppView extends Opportunity {
  account?: Account;
  owner?: User;
  product?: Product;
  leadSource?: LeadSource;
  weighted: number;
}

function toView(o: Opportunity): OppView {
  return {
    ...o,
    account: getAccount(o.account_id),
    owner: getUser(o.owner_user_id),
    product: getProduct(o.primary_product_id),
    leadSource: getLeadSource(o.lead_source_id),
    weighted: Math.round((o.amount * o.probability) / 100),
  };
}

export function listOpportunities(ctx: Ctx): OppView[] {
  return getDb()
    .opportunities.filter((o) => canSeeOpp(o, ctx))
    .map(toView);
}

export function getOpportunity(ctx: Ctx, id: string): OppView | undefined {
  const o = getDb().opportunities.find((x) => x.id === id);
  if (!o || !canSeeOpp(o, ctx)) return undefined;
  return toView(o);
}

export function getActivitiesByOpportunity(id: string): Activity[] {
  return getDb()
    .activities.filter((a) => a.opportunity_id === id)
    .sort((a, b) => +new Date(b.activity_at) - +new Date(a.activity_at));
}

export function getTasksByOpportunity(id: string): Task[] {
  return getDb().tasks.filter((t) => t.opportunity_id === id);
}

export function getStageHistory(id: string) {
  return getDb()
    .stageHistories.filter((s) => s.opportunity_id === id)
    .sort((a, b) => +new Date(b.changed_at) - +new Date(a.changed_at));
}

// ---------- Activities / Tasks ----------
export function listActivities(ctx: Ctx): Activity[] {
  const visibleOppIds = new Set(listOpportunities(ctx).map((o) => o.id));
  return getDb()
    .activities.filter(
      (a) =>
        a.tenant_id === ctx.tenantId &&
        (a.owner_user_id === ctx.userId ||
          FULL_VIEW_ROLES.includes(ctx.role) ||
          (a.opportunity_id && visibleOppIds.has(a.opportunity_id))),
    )
    .sort((a, b) => +new Date(b.activity_at) - +new Date(a.activity_at));
}

export function listTasks(ctx: Ctx): Task[] {
  const db = getDb();
  const all = db.tasks.filter((t) => t.tenant_id === ctx.tenantId);
  if (FULL_VIEW_ROLES.includes(ctx.role)) return all;
  return all.filter((t) => t.assigned_to === ctx.userId);
}

// ---------- Mutations ----------
function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createOpportunity(ctx: Ctx, input: Partial<Opportunity>): Opportunity {
  const db = getDb();
  const stage = (input.stage ?? "lead_acquired") as Opportunity["stage"];
  const o: Opportunity = {
    id: uid("o"),
    tenant_id: ctx.tenantId,
    account_id: input.account_id!,
    contact_id: input.contact_id,
    owner_user_id: input.owner_user_id ?? ctx.userId,
    name: input.name!,
    stage,
    forecast_category: input.forecast_category ?? "pipeline",
    amount: input.amount ?? 0,
    gross_profit: input.gross_profit,
    gross_profit_rate: input.gross_profit_rate,
    probability: input.probability ?? STAGE_MAP[stage].probability,
    expected_close_date: input.expected_close_date,
    expected_revenue_month: input.expected_revenue_month,
    primary_product_id: input.primary_product_id,
    lead_source_id: input.lead_source_id,
    next_action_date: input.next_action_date,
    next_action_text: input.next_action_text,
    last_activity_at: new Date().toISOString(),
    status: "open",
    notes: input.notes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.opportunities.unshift(o);
  db.stageHistories.push({
    id: uid("sh"),
    tenant_id: ctx.tenantId,
    opportunity_id: o.id,
    to_stage: stage,
    changed_by: ctx.userId,
    reason: "新規作成",
    changed_at: new Date().toISOString(),
  });
  return o;
}

export function updateOpportunity(ctx: Ctx, id: string, patch: Partial<Opportunity>): void {
  const db = getDb();
  const o = db.opportunities.find((x) => x.id === id);
  if (!o || !canSeeOpp(o, ctx)) return;
  const prevStage = o.stage;
  Object.assign(o, patch);
  o.updated_at = new Date().toISOString();
  if (patch.stage && patch.stage !== prevStage) {
    o.probability = STAGE_MAP[patch.stage].probability;
    if (patch.stage === "won") o.status = "won";
    else if (patch.stage === "lost") o.status = "lost";
    else if (patch.stage === "on_hold") o.status = "on_hold";
    else o.status = "open";
    db.stageHistories.push({
      id: uid("sh"),
      tenant_id: ctx.tenantId,
      opportunity_id: o.id,
      from_stage: prevStage,
      to_stage: patch.stage,
      changed_by: ctx.userId,
      reason: patch.notes ?? "ステージ更新",
      changed_at: new Date().toISOString(),
    });
  }
}

export function addActivity(ctx: Ctx, input: Partial<Activity>): void {
  const db = getDb();
  const a: Activity = {
    id: uid("act"),
    tenant_id: ctx.tenantId,
    account_id: input.account_id,
    contact_id: input.contact_id,
    opportunity_id: input.opportunity_id,
    owner_user_id: ctx.userId,
    activity_type: input.activity_type ?? "note",
    title: input.title!,
    body: input.body,
    activity_at: input.activity_at ?? new Date().toISOString(),
    next_action_date: input.next_action_date,
    next_action_text: input.next_action_text,
    created_at: new Date().toISOString(),
  };
  db.activities.push(a);
  if (a.opportunity_id) {
    const o = db.opportunities.find((x) => x.id === a.opportunity_id);
    if (o) {
      o.last_activity_at = a.activity_at;
      if (a.next_action_date) {
        o.next_action_date = a.next_action_date;
        o.next_action_text = a.next_action_text;
      }
    }
  }
}

export function createTask(ctx: Ctx, input: Partial<Task>): void {
  const db = getDb();
  db.tasks.push({
    id: uid("t"),
    tenant_id: ctx.tenantId,
    opportunity_id: input.opportunity_id,
    account_id: input.account_id,
    assigned_to: input.assigned_to ?? ctx.userId,
    created_by: ctx.userId,
    title: input.title!,
    description: input.description,
    due_date: input.due_date!,
    status: "todo",
    priority: input.priority ?? "middle",
  });
}

export function setTaskStatus(ctx: Ctx, id: string, status: Task["status"]): void {
  const db = getDb();
  const t = db.tasks.find((x) => x.id === id && x.tenant_id === ctx.tenantId);
  if (!t) return;
  t.status = status;
  t.completed_at = status === "done" ? new Date().toISOString() : undefined;
}

export function createAccount(ctx: Ctx, input: Partial<Account>): Account {
  const db = getDb();
  const a: Account = {
    id: uid("a"),
    tenant_id: ctx.tenantId,
    owner_user_id: ctx.userId,
    name: input.name!,
    industry: input.industry,
    employee_size: input.employee_size,
    area: input.area,
    status: input.status ?? "prospect",
    priority: input.priority,
    potential: input.potential,
    website_url: input.website_url,
    notes: input.notes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.accounts.unshift(a);
  return a;
}

export function createLead(ctx: Ctx, input: Partial<Lead>): void {
  const db = getDb();
  db.leads.unshift({
    id: uid("l"),
    tenant_id: ctx.tenantId,
    account_id: input.account_id,
    lead_source_id: input.lead_source_id,
    owner_user_id: input.owner_user_id ?? ctx.userId,
    primary_product_id: input.primary_product_id,
    title: input.title!,
    status: input.status ?? "new",
    rank: input.rank,
    acquired_at: input.acquired_at ?? new Date().toISOString().slice(0, 10),
    notes: input.notes,
    created_at: new Date().toISOString(),
  });
}
