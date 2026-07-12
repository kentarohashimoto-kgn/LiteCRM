/**
 * freee 連携の高レベル操作（Layer①）。
 * 自動連携（Server Action / cron）と MCP が共通で呼ぶ。すべて service role で
 * freee_* テーブルへ書き、freee_sync_log に監査を残す。
 *
 * 承認フローの実装方針:
 *   見積・請求とも「下書き（draft）」は **freeeを叩かずCRM側に保存**するだけ。
 *   承認者が「発行」した時に初めて freee へ push する。これにより
 *   未承認の伝票が freee に作られない。
 */
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getFreeeClient } from "./client";
import type { FreeePartner, PartnerMatch, LinkDecision, FreeeInvoice } from "./types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** 会社名の正規化（名寄せ用）。法人格・記号・空白を除去して比較する。 */
function normalizeName(s: string): string {
  return (s || "")
    .replace(/株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|（有）/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/[・.,、。]/g, "")
    .toLowerCase()
    .trim();
}

async function logSync(
  admin: Admin,
  row: {
    tenant_id: string;
    op: string;
    direction?: "push" | "pull";
    entity?: string;
    crm_id?: string | null;
    freee_id?: number | null;
    result?: "ok" | "error";
    message?: string;
    created_by?: string | null;
  },
) {
  try {
    await admin.from("freee_sync_log").insert({ direction: "push", result: "ok", ...row });
  } catch {
    /* ログ失敗は本処理を止めない */
  }
}

// ===================== マスタ（取引先）名寄せ =====================

/**
 * freee の取引先を取得し、CRM顧客(accounts)との名寄せ候補を返す（書き込みはしない）。
 * ユーザーが行ごとに「名称変更」or「外部キー接続のみ」を選ぶための材料。
 */
export async function importPartners(tenantId: string): Promise<PartnerMatch[]> {
  const client = await getFreeeClient(tenantId);
  const admin = getSupabaseAdmin();

  // freee 取引先（ページング。上限は現実的な範囲で）
  const partners: FreeePartner[] = [];
  for (let offset = 0; offset < 3000; offset += 100) {
    const res = await client.api<{ partners: FreeePartner[] }>("/api/1/partners", {
      query: { company_id: client.companyId, limit: 100, offset },
    });
    const batch = res.partners ?? [];
    partners.push(...batch);
    if (batch.length < 100) break;
  }

  const [{ data: accounts }, { data: links }] = await Promise.all([
    admin.from("accounts").select("id, name").eq("tenant_id", tenantId).is("deleted_at", null),
    admin.from("freee_links").select("crm_id, freee_id").eq("tenant_id", tenantId).eq("entity_type", "account"),
  ]);
  const accList = (accounts ?? []) as { id: string; name: string }[];
  const byNorm = new Map<string, { id: string; name: string }>();
  for (const a of accList) byNorm.set(normalizeName(a.name), a);
  const linkedFreeeIds = new Set((links ?? []).map((l) => Number((l as { freee_id: number }).freee_id)));

  return partners.map((p): PartnerMatch => {
    const already = linkedFreeeIds.has(p.id);
    const hit = byNorm.get(normalizeName(p.name));
    if (!hit) {
      return { freee_id: p.id, freee_name: p.name, account_id: null, account_name: null, kind: "unmatched", already_linked: already };
    }
    const kind = hit.name.trim() === p.name.trim() ? "exact" : "diff";
    return { freee_id: p.id, freee_name: p.name, account_id: hit.id, account_name: hit.name, kind, already_linked: already };
  });
}

/**
 * 名寄せの意思決定を反映する。
 *   mode='renamed' … CRM顧客名を freee 名称に合わせて変更（都度確認済みの明示操作のみ）
 *   mode='linked'  … 名称は各自維持し、対応表(freee_links)だけ作る
 */
export async function applyPartnerDecision(tenantId: string, userId: string | null, decision: LinkDecision): Promise<void> {
  const admin = getSupabaseAdmin();
  if (decision.mode === "renamed") {
    await admin.from("accounts").update({ name: decision.freee_name }).eq("id", decision.account_id).eq("tenant_id", tenantId);
  }
  await admin.from("freee_links").upsert(
    {
      tenant_id: tenantId,
      entity_type: "account",
      crm_id: decision.account_id,
      freee_id: decision.freee_id,
      freee_name: decision.freee_name,
      link_mode: decision.mode,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,entity_type,crm_id" },
  );
  await logSync(admin, { tenant_id: tenantId, op: "link_partner", entity: "account", crm_id: decision.account_id, freee_id: decision.freee_id, message: decision.mode, created_by: userId });
}

/** CRMで新規作成した顧客を freee 取引先として登録し、対応表に保存する（今後の新規=CRMが正）。 */
export async function pushAccountToFreee(tenantId: string, userId: string | null, accountId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data: acc } = await admin.from("accounts").select("id, name").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!acc) throw new Error("顧客が見つかりません");
  const client = await getFreeeClient(tenantId);
  const res = await client.api<{ partner: FreeePartner }>("/api/1/partners", {
    method: "POST",
    body: { company_id: client.companyId, name: (acc as { name: string }).name },
  });
  const freeeId = res.partner.id;
  await admin.from("freee_links").upsert(
    { tenant_id: tenantId, entity_type: "account", crm_id: accountId, freee_id: freeeId, freee_name: (acc as { name: string }).name, link_mode: "linked", synced_at: new Date().toISOString() },
    { onConflict: "tenant_id,entity_type,crm_id" },
  );
  await logSync(admin, { tenant_id: tenantId, op: "push_partner", entity: "account", crm_id: accountId, freee_id: freeeId, created_by: userId });
  return freeeId;
}

// ===================== 見積（下書き→発行） =====================

interface OppRow {
  id: string;
  name: string;
  amount: number | null;
  account_id: string | null;
  tenant_id: string;
}

async function loadOpp(admin: Admin, tenantId: string, oppId: string): Promise<OppRow> {
  const { data } = await admin.from("opportunities").select("id, name, amount, account_id, tenant_id").eq("id", oppId).eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw new Error("案件が見つかりません");
  return data as OppRow;
}

/** 案件の請求先 freee 取引先ID（未名寄せならエラーで名寄せ/pushを促す）。 */
async function partnerIdForOpp(admin: Admin, tenantId: string, opp: OppRow): Promise<number> {
  if (!opp.account_id) throw new Error("案件に顧客が紐づいていません");
  const { data: link } = await admin
    .from("freee_links")
    .select("freee_id")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "account")
    .eq("crm_id", opp.account_id)
    .maybeSingle();
  if (link) return Number((link as { freee_id: number }).freee_id);
  // 未名寄せなら freee へ push して対応を作る
  return pushAccountToFreee(tenantId, null, opp.account_id);
}

/**
 * 見積の下書きを作成（freeeは叩かず、CRMの freee_quotes に draft を保存）。
 * 承認者が issueQuote を実行するまで freee には作られない。
 */
export async function createQuoteDraft(tenantId: string, userId: string | null, opportunityId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const opp = await loadOpp(admin, tenantId, opportunityId);
  const { data, error } = await admin
    .from("freee_quotes")
    .insert({ tenant_id: tenantId, opportunity_id: opportunityId, status: "draft", amount: opp.amount ?? 0, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logSync(admin, { tenant_id: tenantId, op: "quote_draft", entity: "opportunity", crm_id: opportunityId, created_by: userId });
  return (data as { id: string }).id;
}

/** 見積の下書きを freee へ発行する（承認後）。freee見積書を作成し番号を保存。 */
export async function issueQuote(tenantId: string, userId: string | null, quoteRowId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: q } = await admin.from("freee_quotes").select("id, opportunity_id, amount, status").eq("id", quoteRowId).eq("tenant_id", tenantId).maybeSingle();
  if (!q) throw new Error("見積下書きが見つかりません");
  const quote = q as { id: string; opportunity_id: string; amount: number; status: string };
  if (quote.status === "issued") return;
  const opp = await loadOpp(admin, tenantId, quote.opportunity_id);
  const client = await getFreeeClient(tenantId);
  const partnerId = await partnerIdForOpp(admin, tenantId, opp);

  const res = await client.api<{ quotation: { id: number; quotation_number: string } }>("/api/1/quotations", {
    method: "POST",
    body: {
      company_id: client.companyId,
      partner_id: partnerId,
      quotation_contents: [
        { order: 0, type: "normal", description: opp.name, unit: "式", qty: 1, unit_price: quote.amount, vat: 10 },
      ],
    },
  });
  await admin
    .from("freee_quotes")
    .update({ status: "issued", freee_quotation_id: res.quotation.id, quote_number: res.quotation.quotation_number, issued_at: new Date().toISOString() })
    .eq("id", quoteRowId);
  await logSync(admin, { tenant_id: tenantId, op: "quote_issue", entity: "opportunity", crm_id: opp.id, freee_id: res.quotation.id, created_by: userId });
}

// ===================== 検収 → 請求（下書き→発行） =====================

/**
 * 請求スケジュールに検収を記録し、請求書の下書き（CRM側のみ）を生成する。
 * billing_status: pending → accepted →（下書き作成後）drafted。
 */
export async function recordAcceptanceAndDraft(tenantId: string, userId: string | null, billingScheduleId: string, acceptedOn: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data: bs } = await admin
    .from("billing_schedules")
    .select("id, opportunity_id, amount, billing_date, kind")
    .eq("id", billingScheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!bs) throw new Error("請求予定が見つかりません");
  const sched = bs as { id: string; opportunity_id: string; amount: number; billing_date: string | null; kind: string };

  await admin.from("billing_schedules").update({ accepted_on: acceptedOn, billing_status: "accepted" }).eq("id", billingScheduleId);

  // 既に下書き/発行済みがあれば重複作成しない（冪等）
  const { data: existing } = await admin.from("freee_invoices").select("id").eq("billing_schedule_id", billingScheduleId).eq("tenant_id", tenantId).maybeSingle();
  if (existing) {
    await admin.from("billing_schedules").update({ billing_status: "drafted" }).eq("id", billingScheduleId);
    return (existing as { id: string }).id;
  }

  const { data, error } = await admin
    .from("freee_invoices")
    .insert({
      tenant_id: tenantId,
      billing_schedule_id: billingScheduleId,
      opportunity_id: sched.opportunity_id,
      status: "draft",
      amount: sched.amount,
      issue_date: acceptedOn,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await admin.from("billing_schedules").update({ billing_status: "drafted" }).eq("id", billingScheduleId);
  await logSync(admin, { tenant_id: tenantId, op: "invoice_draft", entity: "billing", crm_id: sched.opportunity_id, created_by: userId });
  return (data as { id: string }).id;
}

/** 請求書の下書きを freee へ発行する（承認後）。freee請求書を作成し番号・支払期日を保存。 */
export async function issueInvoice(tenantId: string, userId: string | null, invoiceRowId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: inv } = await admin.from("freee_invoices").select("id, opportunity_id, billing_schedule_id, amount, issue_date, status").eq("id", invoiceRowId).eq("tenant_id", tenantId).maybeSingle();
  if (!inv) throw new Error("請求下書きが見つかりません");
  const invoice = inv as { id: string; opportunity_id: string; billing_schedule_id: string | null; amount: number; issue_date: string | null; status: string };
  if (invoice.status !== "draft") return;
  const opp = await loadOpp(admin, tenantId, invoice.opportunity_id);
  const client = await getFreeeClient(tenantId);
  const partnerId = await partnerIdForOpp(admin, tenantId, opp);

  const res = await client.api<{ invoice: FreeeInvoice }>("/api/1/invoices", {
    method: "POST",
    body: {
      company_id: client.companyId,
      partner_id: partnerId,
      billing_date: invoice.issue_date ?? undefined,
      invoice_contents: [
        { order: 0, type: "normal", description: opp.name, unit: "式", qty: 1, unit_price: invoice.amount, vat: 10 },
      ],
    },
  });
  await admin
    .from("freee_invoices")
    .update({ status: "issued", freee_invoice_id: res.invoice.id, invoice_number: res.invoice.invoice_number, due_date: res.invoice.due_date, issue_date: res.invoice.billing_date ?? invoice.issue_date })
    .eq("id", invoiceRowId);
  if (invoice.billing_schedule_id) {
    await admin.from("billing_schedules").update({ billing_status: "issued" }).eq("id", invoice.billing_schedule_id);
  }
  await logSync(admin, { tenant_id: tenantId, op: "invoice_issue", entity: "billing", crm_id: opp.id, freee_id: res.invoice.id, created_by: userId });
}

// ===================== 入金消込の取り込み（pull） =====================

/** 発行済み請求書の入金状況を freee から取得し、paid を反映する。 */
export async function syncPayments(tenantId: string, userId: string | null): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data: rows } = await admin
    .from("freee_invoices")
    .select("id, freee_invoice_id, billing_schedule_id")
    .eq("tenant_id", tenantId)
    .eq("status", "issued")
    .not("freee_invoice_id", "is", null);
  const issued = (rows ?? []) as { id: string; freee_invoice_id: number; billing_schedule_id: string | null }[];
  if (issued.length === 0) return 0;
  const client = await getFreeeClient(tenantId);

  let updated = 0;
  for (const r of issued) {
    try {
      const res = await client.api<{ invoice: FreeeInvoice }>(`/api/1/invoices/${r.freee_invoice_id}`, { query: { company_id: client.companyId } });
      if (res.invoice.payment_status === "settled") {
        await admin.from("freee_invoices").update({ status: "paid", paid_at: new Date().toISOString().slice(0, 10) }).eq("id", r.id);
        if (r.billing_schedule_id) await admin.from("billing_schedules").update({ billing_status: "paid" }).eq("id", r.billing_schedule_id);
        updated++;
      }
    } catch {
      /* 個別の失敗はスキップして続行 */
    }
  }
  await logSync(admin, { tenant_id: tenantId, op: "pull_payments", direction: "pull", result: "ok", message: `updated ${updated}`, created_by: userId });
  return updated;
}
