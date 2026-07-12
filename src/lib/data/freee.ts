import { getSupabaseServer } from "@/lib/supabase/server";
import type { FreeeStatus } from "@/lib/freee/types";

export interface FreeeInvoiceRow {
  id: string;
  opportunity_id: string | null;
  invoice_number: string | null;
  status: string;
  amount: number;
  issue_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  account_name: string | null;
}

export interface FreeeLinkRow {
  crm_id: string;
  freee_id: number;
  freee_name: string | null;
  link_mode: string;
}

export interface FreeeSyncLogRow {
  id: string;
  op: string;
  direction: string;
  result: string;
  message: string | null;
  created_at: string;
}

export interface FreeeOverview {
  status: FreeeStatus;
  invoices: FreeeInvoiceRow[];
  linkCount: number;
  log: FreeeSyncLogRow[];
  overdueCount: number;
}

/** freee連携の設定画面向けデータ（RLSは is_finance が担保）。 */
export async function getFreeeOverview(): Promise<FreeeOverview> {
  const sb = getSupabaseServer();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const [{ data: statusData }, invR, linkR, logR] = await Promise.all([
    sb.rpc("freee_status"),
    sb
      .from("freee_invoices")
      .select("id, opportunity_id, invoice_number, status, amount, issue_date, due_date, paid_at, opportunities(accounts(name))")
      .order("created_at", { ascending: false })
      .limit(100),
    sb.from("freee_links").select("crm_id").eq("entity_type", "account"),
    sb.from("freee_sync_log").select("id, op, direction, result, message, created_at").order("created_at", { ascending: false }).limit(30),
  ]);

  const status = (statusData as FreeeStatus | null) ?? { connected: false };
  const invoices: FreeeInvoiceRow[] = ((invR.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const opp = r.opportunities as { accounts: { name: string } | null } | null;
    return {
      id: r.id as string,
      opportunity_id: (r.opportunity_id as string) ?? null,
      invoice_number: (r.invoice_number as string) ?? null,
      status: r.status as string,
      amount: (r.amount as number) ?? 0,
      issue_date: (r.issue_date as string) ?? null,
      due_date: (r.due_date as string) ?? null,
      paid_at: (r.paid_at as string) ?? null,
      account_name: opp?.accounts?.name ?? null,
    };
  });
  const overdueCount = invoices.filter((i) => i.status === "issued" && i.due_date && i.due_date < today).length;

  return {
    status,
    invoices,
    linkCount: (linkR.data ?? []).length,
    log: (logR.data ?? []) as FreeeSyncLogRow[],
    overdueCount,
  };
}

// ===================== 案件詳細向け（検収→請求 / 見積） =====================

export interface OppBillingRow {
  id: string;
  kind: string;
  amount: number;
  billing_date: string | null;
  note: string | null;
  accepted_on: string | null;
  billing_status: string;
}
export interface OppInvoiceRow {
  id: string;
  billing_schedule_id: string | null;
  status: string;
  amount: number;
  invoice_number: string | null;
  due_date: string | null;
}
export interface OppQuoteRow {
  id: string;
  status: string;
  amount: number;
  quote_number: string | null;
}
export interface OppFreeeData {
  connected: boolean;
  billing: OppBillingRow[];
  invoices: OppInvoiceRow[];
  quotes: OppQuoteRow[];
}

/** 案件詳細の「検収→請求 / 見積」パネル向けデータ。経理ロールでのみ意味を持つ（RLSで担保）。 */
export async function getOppFreeeData(opportunityId: string): Promise<OppFreeeData> {
  const sb = getSupabaseServer();
  const [{ data: statusData }, bsR, invR, quoteR] = await Promise.all([
    sb.rpc("freee_status"),
    sb.from("billing_schedules").select("id, kind, amount, billing_date, note, accepted_on, billing_status").eq("opportunity_id", opportunityId).order("billing_date"),
    sb.from("freee_invoices").select("id, billing_schedule_id, status, amount, invoice_number, due_date").eq("opportunity_id", opportunityId),
    sb.from("freee_quotes").select("id, status, amount, quote_number").eq("opportunity_id", opportunityId).order("created_at", { ascending: false }),
  ]);
  const status = (statusData as FreeeStatus | null) ?? { connected: false };
  return {
    connected: Boolean(status.connected),
    billing: (bsR.data ?? []) as OppBillingRow[],
    invoices: (invR.data ?? []) as OppInvoiceRow[],
    quotes: (quoteR.data ?? []) as OppQuoteRow[],
  };
}
