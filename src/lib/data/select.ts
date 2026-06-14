/**
 * Workspace スナップショットに対する純粋な参照ヘルパー。
 * 行は RLS でスコープ済みなので、ここでは結合(view化)と整形のみ行う。
 */

import type { Workspace } from "./workspace";
import type {
  Account,
  Activity,
  BillingSchedule,
  Campaign,
  Contact,
  LeadSource,
  Meeting,
  Opportunity,
  Product,
  Role,
  StageHistory,
  Task,
  User,
} from "@/lib/types";

export interface MeetingView extends Meeting {
  owner?: User;
  account?: Account;
  opportunity?: Opportunity;
}

export interface OppView extends Opportunity {
  account?: Account;
  owner?: User;
  product?: Product;
  leadSource?: LeadSource;
  campaign?: Campaign;
  weighted: number;
}

export function getUser(ws: Workspace, id?: string): User | undefined {
  return id ? ws.usersById.get(id) : undefined;
}
export function getAccount(ws: Workspace, id?: string): Account | undefined {
  return id ? ws.accountsById.get(id) : undefined;
}
export function getProduct(ws: Workspace, id?: string): Product | undefined {
  return id ? ws.productsById.get(id) : undefined;
}
export function getLeadSource(ws: Workspace, id?: string): LeadSource | undefined {
  return id ? ws.leadSourcesById.get(id) : undefined;
}
export function getCampaign(ws: Workspace, id?: string): Campaign | undefined {
  return id ? ws.campaignsById.get(id) : undefined;
}

export function toOppView(ws: Workspace, o: Opportunity): OppView {
  return {
    ...o,
    account: getAccount(ws, o.account_id),
    owner: getUser(ws, o.owner_user_id),
    product: getProduct(ws, o.primary_product_id),
    leadSource: getLeadSource(ws, o.lead_source_id),
    campaign: getCampaign(ws, o.campaign_id),
    weighted: Math.round((o.amount * o.probability) / 100),
  };
}

export function listOpportunities(ws: Workspace): OppView[] {
  return ws.opportunities.map((o) => toOppView(ws, o));
}

export function getOpportunity(ws: Workspace, id: string): OppView | undefined {
  const o = ws.opportunities.find((x) => x.id === id);
  return o ? toOppView(ws, o) : undefined;
}

export function listAccounts(ws: Workspace): Account[] {
  return ws.accounts;
}

export function getContactsByAccount(ws: Workspace, accountId: string): Contact[] {
  return ws.contacts.filter((c) => c.account_id === accountId);
}

export function listContacts(ws: Workspace): Contact[] {
  return ws.contacts;
}

export function listTasks(ws: Workspace): Task[] {
  return ws.tasks;
}

export function listActivities(ws: Workspace): Activity[] {
  return ws.activities;
}

export function getActivitiesByOpportunity(ws: Workspace, id: string): Activity[] {
  return ws.activities
    .filter((a) => a.opportunity_id === id)
    .sort((a, b) => +new Date(b.activity_at) - +new Date(a.activity_at));
}

export function getTasksByOpportunity(ws: Workspace, id: string): Task[] {
  return ws.tasks.filter((t) => t.opportunity_id === id);
}

function toMeetingView(ws: Workspace, m: Meeting): MeetingView {
  return {
    ...m,
    owner: getUser(ws, m.owner_user_id),
    account: getAccount(ws, m.account_id),
    opportunity: ws.opportunities.find((o) => o.id === m.opportunity_id),
  };
}

/** 案件配下の商談(新しい順) */
export function getMeetingsByOpportunity(ws: Workspace, opportunityId: string): MeetingView[] {
  return ws.meetings
    .filter((m) => m.opportunity_id === opportunityId)
    .sort((a, b) => (b.meeting_date ?? "").localeCompare(a.meeting_date ?? ""))
    .map((m) => toMeetingView(ws, m));
}

/** 顧客配下の商談(新しい順) */
export function getMeetingsByAccount(ws: Workspace, accountId: string): MeetingView[] {
  return ws.meetings
    .filter((m) => m.account_id === accountId)
    .sort((a, b) => (b.meeting_date ?? "").localeCompare(a.meeting_date ?? ""))
    .map((m) => toMeetingView(ws, m));
}

export function getMeeting(ws: Workspace, id: string): MeetingView | undefined {
  const m = ws.meetings.find((x) => x.id === id);
  return m ? toMeetingView(ws, m) : undefined;
}

export function getBillingByOpportunity(ws: Workspace, opportunityId: string): BillingSchedule[] {
  return ws.billingSchedules
    .filter((b) => b.opportunity_id === opportunityId)
    .sort((a, b) => (a.billing_date ?? a.recurring_start_month ?? "").localeCompare(b.billing_date ?? b.recurring_start_month ?? ""));
}

export function listBillingSchedules(ws: Workspace): BillingSchedule[] {
  return ws.billingSchedules;
}

export function getStageHistory(ws: Workspace, id: string): StageHistory[] {
  return ws.stageHistories
    .filter((s) => s.opportunity_id === id)
    .sort((a, b) => +new Date(b.changed_at) - +new Date(a.changed_at));
}

export function listMembers(ws: Workspace): { user: User; role: Role; repStatus?: string }[] {
  return ws.memberships.flatMap((m) => {
    const user = ws.usersById.get(m.user_id);
    return user ? [{ user, role: m.role, repStatus: m.rep_status as string | undefined }] : [];
  });
}

export function listRepTargets(ws: Workspace) {
  return ws.repTargets;
}

export function listSeminarResponses(ws: Workspace) {
  return ws.seminarResponses;
}

export function getProducts(ws: Workspace): Product[] {
  return ws.products;
}
export function getLeadSources(ws: Workspace): LeadSource[] {
  return ws.leadSources;
}
export function listCampaigns(ws: Workspace): Campaign[] {
  return ws.campaigns;
}
export function listCampaignsByChannel(ws: Workspace, channel: string): Campaign[] {
  return ws.campaigns.filter((c) => c.channel === channel);
}
export function getSalesTargets(ws: Workspace) {
  return ws.salesTargets;
}
