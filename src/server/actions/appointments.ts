"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { yomiToFields } from "@/lib/deal-import";
import { normCompany } from "@/lib/lead-import";
import { companySearchFilter } from "@/lib/company-name";

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
  // 生の部分一致 + 会社名の正規化キー列 search_key(0203)。メタ文字の除去も内部で行う
  const filter = companySearchFilter(["company_name", "contact_name"], q);
  if (filter) query = query.or(filter);
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

/** 既存顧客の流入情報(直近案件から)を取得。アポ登録で流入経路/詳細をプレフィルするのに使う。 */
export async function getAccountSourceAction(accountId: string): Promise<{ lead_source_id: string | null; source_detail: string | null }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select("lead_source_id, source_detail")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .or("lead_source_id.not.is.null,source_detail.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { lead_source_id: (data?.lead_source_id as string) ?? null, source_detail: (data?.source_detail as string) ?? null };
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
  sourceDetail: string | null;   // 流入詳細(どの展示会・どのパートナー等)
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
      // IDを先に採番して RETURNING を使わない。
      // RLSのINSERTは通っても、owner が他の営業担当のときは作成直後の行が
      // 自分のSELECTポリシーで見えず INSERT...RETURNING が弾かれるため
      // (内勤アポ獲得→外勤担当 の割り当てで発生)。
      const newAccId = crypto.randomUUID();
      const { error } = await sb.from("accounts").insert({
        id: newAccId,
        tenant_id: ctx.tenantId,
        owner_user_id: input.ownerUserId,
        name,
        industry: lead?.industry ?? null,
        employee_size: lead?.employee_size ?? null,
        area: lead?.prefecture ?? null,
        status: "prospect",
      });
      if (error) return { ok: false, error: "顧客の作成に失敗しました: " + error.message };
      accountId = newAccId;
      accountName = name;
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
  const oppId = crypto.randomUUID(); // RETURNINGを避ける(上記アカウントと同理由)
  const { error: oppErr } = await sb
    .from("opportunities")
    .insert({
      id: oppId,
      tenant_id: ctx.tenantId,
      account_id: accountId,
      lead_id: lead?.id ?? null,
      name: (accountName + (productName ? " / " + productName : "")).slice(0, 200),
      owner_user_id: input.ownerUserId,
      primary_product_id: input.productId,
      lead_source_id: input.leadSourceId || lead?.lead_source_id || null,
      campaign_id: lead?.campaign_id ?? null,
      marketing_channel_id: lead?.marketing_channel_id ?? null,
      source_detail: input.sourceDetail?.trim() || lead?.raw_event || null,
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
    });
  if (oppErr) return { ok: false, error: "案件の作成に失敗しました: " + oppErr.message };

  // 4.2) 商談(初回アポ)の枠を作成。案件だけでなく商談レコードも同時に作り、
  //      アポカレンダー/商談一覧に「予定の商談」として表示されるようにする。
  //      ヨミ=4.アポ のままなのでカレンダー上は「アポ(予定)」扱い(実施済みにはならない)。
  await sb.from("meetings").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: accountId,
    owner_user_id: input.ownerUserId,
    title: "初回商談（アポ）",
    meeting_date: input.date,
    meeting_at: appointmentAt,
    next_action_date: input.date,
    next_action_text: "初回商談（アポ）" + (input.time ? ` ${input.time}` : ""),
    pre_info: researchParts.length ? researchParts.join("\n\n") : null,
    created_by: ctx.userId,
  });

  // 4.5) 直接入力された流入詳細はマスタ(lead_source_details)へ自動登録(選択肢を育てる)
  const savedSourceId = input.leadSourceId || lead?.lead_source_id || null;
  const savedDetail = input.sourceDetail?.trim() || lead?.raw_event || null;
  if (savedSourceId && savedDetail) {
    await sb.from("lead_source_details").upsert(
      { tenant_id: ctx.tenantId, lead_source_id: savedSourceId, name: savedDetail },
      { onConflict: "tenant_id,lead_source_id,name", ignoreDuplicates: true },
    );
  }

  // 5) リードをアポ決着に更新(重複アプローチ防止・ファネル集計に反映)
  if (lead) {
    await sb
      .from("leads")
      .update({
        disposition: "appointment",
        status: "qualified",
        account_id: accountId,
        converted_opportunity_id: oppId,
        converted_at: new Date().toISOString(),
      })
      .eq("id", lead.id);
  }

  revalidatePath("/app/opportunities");
  revalidatePath("/app/leads");
  revalidatePath("/app/dashboard");
  return { ok: true, opportunityId: oppId, accountId, accountName };
}
