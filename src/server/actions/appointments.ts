"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { yomiToFields } from "@/lib/deal-import";
import { normCompany } from "@/lib/lead-import";

// ===================== リード検索(アポ登録用) =====================
export interface ApptLeadHit {
  id: string;
  company: string;
  contact: string | null;
  event: string | null;   // 展示会/獲得イベント
  rank: string | null;
}

/** アポ登録用のリード検索(会社名/担当者名、上位20件)。未案件化のリードを優先表示。 */
export async function searchApptLeadsAction(q: string): Promise<ApptLeadHit[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  let query = sb
    .from("leads")
    .select("id,company_name,contact_name,raw_event,rank,converted_opportunity_id")
    .order("priority_score", { ascending: false })
    .limit(20);
  if (q.trim()) query = query.or(`company_name.ilike.%${q.trim()}%,contact_name.ilike.%${q.trim()}%`);
  const { data } = await query;
  return (data ?? [])
    .filter((l) => !l.converted_opportunity_id) // 既に案件化済みは除外
    .map((l) => ({
      id: l.id as string,
      company: (l.company_name as string) ?? "—",
      contact: (l.contact_name as string) ?? null,
      event: (l.raw_event as string) ?? null,
      rank: (l.rank as string) ?? null,
    }));
}

export interface ApptLeadDetail {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  employee_size: string | null;
  prefecture: string | null;
  raw_event: string | null;
  rank: string | null;
  notes: string | null;
  lead_source_id: string | null;
  campaign_id: string | null;
  marketing_channel_id: string | null;
  account_id: string | null;
}

/** リードの詳細(展示会リストの情報)を取得。フォームのプレフィルと案件コピーに使用。 */
export async function getApptLeadDetailAction(leadId: string): Promise<ApptLeadDetail | null> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("leads")
    .select("id,company_name,contact_name,job_title,department,phone,mobile_phone,email,industry,employee_size,prefecture,raw_event,rank,notes,lead_source_id,campaign_id,marketing_channel_id,account_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    company_name: (data.company_name as string) ?? null,
    contact_name: (data.contact_name as string) ?? null,
    job_title: (data.job_title as string) ?? null,
    department: (data.department as string) ?? null,
    phone: ((data.phone as string) || (data.mobile_phone as string)) ?? null,
    email: (data.email as string) ?? null,
    industry: (data.industry as string) ?? null,
    employee_size: (data.employee_size as string) ?? null,
    prefecture: (data.prefecture as string) ?? null,
    raw_event: (data.raw_event as string) ?? null,
    rank: (data.rank as string) ?? null,
    notes: (data.notes as string) ?? null,
    lead_source_id: (data.lead_source_id as string) ?? null,
    campaign_id: (data.campaign_id as string) ?? null,
    marketing_channel_id: (data.marketing_channel_id as string) ?? null,
    account_id: (data.account_id as string) ?? null,
  };
}

// ===================== アポ登録 =====================
export interface RegisterAppointmentInput {
  leadId: string | null;         // リードから(主動線)
  accountId: string | null;      // 既存顧客から
  newCompanyName: string | null; // 新規登録
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  ownerUserId: string;           // 営業担当(必須)
  date: string;                  // アポ日(必須)
  time: string | null;
  productId: string | null;
  leadSourceId: string | null;
  memo: string | null;           // アポ獲得メモ(話した内容)
  acquiredById: string | null;   // アポ獲得担当者(インサイドセールス)
  acquiredOn: string | null;     // 獲得日
}

export type RegisterAppointmentResult =
  | { ok: true; opportunityId: string; accountId: string; accountName: string }
  | { ok: false; error: string };

/**
 * アポ獲得のワンフォーム登録。リード/既存顧客/新規の3系統。
 * リード起点では展示会リストの詳細を案件(事前リサーチ)へコピーし、リードをアポ決着に更新。
 */
export async function registerAppointmentAction(input: RegisterAppointmentInput): Promise<RegisterAppointmentResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const lead = input.leadId ? await getApptLeadDetailAction(input.leadId) : null;
  if (input.leadId && !lead) return { ok: false, error: "リードが見つかりません" };
  const companyFromLead = lead?.company_name?.trim() || null;

  if (!input.accountId && !input.newCompanyName?.trim() && !companyFromLead) {
    return { ok: false, error: "リードを選択するか、顧客を選択/入力してください" };
  }
  if (!input.ownerUserId) return { ok: false, error: "営業担当を選択してください" };
  if (!input.date) return { ok: false, error: "アポ日を入力してください" };

  // 1) 顧客の解決: 既存選択 > リードの紐付き顧客 > 会社名のnorm一致 > 新規作成
  let accountId = input.accountId ?? lead?.account_id ?? null;
  let accountName = "";
  if (!accountId) {
    const name = (input.newCompanyName?.trim() || companyFromLead)!;
    const norm = normCompany(name);
    const { data: existing } = await sb.from("accounts").select("id,name").limit(1000);
    const hit = (existing ?? []).find((a) => normCompany((a.name as string) ?? "") === norm);
    if (hit) {
      accountId = hit.id as string;
      accountName = hit.name as string;
    } else {
      const { data: created, error } = await sb
        .from("accounts")
        .insert({
          tenant_id: ctx.tenantId,
          owner_user_id: input.ownerUserId,
          name,
          industry: lead?.industry ?? null,
          employee_size: lead?.employee_size ?? null,
          area: lead?.prefecture ?? null,
          status: "prospect",
        })
        .select("id,name")
        .single();
      if (error || !created) return { ok: false, error: "顧客の作成に失敗しました: " + (error?.message ?? "") };
      accountId = created.id as string;
      accountName = created.name as string;
    }
  } else {
    const { data: acc } = await sb.from("accounts").select("name").eq("id", accountId).maybeSingle();
    accountName = (acc?.name as string) ?? "";
  }

  // 2) 担当者(任意・入力かリードのどちらかにあれば)
  const cName = input.contactName?.trim() || lead?.contact_name?.trim();
  if (cName) {
    await sb.from("contacts").insert({
      tenant_id: ctx.tenantId,
      account_id: accountId,
      name: cName,
      title: input.contactTitle?.trim() || lead?.job_title || null,
      department: lead?.department ?? null,
      phone: input.contactPhone?.trim() || lead?.phone || null,
      email: input.contactEmail?.trim() || lead?.email || null,
    });
  }

  // 3) 事前リサーチ: リード詳細(展示会リスト)のコピー + アポ獲得メモ
  const researchParts: string[] = [];
  if (lead) {
    const detail = [
      lead.raw_event ? `獲得イベント: ${lead.raw_event}` : "",
      [lead.department, lead.job_title].filter(Boolean).length ? `部署/役職: ${[lead.department, lead.job_title].filter(Boolean).join(" ")}` : "",
      [lead.industry, lead.employee_size, lead.prefecture].filter(Boolean).length
        ? `業種/規模/地域: ${[lead.industry, lead.employee_size, lead.prefecture].filter(Boolean).join(" / ")}` : "",
      lead.rank ? `リードランク: ${lead.rank}` : "",
      lead.notes ? `リードメモ: ${lead.notes}` : "",
    ].filter(Boolean).join("\n");
    if (detail) researchParts.push("【リード詳細（展示会リストより）】\n" + detail);
  }
  if (input.memo?.trim()) researchParts.push("【アポ獲得メモ】\n" + input.memo.trim());

  // 4) 案件(ヨミ=4.アポ)
  const yf = yomiToFields("4.アポ");
  const appointmentAt = input.time ? `${input.date}T${input.time}:00+09:00` : null;
  let productName: string | null = null;
  if (input.productId) {
    const { data: p } = await sb.from("products").select("name").eq("id", input.productId).maybeSingle();
    productName = (p?.name as string) ?? null;
  }
  const { data: opp, error: oppErr } = await sb
    .from("opportunities")
    .insert({
      tenant_id: ctx.tenantId,
      account_id: accountId,
      lead_id: lead?.id ?? null,
      name: (accountName + (productName ? " / " + productName : "")).slice(0, 200),
      owner_user_id: input.ownerUserId,
      primary_product_id: input.productId,
      lead_source_id: input.leadSourceId || lead?.lead_source_id || null,
      campaign_id: lead?.campaign_id ?? null,
      marketing_channel_id: lead?.marketing_channel_id ?? null,
      source_detail: lead?.raw_event ?? null,
      yomi: "4.アポ",
      stage: yf.stage,
      status: yf.status,
      forecast_category: yf.forecast,
      probability: yf.probability,
      amount: 0,
      first_meeting_date: input.date,
      appointment_at: appointmentAt,
      next_action_date: input.date,
      next_action_text: "初回商談（アポ）" + (input.time ? ` ${input.time}` : ""),
      pre_research: researchParts.length ? researchParts.join("\n\n") : null,
      appt_acquired_by: input.acquiredById || ctx.userId,
      appt_acquired_on: input.acquiredOn || new Date().toISOString().slice(0, 10),
      last_activity_at: new Date().toISOString(),
      campaign_estimated: false,
    })
    .select("id")
    .single();
  if (oppErr || !opp) return { ok: false, error: "案件の作成に失敗しました: " + (oppErr?.message ?? "") };

  // 5) リードをアポ決着に更新(重複アプローチ防止・ファネル集計に反映)
  if (lead) {
    await sb
      .from("leads")
      .update({
        disposition: "appointment",
        status: "qualified",
        account_id: accountId,
        converted_opportunity_id: opp.id as string,
        converted_at: new Date().toISOString(),
      })
      .eq("id", lead.id);
  }

  revalidatePath("/app/opportunities");
  revalidatePath("/app/leads");
  revalidatePath("/app/dashboard");
  return { ok: true, opportunityId: opp.id as string, accountId, accountName };
}
