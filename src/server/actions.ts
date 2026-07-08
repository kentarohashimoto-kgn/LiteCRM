"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireCtx } from "@/lib/session";
import { STAGE_MAP, canReassignOwner } from "@/lib/constants";
import { normCompany } from "@/lib/lead-import";
import { yomiToFields, productToCategory, canonicalExhibition, type DealRow } from "@/lib/deal-import";
import { parsePeriod, parseProbability, parseAmount, parseDateLoose } from "@/lib/revenue-forecast";
import { ensureTransitionOnWon } from "@/server/transitions-util";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

// ===================== 認証 =====================
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/login?error=" + encodeURIComponent("メールアドレスまたはパスワードが正しくありません"));
  }
  redirect("/app/dashboard");
}

export async function signOut() {
  const supabase = getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

// ===================== 商談 =====================
/** 流入詳細をマスタ(lead_source_details)へ自動登録(直接入力された新しい値の取りこぼし防止)。 */
async function ensureSourceDetailMaster(tenantId: string, leadSourceId: string | null, sourceDetail: string | null): Promise<void> {
  if (!leadSourceId || !sourceDetail) return;
  const sb = getSupabaseServer();
  await sb
    .from("lead_source_details")
    .upsert(
      { tenant_id: tenantId, lead_source_id: leadSourceId, name: sourceDetail },
      { onConflict: "tenant_id,lead_source_id,name", ignoreDuplicates: true },
    );
}

interface LeadForOpp {
  id: string; company_name: string | null; contact_name: string | null; job_title: string | null;
  department: string | null; phone: string | null; email: string | null; industry: string | null;
  employee_size: string | null; prefecture: string | null; raw_event: string | null;
  lead_source_id: string | null; account_id: string | null; notes: string | null;
}

export async function createOpportunityAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  // ヨミを単一の入力とし、ステージ・予測区分・確度・ステータスはここから自動導出する。
  const yomiVal = str(formData.get("yomi")) ?? "4.アポ";
  const yf = yomiToFields(yomiVal);
  const stage = yf.stage as keyof typeof STAGE_MAP;
  const close = str(formData.get("expected_close_date"));
  // 受注見込み時期(年月)。初回商談時の必須。未来客も予測年月を入れる。
  const revMonthRaw = str(formData.get("expected_revenue_month"));
  const revMonth = revMonthRaw ? revMonthRaw.slice(0, 7) + "-01" : close ? close.slice(0, 7) + "-01" : null;
  const dealPhase = str(formData.get("deal_phase"));
  const nextDate = str(formData.get("next_action_date"));
  const nextText = str(formData.get("next_action_text"));

  // 初回商談時の必須(案件予測・受注見込み時期・次回アクション)。UIでもrequiredだが安全網。
  const missing: string[] = [];
  if (!dealPhase) missing.push("案件予測");
  if (!revMonth) missing.push("受注見込み時期");
  if (!nextDate) missing.push("次回アクション日");
  if (!nextText) missing.push("次回アクション内容");
  if (missing.length) {
    const acc = str(formData.get("account_id"));
    const back = acc ? `/app/accounts/${acc}` : "/app/opportunities/new";
    redirect(back + "?error=" + encodeURIComponent("未入力の必須項目があります: " + missing.join(" / ")));
  }

  const ownerUserId = str(formData.get("owner_user_id")) ?? ctx.userId;

  // ---- 顧客の解決(既存選択 / リード起点 / 新規作成をシームレスに) ----
  const leadId = str(formData.get("lead_id"));
  let lead: LeadForOpp | null = null;
  if (leadId) {
    const { data: l } = await sb
      .from("leads")
      .select("id,company_name,contact_name,job_title,department,phone,mobile_phone,email,industry,employee_size,prefecture,raw_event,lead_source_id,account_id,notes")
      .eq("id", leadId)
      .maybeSingle();
    if (l) {
      const r = l as Record<string, unknown>;
      lead = {
        id: r.id as string,
        company_name: (r.company_name as string) ?? null,
        contact_name: (r.contact_name as string) ?? null,
        job_title: (r.job_title as string) ?? null,
        department: (r.department as string) ?? null,
        phone: ((r.phone as string) || (r.mobile_phone as string)) ?? null,
        email: (r.email as string) ?? null,
        industry: (r.industry as string) ?? null,
        employee_size: (r.employee_size as string) ?? null,
        prefecture: (r.prefecture as string) ?? null,
        raw_event: (r.raw_event as string) ?? null,
        lead_source_id: (r.lead_source_id as string) ?? null,
        account_id: (r.account_id as string) ?? null,
        notes: (r.notes as string) ?? null,
      };
    }
  }

  const companyName = (str(formData.get("new_company_name")) ?? lead?.company_name?.trim()) || null;
  let accountId = str(formData.get("account_id")) ?? lead?.account_id ?? null;
  let accountName = "";
  if (!accountId && companyName) {
    const norm = normCompany(companyName);
    const { data: existing } = await sb.from("accounts").select("id,name").limit(1000);
    const hit = (existing ?? []).find((a) => normCompany((a.name as string) ?? "") === norm);
    if (hit) {
      accountId = hit.id as string;
      accountName = hit.name as string;
    } else {
      const { data: created, error: accErr } = await sb
        .from("accounts")
        .insert({
          tenant_id: ctx.tenantId, owner_user_id: ownerUserId, name: companyName,
          industry: lead?.industry ?? null, employee_size: lead?.employee_size ?? null,
          area: lead?.prefecture ?? null, status: "prospect",
        })
        .select("id,name")
        .single();
      if (accErr || !created) {
        redirect("/app/opportunities/new?error=" + encodeURIComponent("顧客の作成に失敗しました: " + (accErr?.message ?? "")));
      }
      accountId = created!.id as string;
      accountName = created!.name as string;
    }
  }
  if (!accountId) {
    redirect("/app/opportunities/new?error=" + encodeURIComponent("顧客を選択するか、新規顧客名を入力してください"));
  }
  if (!accountName) {
    const { data: acc } = await sb.from("accounts").select("name").eq("id", accountId).maybeSingle();
    accountName = (acc?.name as string) ?? "";
  }

  // 顧客担当者(任意・入力 or リードから)。顧客の下＝個人情報として登録。
  const contactName = str(formData.get("contact_name")) ?? lead?.contact_name ?? null;
  if (contactName) {
    await sb.from("contacts").insert({
      tenant_id: ctx.tenantId, account_id: accountId, name: contactName,
      title: str(formData.get("contact_title")) ?? lead?.job_title ?? null,
      department: lead?.department ?? null,
      phone: str(formData.get("contact_phone")) ?? lead?.phone ?? null,
      email: str(formData.get("contact_email")) ?? lead?.email ?? null,
    });
  }

  // 流入経路・詳細: 明示指定 > リード
  const leadSourceId = str(formData.get("lead_source_id")) ?? lead?.lead_source_id ?? null;
  const sourceDetail = str(formData.get("source_detail")) ?? lead?.raw_event ?? null;
  await ensureSourceDetailMaster(ctx.tenantId, leadSourceId, sourceDetail);

  // 案件名: 未入力なら会社名で補完
  const oppName = (str(formData.get("name")) ?? companyName ?? accountName) || "案件";

  const { data, error } = await sb
    .from("opportunities")
    .insert({
      tenant_id: ctx.tenantId,
      name: oppName,
      account_id: accountId,
      lead_id: lead?.id ?? null,
      owner_user_id: ownerUserId,
      yomi: yomiVal,
      primary_product_id: str(formData.get("primary_product_id")),
      lead_source_id: leadSourceId,
      source_detail: sourceDetail,
      category: str(formData.get("category")),
      deal_phase: dealPhase,
      stage,
      forecast_category: yf.forecast,
      amount: num(formData.get("amount")) ?? 0,
      probability: yf.probability,
      expected_close_date: close,
      expected_revenue_month: revMonth,
      next_action_date: nextDate,
      next_action_text: nextText,
      last_activity_at: new Date().toISOString(),
      notes: str(formData.get("notes")) ?? (lead?.notes ? `リードメモ: ${lead.notes}` : undefined),
      status: yf.status,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect("/app/opportunities?error=" + encodeURIComponent("作成に失敗しました: " + (error?.message ?? "")));
  }

  // リード起点なら決着に更新(重複アプローチ防止・顧客へ紐付け)
  if (lead) {
    await sb
      .from("leads")
      .update({ status: "qualified", account_id: accountId, converted_opportunity_id: data.id, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    revalidatePath("/app/leads");
  }
  await sb.from("stage_histories").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: data.id,
    to_stage: stage,
    changed_by: ctx.userId,
    reason: "新規作成",
  });
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${data.id}`);
}

export async function updateOpportunityAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  // ヨミを単一の入力とし、ステージ・予測区分・確度・ステータスはヨミから自動導出。
  const yomi = str(formData.get("yomi"));
  const f = yomiToFields(yomi ?? "");
  const close = str(formData.get("expected_close_date"));
  const status = f.status;
  await sb
    .from("opportunities")
    .update({
      yomi,
      stage: f.stage,
      forecast_category: f.forecast,
      category: str(formData.get("category")),
      amount: num(formData.get("amount")) ?? 0,
      probability: f.probability,
      rep_probability: num(formData.get("rep_probability")) ?? null,
      renewal_until_month: (() => { const m = str(formData.get("renewal_until_month")); return m ? m.slice(0, 7) + "-01" : null; })(),
      renewal_probability: num(formData.get("renewal_probability")) ?? null,
      expected_close_date: close,
      expected_revenue_month: close ? close.slice(0, 7) + "-01" : null,
      next_action_date: str(formData.get("next_action_date")),
      next_action_text: str(formData.get("next_action_text")),
      risk_level: str(formData.get("risk_level")),
      lost_reason: str(formData.get("lost_reason")),
      lost_reason_code: str(formData.get("lost_reason_code")),
      lost_competitor: str(formData.get("lost_competitor")),
      notes: str(formData.get("notes")),
      status,
    })
    .eq("id", id);
  // 研修/開発案件が受注になったらトランジションを自動作成
  if (status === "won") {
    await ensureTransitionOnWon(ctx.tenantId, ctx.userId, id);
  }
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${id}?saved=1`);
}

/**
 * 受注予測入力(売上予測画面のインライン編集)。
 * 受注予定額(amount)・受注予定日(expected_close_date)・ヨミ・担当者予測確率(rep_probability)のみ更新。
 * ステージや予測区分は変更しない。
 */
export async function setOppForecastAction(formData: FormData): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  if (!id) return { ok: false };
  const close = str(formData.get("expected_close_date"));
  const rep = num(formData.get("rep_probability"));
  await sb
    .from("opportunities")
    .update({
      amount: num(formData.get("amount")) ?? 0,
      expected_close_date: close,
      expected_revenue_month: close ? close.slice(0, 7) + "-01" : null,
      yomi: str(formData.get("yomi")),
      rep_probability: rep == null ? null : Math.max(0, Math.min(100, rep)),
    })
    .eq("id", id);
  revalidatePath("/app/forecast");
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  return { ok: true };
}

/** 案件の事前リサーチ情報・事前営業戦略を保存(その場更新・再読込なし)。 */
export async function saveOppResearchAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb
    .from("opportunities")
    .update({ pre_research: str(formData.get("pre_research")), sales_strategy: str(formData.get("sales_strategy")) })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${id}`);
  redirect(`/app/opportunities/${id}?saved=1`);
}

/**
 * 案件の基本情報を編集(案件名・担当営業の割振り/変更・ヨミ・主商材・流入経路・
 * 初回商談日・アポ獲得者)。担当営業の再割当てはここから行う。
 * name / owner_user_id は NOT NULL のため、空送信時は既存値を保持する。
 */
export async function updateOpportunityBasicsAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  if (!id) redirect("/app/opportunities");

  const name = str(formData.get("name"));
  const owner = str(formData.get("owner_user_id"));
  await ensureSourceDetailMaster(ctx.tenantId, str(formData.get("lead_source_id")), str(formData.get("source_detail")));
  // ヨミは「案件を更新」に一本化(基本情報からは編集しない)。
  const patch: Record<string, unknown> = {
    primary_product_id: str(formData.get("primary_product_id")),
    lead_source_id: str(formData.get("lead_source_id")),
    source_detail: str(formData.get("source_detail")),
    first_meeting_date: str(formData.get("first_meeting_date")),
    appt_acquired_by: str(formData.get("appt_acquired_by")),
    appt_acquired_on: str(formData.get("appt_acquired_on")),
  };
  if (name) patch.name = name;         // NOT NULL: 空なら維持
  // 担当者の再割当ては代表・管理者・Sales Opsのみ(非管理職の送信は無視して既存を維持)
  if (owner && canReassignOwner(ctx.role)) patch.owner_user_id = owner;

  await sb.from("opportunities").update(patch).eq("id", id);
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${id}?saved=1`);
}

/** 商談を展示会・施策インスタンスへ紐付け(手動修正)。推定フラグは解除する。 */
export async function setOpportunityCampaignAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const campaignId = str(formData.get("campaign_id"));
  await sb
    .from("opportunities")
    .update({ campaign_id: campaignId, campaign_estimated: false })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  revalidatePath("/app/analytics/exhibitions");
  redirect(`/app/opportunities/${id}`);
}

// ===================== 商談(meetings) =====================
/** 案件配下に商談(1回)を登録。 */
export async function createMeetingAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) {
    redirect("/app/opportunities?error=" + encodeURIComponent("案件が指定されていません"));
  }
  const meetingDate = str(formData.get("meeting_date"));
  const meetingTime = str(formData.get("meeting_time"));
  const meetingAt = meetingDate && meetingTime ? `${meetingDate}T${meetingTime}:00+09:00` : null;
  const nextDate = str(formData.get("next_action_date"));
  const nextText = str(formData.get("next_action_text"));
  await sb.from("meetings").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
    title: str(formData.get("title")) ?? "商談",
    meeting_date: meetingDate,
    meeting_at: meetingAt,
    method: str(formData.get("method")),
    summary: str(formData.get("summary")),
    minutes_detail: str(formData.get("minutes_detail")),
    next_action_date: nextDate,
    next_action_text: nextText,
    created_by: ctx.userId,
  });
  // 親案件の最終活動/次アクションを更新
  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if (nextDate) {
    patch.next_action_date = nextDate;
    patch.next_action_text = nextText;
  }
  await sb.from("opportunities").update(patch).eq("id", oppId);
  revalidatePath(`/app/opportunities/${oppId}`);
  redirect(`/app/opportunities/${oppId}`);
}

export async function updateMeetingAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const oppId = str(formData.get("opportunity_id"));
  const patch: Record<string, unknown> = {
    title: str(formData.get("title")) ?? "商談",
    meeting_date: str(formData.get("meeting_date")),
    meeting_at: (() => { const md = str(formData.get("meeting_date")); const mt = str(formData.get("meeting_time")); return md && mt ? `${md}T${mt}:00+09:00` : null; })(),
    method: str(formData.get("method")),
    summary: str(formData.get("summary")),
    minutes_detail: str(formData.get("minutes_detail")),
    next_action_date: str(formData.get("next_action_date")),
    next_action_text: str(formData.get("next_action_text")),
  };
  // 商談担当の変更は代表・管理者・Sales Opsのみ(非管理職の送信は無視)
  const meetingOwner = str(formData.get("owner_user_id"));
  if (meetingOwner && canReassignOwner(ctx.role)) patch.owner_user_id = meetingOwner;
  await sb.from("meetings").update(patch).eq("id", id);
  // 商談の次アクションを親案件へ同期(案件と商談で二重更新しなくて済むように)。
  if (oppId) {
    const oppPatch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
    const nd = str(formData.get("next_action_date"));
    const nt = str(formData.get("next_action_text"));
    if (nd || nt) { oppPatch.next_action_date = nd; oppPatch.next_action_text = nt; }
    await sb.from("opportunities").update(oppPatch).eq("id", oppId);
  }
  revalidatePath(`/app/opportunities/${oppId}/meetings/${id}`);
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  redirect(`/app/opportunities/${oppId}/meetings/${id}?saved=1`);
}

// ===================== 目標(月別) =====================
export async function saveTargetsAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const fy = String(formData.get("fy") ?? "");
  const months = String(formData.get("months") ?? "").split(",").filter(Boolean);
  const rows = months.map((mk) => ({
    tenant_id: ctx.tenantId,
    target_month: mk,
    target_amount: num(formData.get(`m_${mk}_amount`)) ?? 0,
    target_deals: Math.round(num(formData.get(`m_${mk}_deals`)) ?? 0),
    target_appointments: Math.round(num(formData.get(`m_${mk}_appts`)) ?? 0),
    target_leads: Math.round(num(formData.get(`m_${mk}_leads`)) ?? 0),
  }));
  if (rows.length) {
    await sb.from("sales_targets").upsert(rows, { onConflict: "tenant_id,target_month" });
  }
  revalidatePath("/app/targets");
  revalidatePath("/app/forecast");
  revalidatePath("/app/dashboard");
  redirect("/app/targets?fy=" + encodeURIComponent(fy) + "&ok=1");
}

/** 営業マンのステータス(継続/契約予定/保留/解約)を更新 */
export async function setRepStatusAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("memberships")
    .update({ rep_status: str(formData.get("rep_status")) })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", String(formData.get("user_id")));
  revalidatePath("/app/analytics/sales-reps");
}

/** 営業マンの月別売上目標を保存(年度分) */
export async function saveRepTargetsAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const userId = String(formData.get("user_id"));
  const fy = String(formData.get("fy") ?? "");
  const months = String(formData.get("months") ?? "").split(",").filter(Boolean);
  const rows = months.map((mk) => ({
    tenant_id: ctx.tenantId,
    user_id: userId,
    target_month: mk,
    target_amount: num(formData.get(`m_${mk}_amount`)) ?? 0,
  }));
  if (rows.length) {
    await sb.from("rep_targets").upsert(rows, { onConflict: "tenant_id,user_id,target_month" });
  }
  revalidatePath("/app/targets");
  revalidatePath("/app/analytics/sales-reps");
  redirect("/app/targets?scope=" + encodeURIComponent(userId) + "&fy=" + encodeURIComponent(fy) + "&ok=1");
}

// ===================== 請求スケジュール(売上計画) =====================
export async function createBillingScheduleAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) redirect("/app/opportunities");
  const kind = str(formData.get("kind")) === "recurring" ? "recurring" : "one_time";
  const startMonth = str(formData.get("recurring_start_month")); // YYYY-MM
  const endMonth = str(formData.get("recurring_end_month"));
  await sb.from("billing_schedules").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    kind,
    billing_date: kind === "one_time" ? str(formData.get("billing_date")) : null,
    amount: num(formData.get("amount")) ?? 0,
    recurring_start_month: kind === "recurring" && startMonth ? startMonth + "-01" : null,
    recurring_end_month: kind === "recurring" && endMonth ? endMonth + "-01" : null,
    note: str(formData.get("note")),
    created_by: ctx.userId,
  });
  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/analytics/revenue");
  redirect(`/app/opportunities/${oppId}`);
}

export async function deleteBillingScheduleAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  await sb.from("billing_schedules").delete().eq("id", String(formData.get("id")));
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/analytics/revenue");
  redirect(`/app/opportunities/${oppId}`);
}

/**
 * サブスク型(月額×契約期間)を一括登録。(b軸+c補助)
 *  - 契約期間ぶんの recurring 請求スケジュールを作成（毎月の確定売上）
 *  - 案件の受注金額(amount)を 月額×契約月数(契約確定TCV)に更新、分類をサブスクに
 *  - 更新見込み(継続終了月・更新確度)を案件に保存（更新見込みレイヤー）
 *  - 任意で「更新提案」タスクを契約満了の約1ヶ月前に自動生成（c補助）
 */
export async function addSubscriptionAction(formData: FormData): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) return { ok: false };
  const monthly = num(formData.get("monthly_amount")) ?? 0;
  const startMonth = str(formData.get("start_month")); // YYYY-MM
  const term = Math.max(1, num(formData.get("term_months")) ?? 1);
  if (!startMonth || monthly <= 0) return { ok: false };

  // 契約期間: 開始月〜開始月+term-1
  const start = new Date(startMonth + "-01T00:00:00Z");
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + term - 1, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

  await sb.from("billing_schedules").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    kind: "recurring",
    amount: monthly,
    recurring_start_month: fmt(start),
    recurring_end_month: fmt(end),
    note: str(formData.get("note")) ?? "サブスク月額",
    created_by: ctx.userId,
  });

  const renewalUntil = str(formData.get("renewal_until_month"));
  await sb
    .from("opportunities")
    .update({
      amount: monthly * term,
      category: "advisory_subscription",
      expected_close_date: str(formData.get("expected_close_date")) ?? fmt(start),
      expected_revenue_month: fmt(start),
      renewal_until_month: renewalUntil ? renewalUntil + "-01" : null,
      renewal_probability: num(formData.get("renewal_probability")) ?? null,
    })
    .eq("id", oppId);

  // c補助: 契約満了の約1ヶ月前に更新提案タスク
  if (str(formData.get("make_task"))) {
    const taskDue = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    await sb.from("tasks").insert({
      tenant_id: ctx.tenantId,
      title: "サブスク更新提案（契約満了前）",
      opportunity_id: oppId,
      account_id: str(formData.get("account_id")),
      assigned_to: ctx.userId,
      created_by: ctx.userId,
      due_date: fmt(taskDue),
      priority: "high",
      status: "todo",
    });
  }

  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/forecast");
  revalidatePath("/app/tasks");
  return { ok: true };
}

// ===================== 活動 =====================
export async function addActivityAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  const accId = str(formData.get("account_id"));
  const nextDate = str(formData.get("next_action_date"));
  const nextText = str(formData.get("next_action_text"));
  const title = str(formData.get("title"));
  const body = str(formData.get("body"));
  const redirectTo = str(formData.get("redirect_to"));
  const activityAt = new Date().toISOString();

  // 二重登録ガード: 直近60秒に「同じ案件/顧客・同じタイトル・同じ本文」の記録があればスキップ。
  // (保存されたか分からず連打された場合でも重複を作らない)
  let duplicated = false;
  if (title) {
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    let q = sb
      .from("activities")
      .select("id, body")
      .eq("tenant_id", ctx.tenantId)
      .eq("owner_user_id", ctx.userId)
      .eq("title", title)
      .gte("created_at", since)
      .limit(5);
    q = oppId ? q.eq("opportunity_id", oppId) : accId ? q.eq("account_id", accId) : q;
    const { data: recent } = await q;
    duplicated = (recent ?? []).some((r) => (str((r as { body?: string }).body ?? null) ?? null) === (body ?? null));
  }

  if (!duplicated) {
    await sb.from("activities").insert({
      tenant_id: ctx.tenantId,
      opportunity_id: oppId,
      account_id: accId,
      owner_user_id: ctx.userId,
      activity_type: str(formData.get("activity_type")) ?? "note",
      title,
      body,
      activity_at: activityAt,
      next_action_date: nextDate,
      next_action_text: nextText,
    });

    if (oppId) {
      const patch: Record<string, unknown> = { last_activity_at: activityAt };
      if (nextDate) {
        patch.next_action_date = nextDate;
        patch.next_action_text = nextText;
      }
      await sb.from("opportunities").update(patch).eq("id", oppId);
    }
  }

  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/activities");
  revalidatePath("/app/today");
  // 送信後は元画面へ戻し、フォームを空に戻す＋「記録しました」バナーを表示
  if (redirectTo) redirect(`${redirectTo}?saved=activity`);
}

/** 活動履歴の編集(タイトル・種別・本文・次アクション)。 */
export async function updateActivityAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const oppId = str(formData.get("opportunity_id"));
  if (!id) return;
  await sb
    .from("activities")
    .update({
      activity_type: str(formData.get("activity_type")) ?? "note",
      title: str(formData.get("title")),
      body: str(formData.get("body")),
      next_action_date: str(formData.get("next_action_date")),
      next_action_text: str(formData.get("next_action_text")),
    })
    .eq("id", id);
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/activities");
}

/** 活動履歴の削除(誤登録の取り消し)。RLSで本人/管理者のみ。 */
export async function deleteActivityAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const oppId = str(formData.get("opportunity_id"));
  if (!id) return;
  await sb.from("activities").delete().eq("id", id);
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/activities");
}

// ===================== タスク =====================
export async function createTaskAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("tasks").insert({
    tenant_id: ctx.tenantId,
    title: str(formData.get("title")),
    opportunity_id: str(formData.get("opportunity_id")),
    account_id: str(formData.get("account_id")),
    assigned_to: str(formData.get("assigned_to")) ?? ctx.userId,
    created_by: ctx.userId,
    due_date: str(formData.get("due_date")),
    priority: str(formData.get("priority")) ?? "middle",
    status: "todo",
  });
  revalidatePath("/app/tasks");
}

export async function setTaskStatusAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const status = String(formData.get("status"));
  await sb
    .from("tasks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", String(formData.get("id")));
  revalidatePath("/app/tasks");
}

// ===================== 顧客 =====================
export async function createAccountAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("accounts")
    .insert({
      tenant_id: ctx.tenantId,
      owner_user_id: ctx.userId,
      name: str(formData.get("name")),
      industry: str(formData.get("industry")),
      area: str(formData.get("area")),
      employee_size: str(formData.get("employee_size")),
      status: str(formData.get("status")) ?? "prospect",
      priority: str(formData.get("priority")),
      website_url: str(formData.get("website_url")),
      notes: str(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error || !data) {
    redirect("/app/accounts?error=" + encodeURIComponent("作成に失敗しました"));
  }
  revalidatePath("/app/accounts");
  redirect(`/app/accounts/${data.id}`);
}

/** 顧客のランク(S/A/B/C/D)を更新 */
export async function setAccountRankAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("accounts").update({ rank: str(formData.get("rank")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/accounts");
}

/** 顧客の重点フラグを更新 */
export async function setAccountFocusAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("accounts").update({ focus: str(formData.get("focus")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/accounts");
}

/** 顧客の担当営業(owner_user_id)を割当・変更。 */
export async function setAccountOwnerAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("accounts").update({ owner_user_id: str(formData.get("owner_user_id")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/accounts");
}

// ===================== リード =====================
/** 全リードをスコアリング(要件書4.10)。ランクは未設定のみ自動補完(既存ランクは保持)。 */
export async function rescoreAllLeadsAction() {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("rescore_leads");
  revalidatePath("/app/leads");
  redirect("/app/leads?scored=" + encodeURIComponent(String(data ?? 0)));
}

export async function createLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").insert({
    tenant_id: ctx.tenantId,
    title: str(formData.get("title")),
    account_id: str(formData.get("account_id")),
    lead_source_id: str(formData.get("lead_source_id")),
    owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
    primary_product_id: str(formData.get("primary_product_id")),
    rank: str(formData.get("rank")),
    status: str(formData.get("status")) ?? "new",
  });
  revalidatePath("/app/leads");
}

// ===================== リード取込(インポート) =====================
import { normalizeLead, priorityScore, type RawLeadInput } from "@/lib/lead-import";

/** 取込バッチを開始(履歴記録)。バッチIDを返す。 */
export async function startImportBatchAction(meta: { rawEvent: string; label?: string; sourceName?: string; rowCount: number; config?: Record<string, unknown> }): Promise<{ batchId: string | null }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("lead_import_batches")
    .insert({ tenant_id: ctx.tenantId, raw_event: meta.rawEvent, label: meta.label, source_name: meta.sourceName, row_count: meta.rowCount, config: meta.config ?? {}, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) return { batchId: null };
  return { batchId: data.id };
}

/** 取込バッチを一括取り消し(リード削除＋履歴削除)。 */
export async function deleteImportBatchAction(batchId: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").delete().eq("tenant_id", ctx.tenantId).eq("import_batch_id", batchId);
  await sb.from("lead_import_batches").delete().eq("tenant_id", ctx.tenantId).eq("id", batchId);
  revalidatePath("/app/leads");
  return { ok: true };
}

/** リード1件を更新(優先度の必須項目含む)。スコアを再計算。 */
export async function updateLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const base = num(formData.get("priority_base")) ?? 20;
  const fields = {
    company_name: str(formData.get("company_name")),
    contact_name: str(formData.get("contact_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    mobile_phone: str(formData.get("mobile_phone")),
    job_title: str(formData.get("job_title")),
    department: str(formData.get("department")),
    industry: str(formData.get("industry")),
    employee_size: str(formData.get("employee_size")),
    revenue_size: str(formData.get("revenue_size")),
    prefecture: str(formData.get("prefecture")),
    role_level: str(formData.get("role_level")),
    needs: str(formData.get("needs")),
    timing: str(formData.get("timing")),
    authority: str(formData.get("authority")),
    budget_band: str(formData.get("budget_band")),
    budget_amount: num(formData.get("budget_amount")),
    disposition: str(formData.get("disposition")),
    call_owner: str(formData.get("call_owner")),
    rank: str(formData.get("rank")),
    notes: str(formData.get("notes")),
  };
  const score = priorityScore(base, {
    employee_size: fields.employee_size,
    revenue_size: fields.revenue_size,
    role_level: fields.role_level,
    job_title: fields.job_title,
    needs: fields.needs,
    timing: fields.timing,
    authority: fields.authority,
    budget_band: fields.budget_band,
  });
  const status = fields.disposition === "appointment" ? "qualified" : fields.disposition === "ng" || fields.disposition === "excluded" ? "disqualified" : "new";
  await sb.from("leads").update({ ...fields, company_name: fields.company_name, priority_score: score, status }).eq("id", id).eq("tenant_id", ctx.tenantId);
  // リードスコア(要件書4.10)を再計算(ランクは未設定のみ自動補完)
  await sb.rpc("rescore_leads", { p_lead_id: id });
  revalidatePath("/app/leads");
  redirect("/app/leads/" + id);
}

/** リード1件を削除(論理削除・30日間は設定のゴミ箱から復元可能)。 */
export async function deleteLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("leads")
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.userId })
    .eq("id", String(formData.get("id")))
    .eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/leads");
  redirect("/app/leads");
}

/** 指定イベントの既存リードを削除(置換取込の前処理)。 */
export async function clearLeadsForEventAction(rawEvent: string): Promise<{ deleted: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  // リード由来の接点(同イベント)も削除して、置換再取込での二重計上を防ぐ
  await sb.from("touchpoints").delete().eq("tenant_id", ctx.tenantId).eq("source", "lead").contains("meta", { event: rawEvent });
  await sb.from("leads").delete().eq("tenant_id", ctx.tenantId).eq("raw_event", rawEvent);
  return { deleted: true };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 取込済みリード行から接点(展示会で名刺交換・架電ログ)を生成。 */
function buildLeadTouchpoints(tenantId: string, rows: any[]): Record<string, unknown>[] {
  const tps: Record<string, unknown>[] = [];
  for (const l of rows) {
    const email = (l.email ?? "").toLowerCase() || null;
    const base = { tenant_id: tenantId, email, company_norm: l.company_norm ?? null, lead_id: l.id, occurred_at: l.acquired_at ?? null, source: "lead", meta: { event: l.raw_event ?? null } };
    tps.push({ ...base, type: "exhibition", weight: 1 });
    if (l.disposition && !["untouched", "excluded"].includes(l.disposition)) tps.push({ ...base, type: "call", weight: 2 });
  }
  return tps;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** リードを一括投入(クライアントから分割呼び出し)。 */
export async function importLeadsBatchAction(
  rows: RawLeadInput[],
  opts: { campaignId?: string | null; leadSourceId?: string | null; rawEvent: string; base: number; eventDate?: string | null; acquiredDate?: string | null; importBatchId?: string | null },
): Promise<{ inserted: number; error?: string }> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "sales_rep", "external_sales"].includes(ctx.role)) {
    return { inserted: 0, error: "権限がありません" };
  }
  const sb = getSupabaseServer();
  const recs = rows
    .filter((r) => (r.company ?? "").trim() !== "")
    .map((r) => normalizeLead(r, { ...opts, tenantId: ctx.tenantId }));
  if (recs.length === 0) return { inserted: 0 };
  const { data, error } = await sb.from("leads").insert(recs).select("id,email,company_norm,acquired_at,raw_event,disposition");
  if (error) return { inserted: 0, error: error.message };
  const tps = buildLeadTouchpoints(ctx.tenantId, data ?? []);
  if (tps.length) await sb.from("touchpoints").insert(tps);
  revalidatePath("/app/leads");
  return { inserted: recs.length };
}

/** リードを一括更新(重複=メール一致は上書き、新規は追加)。決着など変更分を反映。 */
// 決着(disposition)/status は手動管理が正のため、ここでは一律上書きしない。
// 取込ファイルに明示の決着がある場合のみ別途反映する(下記の特別処理)。
const OVERWRITE_KEYS = [
  "call_owner", "deal_owner_name", "rank", "phone", "mobile_phone",
  "company_name", "contact_name", "department", "job_title", "industry", "employee_size",
  "prefecture", "acquirer", "tags", "notes", "scanned_at", "acquired_at", "campaign_id", "raw_event",
] as const;

export async function upsertLeadsBatchAction(
  rows: RawLeadInput[],
  opts: { campaignId?: string | null; leadSourceId?: string | null; rawEvent: string; base: number; eventDate?: string | null; acquiredDate?: string | null; importBatchId?: string | null },
): Promise<{ inserted: number; updated: number; error?: string }> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "sales_rep", "external_sales"].includes(ctx.role)) {
    return { inserted: 0, updated: 0, error: "権限がありません" };
  }
  const sb = getSupabaseServer();
  const recs = rows
    .filter((r) => (r.company ?? "").trim() !== "")
    .map((r) => normalizeLead(r, { ...opts, tenantId: ctx.tenantId }));
  if (recs.length === 0) return { inserted: 0, updated: 0 };

  const emails = [...new Set(recs.map((r) => (r.email as string | null) ?? "").filter(Boolean).map((e) => e.toLowerCase()))];
  const existing = new Map<string, Record<string, unknown>>();
  if (emails.length) {
    const { data } = await sb
      .from("leads")
      .select("id,email,priority_base,role_level,needs,timing,authority,budget_band,revenue_size,employee_size")
      .eq("tenant_id", ctx.tenantId)
      .in("email", emails);
    for (const row of data ?? []) existing.set(String((row.email ?? "")).toLowerCase(), row);
  }

  const toInsert: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const rec of recs) {
    const em = rec.email ? String(rec.email).toLowerCase() : null;
    const ex = em ? existing.get(em) : null;
    if (ex) {
      const patch: Record<string, unknown> = {};
      for (const k of OVERWRITE_KEYS) if (rec[k] != null) patch[k] = rec[k];
      // 決着は手動が正。ファイルに明示の決着(未決着以外)がある時だけ上書きし、
      // 空白(=untouched)の場合は既存の手入力値を保持する。
      if (rec.disposition && rec.disposition !== "untouched") {
        patch.disposition = rec.disposition;
        patch.status = rec.status;
      }
      patch.priority_score = priorityScore((ex.priority_base as number) ?? (rec.priority_base as number) ?? 20, {
        employee_size: (patch.employee_size as string) ?? (ex.employee_size as string),
        revenue_size: ex.revenue_size as string,
        role_level: (rec.role_level as string) ?? (ex.role_level as string),
        needs: ex.needs as string,
        timing: ex.timing as string,
        authority: ex.authority as string,
        budget_band: ex.budget_band as string,
      });
      updates.push({ id: String(ex.id), patch });
    } else {
      toInsert.push(rec);
    }
  }

  if (toInsert.length) {
    const { data, error } = await sb.from("leads").insert(toInsert).select("id,email,company_norm,acquired_at,raw_event,disposition");
    if (error) return { inserted: 0, updated: 0, error: error.message };
    const tps = buildLeadTouchpoints(ctx.tenantId, data ?? []);
    if (tps.length) await sb.from("touchpoints").insert(tps);
  }
  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(updates.slice(i, i + 20).map((u) => sb.from("leads").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId)));
  }
  revalidatePath("/app/leads");
  return { inserted: toInsert.length, updated: updates.length };
}

/** 展示会・施策(campaign)の表示名を変更。 */
export async function updateCampaignNameAction(id: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const n = name.trim();
  if (!n) return { ok: false };
  await sb.from("campaigns").update({ name: n.slice(0, 200) }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/exhibitions");
  revalidatePath("/app/analytics/channels");
  return { ok: true };
}

/** 取得担当(ブース読取担当)の別名(数字→名前)を設定。 */
export async function setAcquirerAliasAction(raw: string, displayName: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("acquirer_aliases")
    .upsert({ tenant_id: ctx.tenantId, raw, display_name: displayName || null }, { onConflict: "tenant_id,raw" });
  revalidatePath("/app/leads");
  return { ok: true };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** リードの各メモ欄(展示会でのやりとり・架電メモ等)とBANTを、案件へ引き継ぐ1本のテキストに整形。 */
function buildLeadHandoff(lead: any): string {
  const lines: string[] = [];
  if (lead.raw_event) lines.push(`【流入イベント】${lead.raw_event}`);
  if (lead.notes) lines.push(`【リードメモ】${lead.notes}`);
  // 取込元CSV由来の追加メモ(extra jsonb)も取りこぼさない
  if (lead.extra && typeof lead.extra === "object") {
    for (const [k, v] of Object.entries(lead.extra as Record<string, unknown>)) {
      const val = v == null ? "" : String(v).trim();
      if (val && /memo|note|詳細|議事|やりとり|メモ/i.test(k)) lines.push(`【${k}】${val}`);
    }
  }
  const bant = [
    lead.needs ? `ニーズ:${lead.needs}` : null,
    lead.timing ? `時期:${lead.timing}` : null,
    lead.authority ? `決裁:${lead.authority}` : null,
    lead.budget_band ? `予算:${lead.budget_band}` : null,
  ].filter(Boolean);
  if (bant.length) lines.push(`【BANT】${bant.join(" / ")}`);
  if (lead.disposition) lines.push(`【リード決着】${lead.disposition}`);
  return lines.join("\n");
}

/**
 * リードを案件化(opportunity に昇格)。連結ファネルの中核。
 *  - 会社名で既存 account を名寄せ(無ければ作成)
 *  - 既にオープン案件があれば二重作成せず lead を紐付け、無ければ新規案件を作成
 *  - 担当者(contact)を作成/再利用し、lead を converted にして紐付け
 * 冪等: 既に account_id が付いたリードは何もしない。
 */
async function promoteLeadCore(
  sb: any,
  tenantId: string,
  userId: string,
  leadId: string,
): Promise<{ opportunityId: string | null; already: boolean }> {
  const { data: lead } = await sb.from("leads").select("*").eq("id", leadId).eq("tenant_id", tenantId).single();
  if (!lead) return { opportunityId: null, already: false };
  if (lead.account_id) return { opportunityId: null, already: true };

  const company = (lead.company_name ?? "").trim();
  const norm = lead.company_norm || normCompany(company);

  // 会社の名寄せ(正規化名で一致する account を探す)
  const { data: accs } = await sb.from("accounts").select("id,name").eq("tenant_id", tenantId);
  let accountId: string | null = null;
  for (const a of accs ?? []) {
    if (normCompany(a.name) === norm && norm) { accountId = a.id; break; }
  }
  if (!accountId) {
    const { data: newAcc } = await sb
      .from("accounts")
      .insert({
        tenant_id: tenantId,
        owner_user_id: lead.owner_user_id ?? userId,
        name: company || "(無名)",
        industry: lead.industry ?? null,
        employee_size: lead.employee_size ?? null,
        revenue_size: lead.revenue_size ?? null,
        area: lead.prefecture ?? null,
        status: "prospect",
      })
      .select("id")
      .single();
    accountId = newAcc?.id ?? null;
  }
  if (!accountId) return { opportunityId: null, already: false };

  // 担当者(contact)を作成/再利用(メール優先)
  let contactId: string | null = null;
  const email = (lead.email ?? "").trim();
  if (email) {
    const { data: c } = await sb.from("contacts").select("id").eq("tenant_id", tenantId).eq("account_id", accountId).ilike("email", email).limit(1);
    contactId = c?.[0]?.id ?? null;
  }
  if (!contactId && (lead.contact_name || email)) {
    const { data: nc } = await sb
      .from("contacts")
      .insert({
        tenant_id: tenantId,
        account_id: accountId,
        name: lead.contact_name || email || "(担当者)",
        department: lead.department ?? null,
        title: lead.job_title ?? null,
        email: email || null,
        phone: lead.phone ?? lead.mobile_phone ?? null,
      })
      .select("id")
      .single();
    contactId = nc?.id ?? null;
  }

  // リードの引継ぎメモを案件の「事前リサーチ情報」に集約。
  // 展示会での名刺交換時のやりとり・架電メモ・BANTなどを営業が案件側で追えるようにする。
  const handoff = buildLeadHandoff(lead);

  // 既存のオープン案件があれば紐付け、無ければ新規作成(二重計上防止)
  const { data: openOpps } = await sb
    .from("opportunities")
    .select("id,lead_id,pre_research")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1);
  let opportunityId: string | null = openOpps?.[0]?.id ?? null;

  if (opportunityId) {
    const patch: Record<string, unknown> = {};
    if (!openOpps[0].lead_id) patch.lead_id = leadId;
    // 既存案件の事前リサーチが空なら引継ぎメモを埋める(既存記述は上書きしない)
    if (handoff && !str(openOpps[0].pre_research)) patch.pre_research = handoff;
    if (Object.keys(patch).length) await sb.from("opportunities").update(patch).eq("id", opportunityId);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const { data: opp } = await sb
      .from("opportunities")
      .insert({
        tenant_id: tenantId,
        account_id: accountId,
        contact_id: contactId,
        lead_id: leadId,
        owner_user_id: lead.owner_user_id ?? userId,
        name: `${company || "新規"} / 新規商談`,
        stage: "meeting_scheduled",
        forecast_category: "pipeline",
        amount: 0,
        probability: STAGE_MAP["meeting_scheduled"]?.probability ?? 20,
        first_meeting_date: today,
        lead_source_id: lead.lead_source_id ?? null,
        campaign_id: lead.campaign_id ?? null,
        pre_research: handoff || null,
        status: "open",
        last_activity_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    opportunityId = opp?.id ?? null;
    if (opportunityId) {
      await sb.from("stage_histories").insert({
        tenant_id: tenantId,
        opportunity_id: opportunityId,
        to_stage: "meeting_scheduled",
        changed_by: userId,
        reason: "リードから案件化",
      });
    }
  }

  await sb
    .from("leads")
    .update({ account_id: accountId, contact_id: contactId, status: "converted", converted_at: new Date().toISOString() })
    .eq("id", leadId);

  // 案件化=商談獲得の接点を記録(エンゲージメント加点)
  if (lead.email) {
    await sb.from("touchpoints").insert({
      tenant_id: tenantId, email: String(lead.email).toLowerCase(), company_norm: norm, account_id: accountId, lead_id: leadId,
      type: "meeting", weight: 5, occurred_at: new Date().toISOString().slice(0, 10), source: "opportunity", meta: { from: "promote" },
    });
  }

  return { opportunityId, already: false };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** リードを案件化(手動ボタン)。 */
export async function promoteLeadToOpportunityAction(leadId: string): Promise<{ ok: boolean; opportunityId: string | null }> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "sales_rep", "external_sales"].includes(ctx.role)) {
    return { ok: false, opportunityId: null };
  }
  const sb = getSupabaseServer();
  const { opportunityId } = await promoteLeadCore(sb, ctx.tenantId, ctx.userId, leadId);
  await sb.rpc("recompute_engagement", { p_tenant: ctx.tenantId });
  revalidatePath("/app/leads");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/dashboard");
  return { ok: true, opportunityId };
}

/** リードの決着ステータスを更新。アポ獲得にした時は自動で案件化する。 */
export async function setLeadDispositionAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const disp = str(formData.get("disposition"));
  const status = disp === "appointment" ? "qualified" : disp === "ng" || disp === "excluded" ? "disqualified" : "new";
  await sb.from("leads").update({ disposition: disp, status }).eq("id", id);
  if (disp === "appointment") {
    await promoteLeadCore(sb, ctx.tenantId, ctx.userId, id);
    revalidatePath("/app/opportunities");
    revalidatePath("/app/dashboard");
  }
  revalidatePath("/app/leads");
}

/** リードの架電担当(対応)を更新 */
export async function setLeadCallOwnerAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").update({ call_owner: str(formData.get("call_owner")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/leads");
}

// ===================== メンバー発行(管理者) =====================
export async function createMemberAction(formData: FormData) {
  const ctx = await requireCtx();
  if (!["owner", "admin"].includes(ctx.role)) {
    redirect("/app/settings?error=" + encodeURIComponent("メンバー発行は管理者のみ可能です"));
  }
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("display_name") ?? "").trim();
  const role = String(formData.get("role") ?? "sales_rep");
  const password = String(formData.get("password") ?? "").trim();
  if (!email || !password) {
    redirect("/app/settings?error=" + encodeURIComponent("メールと初期パスワードは必須です"));
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name || email.split("@")[0] },
  });
  if (error || !data.user) {
    redirect("/app/settings?error=" + encodeURIComponent("発行に失敗: " + (error?.message ?? "")));
  }
  await admin.from("memberships").insert({
    tenant_id: ctx.tenantId,
    user_id: data.user.id,
    role,
    memo: str(formData.get("memo")),
  });
  revalidatePath("/app/settings");
  redirect("/app/settings?ok=" + encodeURIComponent(`${email} を発行しました`));
}

// ===================== セミナー取込 / エンゲージメント =====================
import { normalizeSeminar, type SeminarInput } from "@/lib/seminar-import";
import { deriveRoleLevel } from "@/lib/lead-import";

const ENG_EDIT_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales"];

/** 接点からエンゲージメント(person_engagement / accounts)を再計算。 */
export async function recomputeEngagementAction(): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.rpc("recompute_engagement", { p_tenant: ctx.tenantId });
  revalidatePath("/app/leads");
  revalidatePath("/app/accounts");
  return { ok: true };
}

/** 同名セミナーを置換取込するため、回答と接点を一旦削除。 */
export async function clearSeminarAction(seminarName: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = (seminarName ?? "").trim();
  if (!name) return { ok: false };
  await sb.from("seminar_responses").delete().eq("tenant_id", ctx.tenantId).eq("seminar_name", name);
  await sb.from("touchpoints").delete().eq("tenant_id", ctx.tenantId).eq("source", "seminar").contains("meta", { seminar: name });
  return { ok: true };
}

/**
 * セミナー参加者＋アンケートを取込。
 *  - seminar_responses に記録
 *  - メール名寄せ: 既存リードには接点を追加(ナーチャリング)、未登録は新規リード化
 *  - touchpoints(seminar / survey / doc_request)を作成しエンゲージメントに反映
 */
export async function importSeminarBatchAction(
  rows: SeminarInput[],
  opts: { campaignId?: string | null; leadSourceId?: string | null; seminarName: string; eventDate?: string | null },
): Promise<{ inserted: number; newLeads: number; error?: string }> {
  const ctx = await requireCtx();
  if (!ENG_EDIT_ROLES.includes(ctx.role)) return { inserted: 0, newLeads: 0, error: "権限がありません" };
  const sb = getSupabaseServer();
  const recs = rows
    .map((r) => normalizeSeminar(r, { tenantId: ctx.tenantId, campaignId: opts.campaignId, seminarName: opts.seminarName, eventDate: opts.eventDate }))
    .filter((r) => (r.company as string) || (r.email as string));
  if (!recs.length) return { inserted: 0, newLeads: 0 };

  const emails = [...new Set(recs.map((r) => (r.email as string | null) ?? "").filter(Boolean))];
  const existing = new Map<string, string>();
  if (emails.length) {
    const { data } = await sb.from("leads").select("id,email").eq("tenant_id", ctx.tenantId).in("email", emails);
    for (const row of data ?? []) if (row.email) existing.set(String(row.email).toLowerCase(), row.id);
  }

  // 未登録メール → 新規リード化(流入元=セミナー)
  const newLeadRecs: Record<string, unknown>[] = [];
  const seenNew = new Set<string>();
  for (const r of recs) {
    const em = r.email as string | null;
    if (!em || existing.has(em) || seenNew.has(em) || !(r.company as string)) continue;
    seenNew.add(em);
    const roleLevel = deriveRoleLevel(r.job_title as string | undefined);
    const nameParts = String(r.name ?? "").split(/[\s　]+/).filter(Boolean);
    const lastName = nameParts.length >= 2 ? nameParts[0] : null;
    const firstName = nameParts.length >= 2 ? nameParts.slice(1).join(" ") : null;
    newLeadRecs.push({
      tenant_id: ctx.tenantId, lead_source_id: opts.leadSourceId ?? null, campaign_id: opts.campaignId ?? null,
      raw_event: opts.seminarName, title: `${r.company} / ${opts.seminarName}`.slice(0, 200),
      company_name: r.company, company_norm: r.company_norm, contact_name: r.name, last_name: lastName, first_name: firstName, email: em,
      phone: r.phone, job_title: r.job_title, employee_size: r.employee_size, role_level: roleLevel,
      disposition: "untouched", status: "new", priority_base: 20,
      priority_score: priorityScore(20, { employee_size: r.employee_size as string, role_level: roleLevel }),
      acquired_at: opts.eventDate ?? (r.responded_at as string | null)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    });
  }
  let newLeads = 0;
  if (newLeadRecs.length) {
    const { data, error } = await sb.from("leads").insert(newLeadRecs).select("id,email");
    if (error) return { inserted: 0, newLeads: 0, error: error.message };
    for (const row of data ?? []) if (row.email) existing.set(String(row.email).toLowerCase(), row.id);
    newLeads = data?.length ?? 0;
  }

  const { error: sErr } = await sb.from("seminar_responses").insert(recs);
  if (sErr) return { inserted: 0, newLeads, error: sErr.message };

  const tps: Record<string, unknown>[] = [];
  for (const r of recs) {
    const em = r.email as string | null;
    const leadId = em ? existing.get(em) ?? null : null;
    const occ = (r.responded_at as string | null)?.slice(0, 10) ?? opts.eventDate ?? null;
    const base = { tenant_id: ctx.tenantId, email: em, company_norm: r.company_norm, lead_id: leadId, occurred_at: occ, source: "seminar", meta: { seminar: opts.seminarName } };
    tps.push({ ...base, type: "seminar", weight: 3 });
    if (r.satisfaction != null) tps.push({ ...base, type: "survey", weight: 2 });
    if (typeof r.follow_up === "string" && /資料/.test(r.follow_up)) tps.push({ ...base, type: "doc_request", weight: 3 });
  }
  if (tps.length) await sb.from("touchpoints").insert(tps);

  revalidatePath("/app/leads");
  revalidatePath("/app/analytics/seminars");
  return { inserted: recs.length, newLeads };
}

// ===================== リード ダウンロード(CSV) =====================
import { EXPORT_FIELD_MAP, exportValue, csvCell } from "@/lib/lead-export";

/** 絞り込み＋指定列・順序でリードをCSV化(BOM付きでExcel対応)。 */
export async function exportLeadsCsvAction(
  filters: { q?: string; event?: string; disposition?: string; rank?: string; engRank?: string; converted?: string },
  columns: string[],
): Promise<{ csv: string; count: number; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const cols = columns.filter((c) => EXPORT_FIELD_MAP[c]);
  if (!cols.length) return { csv: "", count: 0, error: "列が選択されていません" };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let qy = sb.from("leads").select("*").eq("tenant_id", ctx.tenantId);
    const q = (filters.q ?? "").replace(/[,%_()]/g, " ").trim();
    if (q) qy = qy.or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%`);
    if (filters.event) qy = qy.eq("raw_event", filters.event);
    if (filters.disposition) qy = qy.eq("disposition", filters.disposition);
    if (filters.rank) qy = qy.eq("rank", filters.rank);
    if (filters.converted === "yes") qy = qy.not("account_id", "is", null);
    if (filters.converted === "no") qy = qy.is("account_id", null);
    const { data, error } = await qy.order("priority_score", { ascending: false, nullsFirst: false }).order("id").range(from, from + PAGE - 1);
    if (error) return { csv: "", count: 0, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const emails = [...new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean))];
  const engMap = new Map<string, { rank: string; score: number }>();
  for (let i = 0; i < emails.length; i += 1000) {
    const { data } = await sb.from("person_engagement").select("email,rank,score").in("email", emails.slice(i, i + 1000));
    for (const e of data ?? []) engMap.set(String(e.email).toLowerCase(), { rank: e.rank ?? "D", score: e.score ?? 0 });
  }
  let out = rows.map((r) => ({ r, eng: engMap.get((r.email ?? "").toLowerCase()) }));
  if (filters.engRank) out = out.filter((x) => (x.eng?.rank ?? "D") === filters.engRank);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const header = cols.map((c) => csvCell(EXPORT_FIELD_MAP[c].label)).join(",");
  const lines = out.map(({ r, eng }) => cols.map((c) => csvCell(exportValue(c, r, eng))).join(","));
  return { csv: "\uFEFF" + [header, ...lines].join("\r\n"), count: out.length };
}

/** ダウンロード形式(列・順序)を名前付きで保存(同名は上書き)。 */
export async function saveExportPresetAction(name: string, columns: string[]): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const n = (name ?? "").trim();
  if (!n || !columns.length) return { ok: false };
  const { data } = await sb.from("lead_export_presets").select("id").eq("tenant_id", ctx.tenantId).eq("name", n).maybeSingle();
  if (data) await sb.from("lead_export_presets").update({ columns, updated_at: new Date().toISOString() }).eq("id", data.id);
  else await sb.from("lead_export_presets").insert({ tenant_id: ctx.tenantId, name: n, columns, created_by: ctx.userId });
  revalidatePath("/app/leads");
  return { ok: true };
}

export async function deleteExportPresetAction(id: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("lead_export_presets").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/leads");
  return { ok: true };
}

// ===================== 経営レビュー(週次幹部MTG支援) =====================
import { SALES_KPIS } from "@/lib/exec-review";

const REVIEW_EDIT = ["owner", "admin", "sales_manager", "sales_rep", "external_sales"];

/** 月次・週次KPI目標を保存(営業の各KPIをまとめてupsert)。 */
export async function saveKpiTargetsAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const month = str(formData.get("target_month"));
  const week = num(formData.get("target_week")) ?? 0;
  if (!month) return;
  const rows = SALES_KPIS.map((k) => ({
    tenant_id: ctx.tenantId, target_month: month, target_week: week, department: "sales", kpi_type: k.key,
    monthly_target: num(formData.get(`m_${k.key}`)) ?? 0,
    weekly_target: num(formData.get(`w_${k.key}`)) ?? 0,
    owner_user_id: ctx.userId,
  }));
  await sb.from("weekly_kpi_targets").upsert(rows, { onConflict: "tenant_id,target_month,target_week,department,kpi_type" });
  revalidatePath("/app/exec/kpi");
  revalidatePath("/app/exec");
  return;
}

/** KPI実績の手動補正(自動集計を上書き)。 */
export async function saveKpiActualAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const targetId = str(formData.get("target_id"));
  if (!targetId) return;
  const source = str(formData.get("actual_source")) === "manual" ? "manual" : "auto";
  await sb.from("weekly_kpi_results").upsert({
    tenant_id: ctx.tenantId, target_id: targetId,
    actual_value: num(formData.get("actual_value")) ?? 0,
    actual_source: source, source_memo: str(formData.get("source_memo")), input_user_id: ctx.userId,
  }, { onConflict: "target_id" });
  revalidatePath("/app/exec/kpi");
  return;
}

/** 振り返り(所感・真因・対策・期限・ステータス)を保存。 */
export async function saveWeeklyReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const targetId = str(formData.get("target_id"));
  if (!targetId) return;
  await sb.from("weekly_reviews").upsert({
    tenant_id: ctx.tenantId, target_id: targetId,
    evaluation: str(formData.get("evaluation")), system_comment: str(formData.get("system_comment")),
    human_comment: str(formData.get("human_comment")), root_cause: str(formData.get("root_cause")),
    countermeasure: str(formData.get("countermeasure")), owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
    due_date: str(formData.get("due_date")), status: str(formData.get("status")) ?? "open",
    next_check_point: str(formData.get("next_check_point")), result_comment: str(formData.get("result_comment")),
  }, { onConflict: "target_id" });
  revalidatePath("/app/exec/kpi");
  revalidatePath("/app/exec");
  revalidatePath("/app/exec/history");
  return;
}

/** MTGアクションを作成。 */
export async function createMtgActionAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const title = str(formData.get("title"));
  if (!title) return;
  await sb.from("mtg_actions").insert({
    tenant_id: ctx.tenantId, meeting_date: str(formData.get("meeting_date")), title,
    description: str(formData.get("description")), department: str(formData.get("department")) ?? "sales",
    related_type: str(formData.get("related_type")), related_id: str(formData.get("related_id")),
    owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId, due_date: str(formData.get("due_date")),
    priority: str(formData.get("priority")) ?? "middle", status: "open",
  });
  revalidatePath("/app/exec/actions");
  revalidatePath("/app/exec");
  return;
}

/** MTGアクションのステータス/完了コメント更新。 */
export async function updateMtgActionAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  const patch: Record<string, unknown> = { status: str(formData.get("status")) ?? "open" };
  if (formData.get("completion_comment") != null) patch.completion_comment = str(formData.get("completion_comment"));
  await sb.from("mtg_actions").update(patch).eq("id", id);
  revalidatePath("/app/exec/actions");
  revalidatePath("/app/exec");
  return;
}

/** 商談振り返り拡張(読み上げ方針・クロージング計画など)を保存。 */
export async function saveOppReviewExtAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const oppId = str(formData.get("existing_opportunity_id"));
  if (!oppId) return;
  await sb.from("opportunity_review_extensions").upsert({
    tenant_id: ctx.tenantId, existing_opportunity_id: oppId, review_week: str(formData.get("review_week")),
    read_up_plan: str(formData.get("read_up_plan")), closing_plan: str(formData.get("closing_plan")),
    blocking_issue: str(formData.get("blocking_issue")), executive_comment: str(formData.get("executive_comment")),
    next_check_point: str(formData.get("next_check_point")),
  }, { onConflict: "existing_opportunity_id" });
  revalidatePath("/app/exec/deals");
  return;
}

// ===================== 経営レビュー Phase2-4 =====================
/** マーケ施策の振り返り(既存campaignsに紐付く拡張)を保存。 */
export async function saveCampaignReviewExtAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const campaignId = str(formData.get("campaign_id"));
  if (!campaignId) return;
  await sb.from("campaign_review_extensions").upsert({
    tenant_id: ctx.tenantId, campaign_id: campaignId, review_week: str(formData.get("review_week")),
    prep_status: str(formData.get("prep_status")) ?? "not_started",
    review_comment: str(formData.get("review_comment")), next_improvement: str(formData.get("next_improvement")),
  }, { onConflict: "campaign_id" });
  revalidatePath("/app/exec/marketing");
}

/** デリバリー品質レビューを保存(idありは更新)。 */
export async function saveDeliveryReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const row = {
    tenant_id: ctx.tenantId, customer_id: str(formData.get("customer_id")), project_name: str(formData.get("project_name")),
    delivery_type: str(formData.get("delivery_type")) ?? "training", execution_date: str(formData.get("execution_date")),
    instructor_user_id: str(formData.get("instructor_user_id")), participants_count: num(formData.get("participants_count")),
    satisfaction_score: num(formData.get("satisfaction_score")), issue_flag: !!formData.get("issue_flag"),
    issue_detail: str(formData.get("issue_detail")), countermeasure: str(formData.get("countermeasure")),
    status: str(formData.get("status")) ?? "open",
  };
  if (id) await sb.from("delivery_reviews").update(row).eq("id", id);
  else { if (!row.project_name && !row.customer_id) return; await sb.from("delivery_reviews").insert(row); }
  revalidatePath("/app/exec/delivery");
}

/** 開発・顧問案件の原価/粗利レビューを保存(idありは更新)。 */
export async function saveProjectReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const contract = num(formData.get("contract_amount")) ?? 0;
  const fcost = num(formData.get("forecast_cost")) ?? 0;
  const row = {
    tenant_id: ctx.tenantId, customer_id: str(formData.get("customer_id")), project_type: str(formData.get("project_type")) ?? "dev",
    project_name: str(formData.get("project_name")), contract_amount: contract,
    planned_cost: num(formData.get("planned_cost")) ?? 0, actual_cost: num(formData.get("actual_cost")) ?? 0, forecast_cost: fcost,
    planned_gross_profit: num(formData.get("planned_gross_profit")) ?? (contract - (num(formData.get("planned_cost")) ?? 0)),
    forecast_gross_profit: num(formData.get("forecast_gross_profit")) ?? (contract - fcost),
    quality_risk: str(formData.get("quality_risk")), cost_risk: str(formData.get("cost_risk")),
    continuation_status: str(formData.get("continuation_status")), satisfaction_status: str(formData.get("satisfaction_status")),
    countermeasure: str(formData.get("countermeasure")),
  };
  if (id) await sb.from("project_profit_reviews").update(row).eq("id", id);
  else { if (!row.project_name && !row.customer_id) return; await sb.from("project_profit_reviews").insert(row); }
  revalidatePath("/app/exec/projects");
}

// ===================== Sランク顧客攻略 =====================
/** 顧客(account)または会社名でSランク顧客を指定(攻略対象に登録)。 */
export async function designateSrankAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const accountId = str(formData.get("account_id"));
  let companyName = str(formData.get("company_name"));
  if (accountId && !companyName) {
    const { data } = await sb.from("accounts").select("name").eq("id", accountId).maybeSingle();
    companyName = data?.name ?? null;
  }
  if (!companyName) return;
  await sb.from("srank_accounts").insert({
    tenant_id: ctx.tenantId, account_id: accountId, company_name: companyName,
    srank_reason: str(formData.get("srank_reason")), target_sales: num(formData.get("target_sales")),
    revenue_potential: num(formData.get("revenue_potential")), stage: "S-01", owner_user_id: ctx.userId,
  });
  revalidatePath("/app/srank");
}

/** Sランク会社の攻略情報を更新。 */
export async function updateSrankAccountAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  await sb.from("srank_accounts").update({
    srank_reason: str(formData.get("srank_reason")), revenue_potential: num(formData.get("revenue_potential")),
    target_sales: num(formData.get("target_sales")), longterm_target: num(formData.get("longterm_target")),
    deal_status: str(formData.get("deal_status")) ?? "none", stage: str(formData.get("stage")) ?? "S-01",
    exec_involved: !!formData.get("exec_involved"), manager_involved: !!formData.get("manager_involved"),
    priority_month: str(formData.get("priority_month")), exec_contact: !!formData.get("exec_contact"),
    exec_contact_person: str(formData.get("exec_contact_person")), exec_contact_route: str(formData.get("exec_contact_route")),
    exec_theme: str(formData.get("exec_theme")), company_issue: str(formData.get("company_issue")),
    next_upper_person: str(formData.get("next_upper_person")), intro_request_status: str(formData.get("intro_request_status")),
    next_exec_contact_date: str(formData.get("next_exec_contact_date")), next_dept_contact_date: str(formData.get("next_dept_contact_date")),
  }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath(`/app/srank/${id}`);
  revalidatePath("/app/srank");
}

/** 部署(create/update)。 */
export async function saveSrankDeptAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const srankId = str(formData.get("srank_account_id"));
  if (!srankId) return;
  const row = {
    tenant_id: ctx.tenantId, srank_account_id: srankId, name: str(formData.get("name")) ?? "(部署)",
    keyperson: str(formData.get("keyperson")), decision_maker: str(formData.get("decision_maker")),
    issue: str(formData.get("issue")), interest_products: str(formData.get("interest_products")),
    budget_status: str(formData.get("budget_status")), timing: str(formData.get("timing")),
    proposal_status: str(formData.get("proposal_status")) ?? "none", amount: num(formData.get("amount")) ?? 0,
    expansion_potential: str(formData.get("expansion_potential")), next_action: str(formData.get("next_action")),
    next_action_date: str(formData.get("next_action_date")),
  };
  if (id) await sb.from("srank_departments").update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
  else await sb.from("srank_departments").insert(row);
  revalidatePath(`/app/srank/${srankId}`);
}
export async function deleteSrankDeptAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id")); const srankId = str(formData.get("srank_account_id"));
  if (id) await sb.from("srank_departments").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (srankId) revalidatePath(`/app/srank/${srankId}`);
}

/** キーマン(create/update)。 */
export async function saveSrankKeypersonAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const srankId = str(formData.get("srank_account_id"));
  if (!srankId) return;
  const row = {
    tenant_id: ctx.tenantId, srank_account_id: srankId, name: str(formData.get("name")) ?? "(担当者)",
    department: str(formData.get("department")), title: str(formData.get("title")), role: str(formData.get("role")),
    influence: str(formData.get("influence")), relationship: str(formData.get("relationship")),
    interest: str(formData.get("interest")), last_contact_date: str(formData.get("last_contact_date")),
    next_contact_date: str(formData.get("next_contact_date")), intro_depts: str(formData.get("intro_depts")),
    concern: str(formData.get("concern")), next_request: str(formData.get("next_request")),
  };
  if (id) await sb.from("srank_keypersons").update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
  else await sb.from("srank_keypersons").insert(row);
  revalidatePath(`/app/srank/${srankId}`);
}
export async function deleteSrankKeypersonAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id")); const srankId = str(formData.get("srank_account_id"));
  if (id) await sb.from("srank_keypersons").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (srankId) revalidatePath(`/app/srank/${srankId}`);
}

// ===================== 既存顧客深耕 =====================
/** 既存顧客の深耕情報を保存(account単位でupsert)。 */
export async function saveAccountNurtureAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const accountId = str(formData.get("account_id"));
  if (!accountId) return;
  await sb.from("account_nurture").upsert({
    tenant_id: ctx.tenantId, account_id: accountId,
    nurture_stage: str(formData.get("nurture_stage")) ?? "just_won",
    relationship: str(formData.get("relationship")),
    deep_owner_user_id: str(formData.get("deep_owner_user_id")),
    next_contact_date: str(formData.get("next_contact_date")),
    additional_proposal: str(formData.get("additional_proposal")),
    expansion_depts: str(formData.get("expansion_depts")),
    exec_contact: !!formData.get("exec_contact"),
    this_year_additional: num(formData.get("this_year_additional")),
    next_proposal: str(formData.get("next_proposal")),
    services_done: str(formData.get("services_done")),
    notes: str(formData.get("notes")),
  }, { onConflict: "account_id" });
  revalidatePath("/app/nurture");
}

/** 既存顧客への接点履歴を追加。次回接点日も深耕側へ反映。 */
export async function addNurtureTouchAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const accountId = str(formData.get("account_id"));
  if (!accountId) return;
  const nextDate = str(formData.get("next_date"));
  await sb.from("nurture_touches").insert({
    tenant_id: ctx.tenantId, account_id: accountId,
    touched_at: str(formData.get("touched_at")) ?? new Date().toISOString().slice(0, 10),
    method: str(formData.get("method")), summary: str(formData.get("summary")),
    reaction: str(formData.get("reaction")), next_date: nextDate, owner_user_id: ctx.userId,
  });
  // 深耕レコードが無ければ作成し、次回接点日を更新
  await sb.from("account_nurture").upsert({
    tenant_id: ctx.tenantId, account_id: accountId, next_contact_date: nextDate ?? undefined,
  }, { onConflict: "account_id" });
  revalidatePath("/app/nurture");
}

// ===================== リード ファネルステージ =====================
/**
 * リードのアポ前ファネルステージを更新。
 *  new/mql/sql/appointment/nurturing/excluded。
 *  appointment にした場合は決着もアポ獲得にして自動案件化(promoteLeadCore)。
 */
export async function setLeadFunnelStageAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const stage = str(formData.get("funnel_stage")) ?? "new";
  if (!id) return;
  const patch: Record<string, unknown> = { funnel_stage: stage };
  if (stage === "appointment") { patch.disposition = "appointment"; patch.status = "qualified"; }
  else if (stage === "excluded") { patch.disposition = "excluded"; patch.status = "disqualified"; }
  await sb.from("leads").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (stage === "appointment") {
    await promoteLeadCore(sb, ctx.tenantId, ctx.userId, id);
    await sb.rpc("recompute_engagement", { p_tenant: ctx.tenantId });
    revalidatePath("/app/opportunities");
    revalidatePath("/app/dashboard");
  }
  revalidatePath("/app/leads");
}

// ===================== 展示会選定 =====================
/** 展示会候補の作成/更新(マーケ入力)。 */
export async function saveExhibitionCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!REVIEW_EDIT.includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const row = {
    tenant_id: ctx.tenantId, organizer: str(formData.get("organizer")), name: str(formData.get("name")) ?? "(展示会)",
    venue: str(formData.get("venue")), event_date: str(formData.get("event_date")), days: num(formData.get("days")) ?? 1,
    status: str(formData.get("status")) ?? "considering", has_seminar: !!formData.get("has_seminar"),
    theme_fit: str(formData.get("theme_fit")) ?? "mid", expected_visitors: num(formData.get("expected_visitors")),
    expected_leads: num(formData.get("expected_leads")), booth_cost: num(formData.get("booth_cost")) ?? 0,
    staff_cost: num(formData.get("staff_cost")) ?? 0, other_cost: num(formData.get("other_cost")) ?? 0,
    expected_deals: num(formData.get("expected_deals")), expected_unit_price: num(formData.get("expected_unit_price")),
    expected_revenue: num(formData.get("expected_revenue")), notes: str(formData.get("notes")),
  };
  if (id) await sb.from("exhibition_candidates").update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
  else await sb.from("exhibition_candidates").insert({ ...row, owner_user_id: ctx.userId });
  revalidatePath("/app/analytics/exhibition-select");
}

/** 出展判断(ステータス)の更新。 */
export async function setExhibitionStatusAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  await sb.from("exhibition_candidates").update({ status: str(formData.get("status")) ?? "considering" }).eq("id", id);
  revalidatePath("/app/analytics/exhibition-select");
}

/** 幹部の最終決定の更新。 */
export async function setExhibitionDecisionAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) return;
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  await sb.from("exhibition_candidates").update({ decision: str(formData.get("decision")) ?? "pending" }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/exhibition-select");
}

export async function deleteExhibitionCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (id) await sb.from("exhibition_candidates").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/exhibition-select");
}

// ===================== 施策ROI(marketing_channels / channel_costs) =====================
export async function saveChannelAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const row = {
    name: str(formData.get("name")) ?? "",
    category: str(formData.get("category")),
    kind: str(formData.get("kind")) ?? "other",
    cost_model: str(formData.get("cost_model")) ?? "none",
    committed_metric: str(formData.get("committed_metric")),
    committed_qty: num(formData.get("committed_qty")),
    target_level: str(formData.get("target_level")),
    priority_flag: formData.get("priority_flag") === "1",
    notes: str(formData.get("notes")),
  };
  if (!row.name) return;
  if (id) {
    await sb.from("marketing_channels").update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
  } else {
    await sb.from("marketing_channels").insert({ tenant_id: ctx.tenantId, ...row });
  }
  revalidatePath("/app/analytics/roi");
}

export async function deleteChannelAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (id) await sb.from("marketing_channels").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/roi");
}

export async function saveChannelCostAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const channelId = str(formData.get("channel_id"));
  const month = str(formData.get("month"));
  if (!channelId || !month) return;
  const monthKey = month.length === 7 ? month + "-01" : month; // YYYY-MM → YYYY-MM-01
  await sb.from("channel_costs").upsert(
    {
      tenant_id: ctx.tenantId,
      channel_id: channelId,
      month: monthKey,
      fixed_cost: num(formData.get("fixed_cost")) ?? 0,
      variable_cost: num(formData.get("variable_cost")) ?? 0,
      result_qty: num(formData.get("result_qty")),
      memo: str(formData.get("memo")),
      created_by: ctx.userId,
    },
    { onConflict: "tenant_id,channel_id,month" },
  );
  revalidatePath("/app/analytics/roi");
}

// ===================== プロダクト収益(products拡張 / サブスク解約) =====================
export async function saveProductMetaAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  const gpRate = num(formData.get("default_gross_profit_rate"));
  await sb.from("products").update({
    product_type: str(formData.get("product_type")),
    unit_cost: num(formData.get("unit_cost")),
    delivery_hours: num(formData.get("delivery_hours")),
    default_gross_profit_rate: gpRate != null ? (gpRate > 1 ? gpRate / 100 : gpRate) : null, // 50→0.5 も許容
    priority_flag: formData.get("priority_flag") === "1",
  }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/product-roi");
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (!id) return;
  const canceledMonthRaw = str(formData.get("canceled_month"));
  if (canceledMonthRaw) {
    const m = canceledMonthRaw.length === 7 ? canceledMonthRaw + "-01" : canceledMonthRaw;
    await sb.from("billing_schedules").update({
      sub_status: "canceled", canceled_month: m, cancel_reason: str(formData.get("cancel_reason")),
    }).eq("id", id).eq("tenant_id", ctx.tenantId);
  } else {
    // 月未指定は解約取消(再アクティブ化)
    await sb.from("billing_schedules").update({ sub_status: "active", canceled_month: null, cancel_reason: null })
      .eq("id", id).eq("tenant_id", ctx.tenantId);
  }
  revalidatePath("/app/analytics/product-roi");
}

// ===================== 展示会マスタ(主催/テーマ/費用のタグ付け) =====================
export async function saveExhibitionEventAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const rawEvent = str(formData.get("raw_event"));
  if (!rawEvent) return;
  const ym = (rawEvent.match(/^[0-9]{6}/)?.[0]) ?? null;
  await sb.from("exhibition_events").upsert(
    {
      tenant_id: ctx.tenantId,
      raw_event: rawEvent,
      ym,
      label: str(formData.get("label")),
      organizer: str(formData.get("organizer")),
      theme: str(formData.get("theme")),
      cost: num(formData.get("cost")),
    },
    { onConflict: "tenant_id,raw_event" },
  );
  revalidatePath("/app/analytics/exhibition-roi");
}

// ===================== 商談(案件)CSV取込: Notionヨミ表 → 顧客/案件/商談ログ 全置換 =====================
export async function importNotionDealsAction(
  rows: DealRow[],
  opts: { replaceAll: boolean },
): Promise<{ ok: boolean; inserted: number; meetings: number; accounts: number; error?: string }> {
  try {
    const ctx = await requireCtx();
    const sb = getSupabaseServer();
    const tenant = ctx.tenantId;

    // 参照マスタ
    const [{ data: prods }, { data: srcs }, { data: chans }, { data: profs }, { data: accs }] = await Promise.all([
      sb.from("products").select("id,name"),
      sb.from("lead_sources").select("id,name"),
      sb.from("marketing_channels").select("id,lead_source_id"),
      sb.from("profiles").select("id,display_name"),
      sb.from("accounts").select("id,name"),
    ]);
    const prodMap = new Map((prods ?? []).map((p) => [p.name as string, p.id as string]));
    const srcMap = new Map((srcs ?? []).map((s) => [s.name as string, s.id as string]));
    const chanByLs = new Map((chans ?? []).filter((c) => c.lead_source_id).map((c) => [c.lead_source_id as string, c.id as string]));
    const profList = (profs ?? []) as { id: string; display_name: string | null }[];
    const ownerOf = (name?: string): string | null => {
      const n = (name ?? "").trim();
      if (!n) return null;
      const hit = profList.find((p) => p.display_name === n)
        ?? profList.find((p) => (p.display_name ?? "").startsWith(n))
        ?? profList.find((p) => (p.display_name ?? "").split(/[ 　]/)[0] === n);
      return hit?.id ?? null;
    };
    // owner_user_id は NOT NULL。未割当/管理人、無ければ取込ユーザーをフォールバック。
    const fallbackOwner = profList.find((p) => p.display_name === "未割当")?.id
      ?? profList.find((p) => p.display_name === "管理人")?.id
      ?? ctx.userId;
    const accMap = new Map<string, string>();
    for (const a of accs ?? []) accMap.set(normCompany(a.name as string), a.id as string);

    // 全置換
    if (opts.replaceAll) {
      const { error: pErr } = await sb.rpc("purge_tenant_opportunities");
      if (pErr) return { ok: false, inserted: 0, meetings: 0, accounts: 0, error: "purge: " + pErr.message };
    }

    // 不足顧客を作成
    const needAcc = new Map<string, string>(); // norm -> displayName
    for (const r of rows) {
      const co = (r.company ?? "").trim();
      if (!co) continue;
      const norm = normCompany(co);
      if (!accMap.has(norm) && !needAcc.has(norm)) needAcc.set(norm, co);
    }
    let accountsCreated = 0;
    const newAccArr = Array.from(needAcc.entries());
    for (let i = 0; i < newAccArr.length; i += 200) {
      const slice = newAccArr.slice(i, i + 200);
      const { data: ins } = await sb.from("accounts").insert(slice.map(([, name]) => ({ tenant_id: tenant, name }))).select("id,name");
      for (const a of ins ?? []) { accMap.set(normCompany(a.name as string), a.id as string); accountsCreated++; }
    }

    const num = (v?: string) => { const s = (v ?? "").replace(/[^\d.-]/g, ""); return s === "" ? null : Number(s); };
    const t = (v?: string) => { const s = (v ?? "").trim(); return s === "" ? null : s; };
    // 日付正規化: "2025年4月1日" / "2025/04/04" / "2025-04-04" → YYYY-MM-DD
    const d = (v?: string): string | null => {
      const m = (v ?? "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
      return m ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : null;
    };
    // 日付＋時間(U列) → アポ日時(JST)。時間例: "10:00" / "14時30分" / "10"。
    const apptAt = (dateStr: string | null, timeV?: string): string | null => {
      if (!dateStr) return null;
      const tm = (timeV ?? "").match(/(\d{1,2})\D*(\d{1,2})?/);
      if (!tm) return null;
      const hh = String(Math.min(23, +tm[1])).padStart(2, "0");
      const mm = String(Math.min(59, +(tm[2] ?? 0))).padStart(2, "0");
      return `${dateStr}T${hh}:${mm}:00+09:00`;
    };

    // 案件レコード
    const oppRecords = rows.filter((r) => (r.company ?? "").trim()).map((r) => {
      const yf = yomiToFields(r.yomi);
      const won = yf.status === "won";
      const lost = yf.status === "lost";
      const lsId = r.source ? srcMap.get(r.source.trim()) ?? null : null;
      const amount = won ? num(r.sales) : (num(r.fsales) ?? num(r.sales));
      const closeDate = won ? (d(r.wonDate) ?? d(r.salesMonth)) : (d(r.expMonth) ?? d(r.nextAcDate));
      const notesParts = [r.owner ? `担当:${r.owner}` : "", r.detail ? `流入詳細:${r.detail}` : "", r.monthly ? `月額:${r.monthly}` : "", r.proposal ? `提案:${r.proposal}` : ""].filter(Boolean);
      return {
        rowKey: r.rowKey,
        rec: {
          tenant_id: tenant,
          external_ref: r.rowKey,
          import_source: "notion_yomi",
          account_id: accMap.get(normCompany(r.company!)) ?? null,
          name: (r.company! + (r.product ? " / " + r.product : "")).slice(0, 200),
          owner_user_id: ownerOf(r.owner) ?? fallbackOwner,
          stage: yf.stage,
          status: yf.status,
          forecast_category: yf.forecast,
          probability: yf.probability,
          campaign_estimated: false,
          yomi: t(r.yomi),
          amount: amount ?? 0,
          expected_close_date: closeDate,
          expected_revenue_month: d(r.salesMonth) ?? d(r.expMonth) ?? d(r.wonDate),
          first_meeting_date: d(r.firstMeeting),
          appointment_at: apptAt(d(r.firstMeeting), r.firstMeetingTime),
          next_action_date: d(r.nextAcDate),
          next_action_text: t(r.nextAcText),
          lost_reason: lost ? t(r.lostReason) : null,
          source_detail: canonicalExhibition(r.detail),
          primary_product_id: r.product ? prodMap.get(r.product.trim()) ?? null : null,
          lead_source_id: lsId,
          marketing_channel_id: lsId ? chanByLs.get(lsId) ?? null : null,
          category: productToCategory(r.product),
          notes: notesParts.length ? notesParts.join(" / ").slice(0, 2000) : null,
        },
      };
    });

    // 案件 投入(チャンク)＋ rowKey→id。account_id は NOT NULL のため未解決行は除外。
    const insertable = oppRecords.filter((x) => x.rec.account_id);
    const keyToId = new Map<string, string>();
    let inserted = 0;
    for (let i = 0; i < insertable.length; i += 300) {
      const slice = insertable.slice(i, i + 300);
      const { data: ins, error } = await sb.from("opportunities").insert(slice.map((x) => x.rec)).select("id,external_ref");
      if (error) return { ok: false, inserted, meetings: 0, accounts: accountsCreated, error: "opp: " + error.message };
      for (const o of ins ?? []) keyToId.set(o.external_ref as string, o.id as string);
      inserted += ins?.length ?? 0;
    }

    // 商談ログ(meetings): 事前情報(memo)＋議事録(minutes)
    const meetingRecs = rows
      .filter((r) => keyToId.has(r.rowKey) && (t(r.firstMeeting) || t(r.memo) || t(r.minutes)))
      .map((r) => ({
        tenant_id: tenant,
        opportunity_id: keyToId.get(r.rowKey)!,
        account_id: accMap.get(normCompany(r.company ?? "")) ?? null,
        owner_user_id: ownerOf(r.owner) ?? fallbackOwner,
        title: "商談ログ(Notion移行)",
        meeting_date: d(r.firstMeeting),
        meeting_at: apptAt(d(r.firstMeeting), r.firstMeetingTime),
        method: "商談",
        pre_info: t(r.memo),
        summary: t(r.minutes),
        next_action_date: d(r.nextAcDate),
        next_action_text: t(r.nextAcText),
        created_by: ctx.userId,
      }));
    let meetings = 0;
    for (let i = 0; i < meetingRecs.length; i += 300) {
      const slice = meetingRecs.slice(i, i + 300);
      const { error } = await sb.from("meetings").insert(slice);
      if (!error) meetings += slice.length;
    }

    await recomputeEngagementAction();
    revalidatePath("/app/opportunities");
    revalidatePath("/app/dashboard");
    return { ok: true, inserted, meetings, accounts: accountsCreated };
  } catch (e) {
    return { ok: false, inserted: 0, meetings: 0, accounts: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===================== 受注見込み(来期計画) =====================
export interface RevForecastInput {
  seq?: string; account?: string; product?: string; deal?: string; note?: string;
  period?: string; amount?: string; cost?: string; prob?: string; orderDate?: string;
  owner?: string; memo?: string; enteredOn?: string; updatedOn?: string;
}

export async function importRevenueForecastAction(
  rows: RevForecastInput[],
  opts: { fyStart: number; replaceAll: boolean },
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  try {
    const ctx = await requireCtx();
    const sb = getSupabaseServer();
    const fy = opts.fyStart;
    if (opts.replaceAll) {
      await sb.from("revenue_forecasts").delete()
        .eq("tenant_id", ctx.tenantId).eq("fy_start", fy).eq("import_source", "sheet");
    }
    const recs = rows
      .filter((r) => (r.account ?? "").trim() || (r.deal ?? "").trim())
      .map((r) => {
        const per = parsePeriod(r.period, fy);
        return {
          tenant_id: ctx.tenantId,
          seq: r.seq ? parseInt(r.seq.replace(/[^\d]/g, ""), 10) || null : null,
          account_name: str(r.account ?? null),
          product: str(r.product ?? null),
          deal_name: str(r.deal ?? null),
          note: str(r.note ?? null),
          period_label: str(r.period ?? null),
          period_start: per.start,
          period_end: per.end,
          amount: parseAmount(r.amount),
          cost: parseAmount(r.cost),
          probability: parseProbability(r.prob),
          expected_order_date: parseDateLoose(r.orderDate),
          owner: str(r.owner ?? null),
          memo: str(r.memo ?? null),
          entered_on: parseDateLoose(r.enteredOn),
          source_updated_on: parseDateLoose(r.updatedOn),
          fy_start: fy,
          import_source: "sheet",
        };
      });
    let inserted = 0;
    for (let i = 0; i < recs.length; i += 300) {
      const { data, error } = await sb.from("revenue_forecasts").insert(recs.slice(i, i + 300)).select("id");
      if (error) return { ok: false, inserted, error: error.message };
      inserted += data?.length ?? 0;
    }
    revalidatePath("/app/forecast/pipeline");
    revalidatePath("/app/forecast");
    return { ok: true, inserted };
  } catch (e) {
    return { ok: false, inserted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveRevenueForecastAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  const fy = num(formData.get("fy_start")) ?? new Date().getFullYear();
  const per = parsePeriod(str(formData.get("period")) ?? "", fy);
  const probRaw = str(formData.get("prob"));
  const rec = {
    account_name: str(formData.get("account")),
    product: str(formData.get("product")),
    deal_name: str(formData.get("deal")),
    period_label: str(formData.get("period")),
    period_start: per.start,
    period_end: per.end,
    amount: parseAmount(str(formData.get("amount")) ?? undefined),
    cost: parseAmount(str(formData.get("cost")) ?? undefined),
    probability: parseProbability(probRaw ?? undefined),
    expected_order_date: parseDateLoose(str(formData.get("orderDate")) ?? undefined),
    owner: str(formData.get("owner")),
    memo: str(formData.get("memo")),
    fy_start: fy,
  };
  if (id) {
    await sb.from("revenue_forecasts").update(rec).eq("id", id).eq("tenant_id", ctx.tenantId);
  } else {
    await sb.from("revenue_forecasts").insert({ tenant_id: ctx.tenantId, import_source: "manual", ...rec });
  }
  revalidatePath("/app/forecast/pipeline");
}

export async function deleteRevenueForecastAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));
  if (id) await sb.from("revenue_forecasts").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/forecast/pipeline");
}

// ===================== 展示会/施策別 原価(deal_detail_costs) =====================
export async function saveDealDetailCostAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const detail = str(formData.get("detail"));
  if (!detail) return;
  await sb.from("deal_detail_costs").upsert(
    { tenant_id: ctx.tenantId, detail, cost: num(formData.get("cost")) ?? 0, note: str(formData.get("note")) },
    { onConflict: "tenant_id,detail" },
  );
  revalidatePath("/app/analytics/exhibition-roi");
}

export async function importDealCostsAction(
  rows: { detail?: string; cost?: string }[],
): Promise<{ ok: boolean; upserted: number; error?: string }> {
  try {
    const ctx = await requireCtx();
    const sb = getSupabaseServer();
    const recs = rows
      .filter((r) => (r.detail ?? "").trim())
      .map((r) => ({ tenant_id: ctx.tenantId, detail: (r.detail ?? "").trim(), cost: num(r.cost ?? null) ?? 0 }));
    if (!recs.length) return { ok: true, upserted: 0 };
    const { error } = await sb.from("deal_detail_costs").upsert(recs, { onConflict: "tenant_id,detail" });
    if (error) return { ok: false, upserted: 0, error: error.message };
    revalidatePath("/app/analytics/exhibition-roi");
    return { ok: true, upserted: recs.length };
  } catch (e) {
    return { ok: false, upserted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
