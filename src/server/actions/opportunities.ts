"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { yomiToFields } from "@/lib/deal-import";
import { deriveFirstMeeting, earliestMeeting, jstDate } from "@/lib/meeting-sync";
import { canReassignOwner } from "@/lib/constants";
import { casUpdate } from "./_helpers";
import { ensureTransitionOnWon } from "@/server/transitions-util";
import type { OppsPage, LeanOppRow } from "@/lib/data/opps-page";
import type { CalItem } from "@/lib/data/calendar";

export interface OppPageFilter {
  q?: string;
  yomi?: string[];
  owner?: string;
  product?: string;
  source?: string;
  campaign?: string;
  only_no_next?: boolean;
  only_stale?: boolean;
}

/** 案件一覧のページ取得(サーバーページング)。総件数・合計も返す。 */
export async function fetchOppsPageAction(input: {
  filter: OppPageFilter;
  sort: string;
  asc: boolean;
  offset: number;
  limit?: number;
}): Promise<OppsPage> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("opportunities_page", {
    p_filter: input.filter,
    p_sort: input.sort,
    p_asc: input.asc,
    p_limit: input.limit ?? 50,
    p_offset: input.offset,
  });
  // タイムアウト等のエラーを握り潰すと「0件」に見える(2026-07-12障害)。必ずthrowしerror.tsxで再読込を促す
  if (error) throw new Error(`案件一覧の取得に失敗しました: ${error.message}`);
  const d = (data ?? {}) as Partial<OppsPage>;
  return { rows: d.rows ?? [], total: d.total ?? 0, sum_amount: d.sum_amount ?? 0, sum_weighted: d.sum_weighted ?? 0 };
}

// ===================== 保存ビュー(絞込プリセット) =====================
export interface OppViewPreset {
  id: string;
  name: string;
  params: Record<string, unknown>;
  is_shared: boolean;
  owner_user_id: string;
}

export async function listOppViewPresetsAction(): Promise<OppViewPreset[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.from("opp_view_presets").select("id,name,params,is_shared,owner_user_id").order("created_at");
  return (data ?? []) as OppViewPreset[];
}

export async function saveOppViewPresetAction(input: { name: string; params: Record<string, unknown>; isShared: boolean }): Promise<{ ok: boolean; preset?: OppViewPreset; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!input.name.trim()) return { ok: false, error: "ビュー名を入力してください" };
  const { data, error } = await sb
    .from("opp_view_presets")
    .insert({ tenant_id: ctx.tenantId, owner_user_id: ctx.userId, name: input.name.trim(), params: input.params, is_shared: input.isShared })
    .select("id,name,params,is_shared,owner_user_id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "保存に失敗しました" };
  return { ok: true, preset: data as OppViewPreset };
}

export async function deleteOppViewPresetAction(input: { id: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("opp_view_presets").delete().eq("id", input.id);
  return { ok: !error };
}

/** アポ日時(appointment_at)をその場更新。ISO文字列 or null。 */
export async function setAppointmentAtAction(input: { id: string; iso: string | null }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("opportunities").update({ appointment_at: input.iso }).eq("id", input.id);
  if (error) return { ok: false };

  // カレンダー上のアポ移動は「初回商談(最も早い商談)の振り替え」を意味する。
  // 商談レコード側も追従させ、案件の初回商談日/アポ日時を再同期する。
  // これをしないと商談と案件で日付がズレ、カレンダーに別日で二重表示される。
  if (input.iso) {
    const day = jstDate(input.iso);
    const { data } = await sb.from("meetings").select("id, meeting_date, meeting_at").eq("opportunity_id", input.id);
    const rows = (data ?? []) as { id: string; meeting_date: string | null; meeting_at: string | null }[];
    const first = earliestMeeting(rows);
    if (first) {
      await sb.from("meetings").update({ meeting_at: input.iso, meeting_date: day }).eq("id", first.id);
      const patch = deriveFirstMeeting(
        rows.map((r) => (r.id === first.id ? { meeting_date: day, meeting_at: input.iso } : r)),
      );
      if (patch) await sb.from("opportunities").update(patch).eq("id", input.id);
    } else {
      // 商談がまだ無い案件: 案件側の初回商談日だけ整合させる
      await sb.from("opportunities").update({ first_meeting_date: day }).eq("id", input.id);
    }
  }
  revalidatePath("/app/opportunities");
  return { ok: true };
}

/** ボード表示用に全案件(軽量)を取得。ボードを開いた時だけ遅延取得する。 */
export async function fetchAllOppsLeanAction(): Promise<LeanOppRow[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("opportunities_page", {
    p_filter: {},
    p_sort: "expected_close_date",
    p_asc: true,
    p_limit: 5000,
    p_offset: 0,
  });
  // タイムアウト等のエラーを握り潰すと「0件」に見える(2026-07-12障害)。必ずthrowしerror.tsxで再読込を促す
  if (error) throw new Error(`案件一覧の取得に失敗しました: ${error.message}`);
  return ((data ?? {}) as Partial<OppsPage>).rows ?? [];
}

/** カレンダー表示用にアポ(ヨミ=4.アポ)のみ取得。全件(5000)ではなくアポ数十件で済む。 */
export async function fetchApptOppsLeanAction(): Promise<LeanOppRow[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("opportunities_page", {
    p_filter: { yomi: ["4.アポ"] },
    p_sort: "expected_close_date",
    p_asc: true,
    p_limit: 2000,
    p_offset: 0,
  });
  // タイムアウト等のエラーを握り潰すと「0件」に見える(2026-07-12障害)。必ずthrowしerror.tsxで再読込を促す
  if (error) throw new Error(`案件一覧の取得に失敗しました: ${error.message}`);
  return ((data ?? {}) as Partial<OppsPage>).rows ?? [];
}

/** アポカレンダー用イベント: アポ(予定) と アポ済(商談実施) を統合して取得。 */
export async function fetchCalendarItemsAction(): Promise<CalItem[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("appointment_calendar_events");
  return (data ?? []) as CalItem[];
}

// ===================== 商談一覧(案件の下位階層) =====================
export interface MeetingListRow {
  id: string;
  title: string | null;
  summary: string | null;
  meeting_date: string | null;   // 商談実施日(日付)
  meeting_at: string | null;     // 商談実施日時
  created_at: string;            // 商談登録日
  method: string | null;
  owner_user_id: string | null;
  opportunity_id: string;
  opp_name: string;
  account_name: string;
  yomi: string | null;
}

/** 商談(meetings)の一覧を、案件名・顧客名付きで取得(RLSスコープ済・最大2000件)。
 *  案件一覧の下位階層として「商談一覧」タブで表示する。ソートはクライアント側で行う。 */
export async function fetchMeetingsListAction(): Promise<MeetingListRow[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  // opportunities!inner で親案件が可視(削除除外・権限内)の商談のみに絞る。
  const { data } = await sb
    .from("meetings")
    .select("id,title,summary,meeting_date,meeting_at,created_at,method,owner_user_id,opportunity_id, opportunities!inner(name,yomi,accounts(name))")
    .order("created_at", { ascending: false })
    .limit(2000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id as string,
    title: (m.title as string) ?? null,
    summary: (m.summary as string) ?? null,
    meeting_date: (m.meeting_date as string) ?? null,
    meeting_at: (m.meeting_at as string) ?? null,
    created_at: m.created_at as string,
    method: (m.method as string) ?? null,
    owner_user_id: (m.owner_user_id as string) ?? null,
    opportunity_id: m.opportunity_id as string,
    opp_name: (m.opportunities?.name as string) ?? "—",
    yomi: (m.opportunities?.yomi as string) ?? null,
    account_name: (m.opportunities?.accounts?.name as string) ?? "—",
  }));
}

export type OppInlineField =
  | "yomi"
  | "amount"
  | "expected_revenue_month"
  | "next_action_date"
  | "next_action_text"
  | "owner_user_id";

export type OppInlineResult =
  | { ok: true; updated_at: string; patch: Record<string, unknown> }
  | { ok: false; error: string; conflict?: boolean };

/** ヨミの先頭数字（大分類）。0..9 / 不明はNaN。 */
function yomiMajor(y: string | null | undefined): number {
  if (!y) return NaN;
  const n = parseInt(y[0], 10);
  return Number.isNaN(n) ? NaN : n;
}

interface OppFinancials {
  amount: number | null;
  expected_close_date: string | null;
}

/**
 * ヨミを A以上(2.B/1.A/0.受注)へ「引き上げる」ときの財務ハードストップ検証。
 * 要件書4.3の A以上=提案金額・受注予定日 必須 に対応。
 * ※ 顧客課題・提案書などの検証は案件詳細フォーム(全項目編集可)側で行う。
 *   インライン/ボードのクイック編集では、これらは編集不可のためブロックしない。
 */
function validateYomiRaise(targetYomi: string, cur: OppFinancials): string | null {
  const major = yomiMajor(targetYomi);
  const isAplus = major === 2 || major === 1 || major === 0;
  if (!isAplus) return null;
  const missing: string[] = [];
  if (!(cur.amount && cur.amount > 0)) missing.push("提案金額");
  if (!cur.expected_close_date) missing.push("受注予定日");
  if (missing.length) {
    return `ヨミを「${targetYomi}」へ上げるには次の入力が必要です: ${missing.join(" / ")}（案件詳細で入力してください）`;
  }
  return null;
}

/**
 * 案件一覧/ボードのインライン編集。1フィールドをCAS(楽観ロック)で更新。
 * ヨミ変更時は stage/status/forecast/probability を取込ロジックと同じ規則で連動更新する。
 */
export async function updateOppInlineAction(input: {
  id: string;
  updatedAt: string;
  field: OppInlineField;
  value: string | null;
}): Promise<OppInlineResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = {};

  if (input.field === "yomi") {
    const y = (input.value ?? "").trim();
    if (y) {
      const { data: cur } = await sb
        .from("opportunities")
        .select("amount,expected_close_date")
        .eq("id", input.id)
        .maybeSingle();
      const err = validateYomiRaise(y, {
        amount: (cur?.amount as number) ?? null,
        expected_close_date: (cur?.expected_close_date as string) ?? null,
      });
      if (err) return { ok: false, error: err };
    }
    const f = yomiToFields(y);
    patch.yomi = y || null;
    patch.stage = f.stage;
    patch.status = f.status;
    patch.forecast_category = f.forecast;
    patch.probability = f.probability;
  } else if (input.field === "amount") {
    const v = input.value == null || input.value === "" ? 0 : Number(String(input.value).replace(/[^\d.-]/g, ""));
    patch.amount = Number.isNaN(v) ? 0 : v;
  } else if (input.field === "expected_revenue_month") {
    patch.expected_revenue_month = input.value ? input.value.slice(0, 7) + "-01" : null;
  } else if (input.field === "next_action_date") {
    patch.next_action_date = input.value || null;
  } else if (input.field === "next_action_text") {
    patch.next_action_text = input.value || null;
  } else if (input.field === "owner_user_id") {
    if (!canReassignOwner(ctx.role)) return { ok: false, error: "担当者の変更は代表・管理者・Sales Opsのみ実行できます" };
    patch.owner_user_id = input.value || null;
  } else {
    return { ok: false, error: "不正なフィールドです" };
  }

  const res = await casUpdate("opportunities", input.id, input.updatedAt, patch);
  if (!res.ok) return res;

  // 研修/開発案件が受注になったらトランジションを自動作成
  if (patch.status === "won") {
    await ensureTransitionOnWon(ctx.tenantId, ctx.userId, input.id);
  }

  revalidatePath("/app/opportunities");
  revalidatePath("/app/forecast");
  return { ok: true, updated_at: res.updated_at, patch };
}

/**
 * 次回アクションの消込(「今日のアポ・AC」画面から1タップ)。
 * opportunities.next_action_date/text を空にして「期限超過」から外す。
 * 誰がいつ何を消したか分からなくならないよう、消した内容を activities に社内メモで1件残す。
 *
 * ※ last_activity_at は意図的に更新しない。消込は顧客接点ではないため、
 *   ここで触ると停滞判定(src/lib/risk.ts の stale / src/lib/pmo.ts)が
 *   「最近動いた案件」と誤認して危険案件を見逃す。
 * ※ CAS(updatedAt)で守る。他メンバーが直前に新しいACを入れていた場合に
 *   それを黙って消さないため。
 */
export async function clearNextActionAction(input: {
  id: string;
  updatedAt: string;
}): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const { data: cur } = await sb
    .from("opportunities")
    .select("id, account_id, next_action_date, next_action_text")
    .eq("id", input.id)
    .maybeSingle();
  if (!cur) return { ok: false, error: "案件が見つかりません" };
  const o = cur as { id: string; account_id: string | null; next_action_date: string | null; next_action_text: string | null };
  // 連打・別タブでの二重消込。既に空なら成功扱い(空ログを積まない)。
  if (!o.next_action_date && !o.next_action_text) return { ok: true };

  const res = await casUpdate("opportunities", input.id, input.updatedAt, {
    next_action_date: null,
    next_action_text: null,
  });
  if (!res.ok) return { ok: false, error: res.error, conflict: res.conflict };

  await sb.from("activities").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: o.id,
    account_id: o.account_id,
    owner_user_id: ctx.userId,
    activity_type: "internal_memo",
    title: "次回アクションを消込",
    body: `消込した次回アクション: ${o.next_action_date ?? "日付なし"}${o.next_action_text ? ` / ${o.next_action_text}` : ""}`,
    activity_at: new Date().toISOString(),
  });

  revalidatePath("/app/today");
  revalidatePath("/app/activities");
  revalidatePath("/app/opportunities");
  revalidatePath(`/app/opportunities/${o.id}`);
  return { ok: true };
}

/* ============================================================
 * A-6 一括操作
 * ============================================================ */

/**
 * 選択した案件の担当 or ヨミを一括変更。
 * ヨミは取込ロジックと同じ規則で stage/status/forecast/probability を連動更新。
 * ※ 一括では入力チェックができないため「0.受注」「1.ほぼ確」への一括変更はUI側で不可。
 */
export async function bulkUpdateOppsAction(input: {
  ids: string[];
  field: "owner_user_id" | "yomi";
  value: string;
}): Promise<{ ok: boolean; updated: number; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const ids = input.ids.slice(0, 200);
  if (ids.length === 0) return { ok: false, updated: 0, error: "案件が選択されていません" };

  const patch: Record<string, unknown> = {};
  if (input.field === "owner_user_id") {
    if (!canReassignOwner(ctx.role)) return { ok: false, updated: 0, error: "担当者の一括変更は代表・管理者・Sales Opsのみ実行できます" };
    if (!input.value) return { ok: false, updated: 0, error: "担当を選択してください" };
    patch.owner_user_id = input.value;
  } else {
    const y = input.value.trim();
    if (y.startsWith("0") || y.startsWith("1")) {
      return { ok: false, updated: 0, error: "受注/ほぼ確への変更は案件ごとに必須入力があるため、一括では変更できません" };
    }
    const f = yomiToFields(y);
    patch.yomi = y || null;
    patch.stage = f.stage;
    patch.status = f.status;
    patch.forecast_category = f.forecast;
    patch.probability = f.probability;
  }

  const { error, count } = await sb
    .from("opportunities")
    .update(patch, { count: "exact" })
    .in("id", ids)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidatePath("/app/opportunities");
  revalidatePath("/app/forecast");
  return { ok: true, updated: count ?? 0 };
}

/** 選択した案件へ一括でタスクを作成(担当=各案件の担当者。展示会後の大量割当て向け)。 */
export async function bulkCreateTasksAction(input: {
  ids: string[];
  title: string;
  dueDate: string;
}): Promise<{ ok: boolean; created: number; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const ids = input.ids.slice(0, 200);
  const title = input.title.trim();
  if (ids.length === 0) return { ok: false, created: 0, error: "案件が選択されていません" };
  if (!title) return { ok: false, created: 0, error: "タスク名を入力してください" };
  if (!input.dueDate) return { ok: false, created: 0, error: "期日を入力してください" };

  const { data: opps } = await sb
    .from("opportunities")
    .select("id, owner_user_id, account_id")
    .in("id", ids)
    .eq("tenant_id", ctx.tenantId);
  const rows = (opps ?? []).map((o) => ({
    tenant_id: ctx.tenantId,
    opportunity_id: o.id as string,
    account_id: (o.account_id as string) ?? null,
    assigned_to: (o.owner_user_id as string) ?? ctx.userId,
    created_by: ctx.userId,
    title,
    due_date: input.dueDate,
    status: "todo",
    origin: "bulk",
  }));
  if (rows.length === 0) return { ok: false, created: 0, error: "対象案件が見つかりません" };

  const { error } = await sb.from("tasks").insert(rows);
  if (error) return { ok: false, created: 0, error: error.message };
  revalidatePath("/app/tasks");
  return { ok: true, created: rows.length };
}

/** 案件のアカウンター(顧客側の窓口担当者)を設定/変更する。 */
export async function setOpportunityAccounterAction(formData: FormData): Promise<void> {
  await requireCtx();
  const oppId = String(formData.get("opp_id") ?? "").trim();
  const contactId = String(formData.get("contact_id") ?? "").trim() || null;
  if (!oppId) redirect(`/app/opportunities?error=save_failed`);
  const sb = getSupabaseServer();
  if (contactId) {
    // 選択された担当者が同じ顧客に属することを確認(別顧客の担当者を紐づけない)
    const [oppR, cR] = await Promise.all([
      sb.from("opportunities").select("account_id").eq("id", oppId).maybeSingle(),
      sb.from("contacts").select("account_id").eq("id", contactId).maybeSingle(),
    ]);
    if (oppR.error || cR.error || !oppR.data || !cR.data || (oppR.data as { account_id: string }).account_id !== (cR.data as { account_id: string }).account_id) {
      redirect(`/app/opportunities/${oppId}?error=accounter_mismatch`);
    }
  }
  const up = await sb.from("opportunities").update({ contact_id: contactId }).eq("id", oppId);
  if (up.error) redirect(`/app/opportunities/${oppId}?error=save_failed`);
  revalidatePath(`/app/opportunities/${oppId}`);
  redirect(`/app/opportunities/${oppId}?saved=accounter`);
}
