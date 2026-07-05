"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { yomiToFields } from "@/lib/deal-import";
import { normCompany } from "@/lib/lead-import";

export interface RegisterAppointmentInput {
  accountId: string | null;      // 既存顧客を選んだ場合
  newCompanyName: string | null; // 新規顧客の場合(どちらか必須)
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  ownerUserId: string;           // 営業担当(必須)
  date: string;                  // アポ日 YYYY-MM-DD(必須)
  time: string | null;           // 開始時間 HH:MM
  productId: string | null;
  leadSourceId: string | null;
  preInfo: string | null;        // 事前情報(課題・温度感など)
}

export type RegisterAppointmentResult =
  | { ok: true; opportunityId: string; accountId: string; accountName: string }
  | { ok: false; error: string };

/**
 * インサイドセールスの「アポ獲得」をワンフォームで登録する。
 * 顧客の検索/新規作成 → 担当者(任意) → 案件(ヨミ=4.アポ)＋アポ日時 を一括作成。
 * 旧フロー(スプレッドシート共有→Notion登録)の置き換え。
 */
export async function registerAppointmentAction(input: RegisterAppointmentInput): Promise<RegisterAppointmentResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  if (!input.accountId && !input.newCompanyName?.trim()) return { ok: false, error: "顧客を選択するか、新規の会社名を入力してください" };
  if (!input.ownerUserId) return { ok: false, error: "営業担当を選択してください" };
  if (!input.date) return { ok: false, error: "アポ日を入力してください" };

  // 1) 顧客: 既存選択 or 新規作成(同名normがあれば再利用して重複を防ぐ)
  let accountId = input.accountId;
  let accountName = "";
  if (!accountId) {
    const name = input.newCompanyName!.trim();
    const norm = normCompany(name);
    const { data: existing } = await sb.from("accounts").select("id,name").limit(1000);
    const hit = (existing ?? []).find((a) => normCompany((a.name as string) ?? "") === norm);
    if (hit) {
      accountId = hit.id as string;
      accountName = hit.name as string;
    } else {
      const { data: created, error } = await sb
        .from("accounts")
        .insert({ tenant_id: ctx.tenantId, owner_user_id: input.ownerUserId, name, status: "prospect" })
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

  // 2) 担当者(任意)
  if (input.contactName?.trim()) {
    await sb.from("contacts").insert({
      tenant_id: ctx.tenantId,
      account_id: accountId,
      name: input.contactName.trim(),
      title: input.contactTitle?.trim() || null,
      phone: input.contactPhone?.trim() || null,
      email: input.contactEmail?.trim() || null,
    });
  }

  // 3) 案件(ヨミ=4.アポ)。初回商談の予定として登録。
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
      name: (accountName + (productName ? " / " + productName : "")).slice(0, 200),
      owner_user_id: input.ownerUserId,
      primary_product_id: input.productId,
      lead_source_id: input.leadSourceId,
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
      pre_research: input.preInfo?.trim() || null,
      last_activity_at: new Date().toISOString(),
      campaign_estimated: false,
    })
    .select("id")
    .single();
  if (oppErr || !opp) return { ok: false, error: "案件の作成に失敗しました: " + (oppErr?.message ?? "") };

  revalidatePath("/app/opportunities");
  revalidatePath("/app/dashboard");
  return { ok: true, opportunityId: opp.id as string, accountId, accountName };
}
