"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
}

/** 顧客のインクリメンタル検索（上位20件）。全件プルダウンを避ける。 */
export async function searchAccountsAction(q: string): Promise<PickOption[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const query = sb.from("accounts").select("id,name,industry").order("name").limit(20);
  const { data } = q.trim() ? await query.ilike("name", `%${q.trim()}%`) : await query;
  return (data ?? []).map((a) => ({ id: a.id as string, label: (a.name as string) ?? "—", sub: (a.industry as string) ?? undefined }));
}

/** 案件のインクリメンタル検索（顧客で絞り込み可、上位20件）。 */
export async function searchOpportunitiesAction(q: string, accountId?: string): Promise<PickOption[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  let query = sb.from("opportunities").select("id,name,yomi").order("last_activity_at", { ascending: false }).limit(20);
  if (accountId) query = query.eq("account_id", accountId);
  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  const { data } = await query;
  return (data ?? []).map((o) => ({ id: o.id as string, label: (o.name as string) ?? "—", sub: (o.yomi as string) ?? undefined }));
}

export interface LogActivityInput {
  accountId: string;
  opportunityId: string | null;
  activityDate: string; // YYYY-MM-DD
  activityType: string;
  purpose: string | null;
  content: string;
  customerReaction: string | null;
  discoveredIssues: string | null;
  upsellOpportunity: string | null;
  budgetCheckResult: string | null;
  decisionMakerCheckResult: string | null;
  nextActionDate: string;
  nextActionText: string;
  meetingMinutesUrl: string | null;
}

export type LogActivityResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * 活動を1行登録し、関連する案件・顧客の最新状態を自動更新する（要件書4.4/12章）。
 * ※ 複数テーブル更新は逐次実行（Supabase JSはマルチ文トランザクション不可）。
 *    部分失敗のリスクは小さく（活動記録が主目的）、致命的な不整合は生じない。
 */
export async function logActivityAction(input: LogActivityInput): Promise<LogActivityResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  // 必須（入力負荷を抑えつつ、次回AC・活動内容は必須。要件書4.4/16）
  if (!input.accountId) return { ok: false, error: "顧客を選択してください" };
  if (!input.content?.trim()) return { ok: false, error: "活動内容を入力してください" };
  if (!input.nextActionDate) return { ok: false, error: "次回アクション日を入力してください" };
  if (!input.nextActionText?.trim()) return { ok: false, error: "次回アクション内容を入力してください" };

  const activityAt = new Date(`${input.activityDate}T09:00:00`).toISOString();

  const { data: inserted, error } = await sb
    .from("activities")
    .insert({
      tenant_id: ctx.tenantId,
      account_id: input.accountId,
      opportunity_id: input.opportunityId,
      owner_user_id: ctx.userId,
      activity_type: input.activityType || "meeting",
      purpose: input.purpose,
      title: input.content.trim().slice(0, 80),
      body: input.content.trim(),
      activity_at: activityAt,
      customer_reaction: input.customerReaction,
      discovered_issues: input.discoveredIssues,
      upsell_opportunity: input.upsellOpportunity,
      budget_check_result: input.budgetCheckResult,
      decision_maker_check_result: input.decisionMakerCheckResult,
      next_action_date: input.nextActionDate,
      next_action_text: input.nextActionText.trim(),
      meeting_minutes_url: input.meetingMinutesUrl,
    })
    .select("id")
    .single();

  if (error || !inserted) return { ok: false, error: "登録に失敗しました: " + (error?.message ?? "") };

  // 関連案件の最終活動/次回AC更新
  if (input.opportunityId) {
    await sb
      .from("opportunities")
      .update({
        last_activity_at: activityAt,
        next_action_date: input.nextActionDate,
        next_action_text: input.nextActionText.trim(),
      })
      .eq("id", input.opportunityId);
  }

  // 顧客の最終接触日・次回接触日更新
  await sb
    .from("accounts")
    .update({ last_activity_date: input.activityDate, next_contact_date: input.nextActionDate })
    .eq("id", input.accountId);

  // 提案活動なら7日後フォロータスクを自動作成（同案件に未完了の同origin無ければ）
  const isProposal = input.activityType === "proposal" || input.purpose === "proposal";
  if (isProposal && input.opportunityId) {
    const { data: existing } = await sb
      .from("tasks")
      .select("id")
      .eq("opportunity_id", input.opportunityId)
      .eq("origin", "followup7d")
      .neq("status", "done")
      .limit(1);
    if (!existing || existing.length === 0) {
      const due = new Date(`${input.activityDate}T00:00:00`);
      due.setDate(due.getDate() + 7);
      const { data: acc } = await sb.from("accounts").select("name").eq("id", input.accountId).maybeSingle();
      await sb.from("tasks").insert({
        tenant_id: ctx.tenantId,
        opportunity_id: input.opportunityId,
        account_id: input.accountId,
        assigned_to: ctx.userId,
        created_by: ctx.userId,
        title: `提案後フォロー: ${(acc?.name as string) ?? ""}`.trim(),
        description: "提案後7日以内のフォロー（自動作成）",
        due_date: due.toISOString().slice(0, 10),
        status: "todo",
        priority: "high",
        origin: "followup7d",
      });
    }
  }

  revalidatePath("/app/activities");
  if (input.opportunityId) revalidatePath(`/app/opportunities/${input.opportunityId}`);
  revalidatePath("/app/tasks");
  return { ok: true, id: inserted.id as string };
}

/* ============================================================
 * E-1 活動履歴のサーバーページング
 * ============================================================ */

export interface ActivityPageFilter {
  q?: string;
  owner?: string;
  type?: string;
}

export interface ActivityPageRow {
  id: string;
  activity_type: string;
  title: string;
  body: string | null;
  activity_at: string;
  owner_user_id: string | null;
  owner_name: string;
  owner_color: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  account_id: string | null;
  account_name: string | null;
}

/** 活動履歴をページ取得(RPC)。従来の全件ロードを置き換える。 */
export async function fetchActivitiesPageAction(input: {
  filter: ActivityPageFilter;
  offset: number;
  limit: number;
}): Promise<{ rows: ActivityPageRow[]; total: number }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("activities_page", {
    p_filter: input.filter,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error || !data) return { rows: [], total: 0 };
  const d = data as { rows: ActivityPageRow[]; total: number };
  return { rows: d.rows ?? [], total: d.total ?? 0 };
}
