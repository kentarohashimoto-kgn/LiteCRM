"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { casUpdate } from "@/server/actions/_helpers";
import { getAccountMatrix } from "@/lib/data/account-matrix";
import type { AccountMatrix, MatrixAccount, MatrixFilter } from "@/lib/account-matrix";

/**
 * 顧客分析マトリクスの右ペイン用データ取得と、その場での更新。
 * 一覧から画面遷移せずに顧客と案件の状況を確認し、セグメント/ランクを付け替えられるようにする。
 * 詳細ページ(/app/accounts/[id])と同じ情報源から、パネル表示に必要な分だけを1往復で返す。
 */

const MATRIX_PATH = "/app/accounts/matrix";

export interface PanelOpportunity {
  id: string;
  name: string;
  stage: string;
  status: string;
  amount: number;
  probability: number;
  expectedCloseDate: string | null;
  ownerName: string | null;
  nextActionDate: string | null;
  nextActionText: string | null;
  lastActivityAt: string | null;
}

export interface PanelContact {
  id: string;
  name: string;
  department: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  decisionRole: string | null;
}

export interface PanelActivity {
  id: string;
  activityType: string;
  title: string;
  activityAt: string;
}

export interface AccountPanelData {
  ok: boolean;
  error?: string;
  account?: {
    id: string;
    name: string;
    industry: string | null;
    employeeSize: string | null;
    revenueSize: string | null;
    area: string | null;
    status: string;
    /** 手動ランク。null なら自動判定 */
    rank: string | null;
    focus: string | null;
    segmentId: string | null;
    websiteUrl: string | null;
    notes: string | null;
    ownerName: string | null;
    engagementScore: number | null;
    engagementRank: string | null;
    /** 楽観ロック(casUpdate)用 */
    updatedAt: string;
  };
  /** 受注/進行中の集計(マトリクスのセル表示と同じ定義) */
  totals?: { won: number; open: number; lost: number; oppCount: number };
  opportunities?: PanelOpportunity[];
  contacts?: PanelContact[];
  activities?: PanelActivity[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getAccountPanelAction(accountId: string): Promise<AccountPanelData> {
  await requireCtx();
  if (!accountId) return { ok: false, error: "顧客IDがありません" };
  const sb = getSupabaseServer();

  const { data: a, error } = await sb
    .from("accounts")
    .select("id,name,industry,employee_size,revenue_size,area,status,rank,focus,segment_id,website_url,notes,owner_user_id,engagement_score,engagement_rank,updated_at")
    .eq("id", accountId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !a) return { ok: false, error: "顧客が見つかりません" };
  const row = a as any;

  const [oppR, contactR, actR, ownerR] = await Promise.all([
    sb
      .from("opportunities")
      .select("id,name,stage,status,amount,probability,expected_close_date,owner_user_id,next_action_date,next_action_text,last_activity_at")
      .eq("account_id", accountId)
      .order("amount", { ascending: false })
      .limit(50),
    sb
      .from("contacts")
      .select("id,name,department,title,email,phone,decision_role")
      .eq("account_id", accountId)
      .order("created_at")
      .limit(30),
    sb
      .from("activities")
      .select("id,activity_type,title,activity_at")
      .eq("account_id", accountId)
      .order("activity_at", { ascending: false })
      .limit(15),
    row.owner_user_id
      ? sb.from("profiles").select("display_name,email").eq("id", row.owner_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const opps = (oppR.data ?? []) as any[];

  // 案件担当者の表示名をまとめて解決(案件ごとに担当が違うため)
  const oppOwnerIds = Array.from(new Set(opps.map((o) => o.owner_user_id).filter(Boolean)));
  const ownerNames = new Map<string, string>();
  if (oppOwnerIds.length > 0) {
    const { data: profs } = await sb.from("profiles").select("id,display_name,email").in("id", oppOwnerIds);
    for (const p of (profs ?? []) as any[]) ownerNames.set(p.id, p.display_name ?? p.email ?? "—");
  }

  const totals = opps.reduce(
    (acc, o) => {
      const amt = Number(o.amount ?? 0);
      if (o.status === "won") acc.won += amt;
      else if (o.status === "open") acc.open += amt;
      else acc.lost += amt;
      acc.oppCount += 1;
      return acc;
    },
    { won: 0, open: 0, lost: 0, oppCount: 0 }
  );

  const owner = ownerR.data as any;

  return {
    ok: true,
    account: {
      id: row.id,
      name: row.name,
      industry: row.industry ?? null,
      employeeSize: row.employee_size ?? null,
      revenueSize: row.revenue_size ?? null,
      area: row.area ?? null,
      status: row.status ?? "prospect",
      rank: row.rank ?? null,
      focus: row.focus ?? null,
      segmentId: row.segment_id ?? null,
      websiteUrl: row.website_url ?? null,
      notes: row.notes ?? null,
      ownerName: owner ? owner.display_name ?? owner.email ?? null : null,
      engagementScore: row.engagement_score ?? null,
      engagementRank: row.engagement_rank ?? null,
      updatedAt: row.updated_at,
    },
    totals,
    opportunities: opps.map((o) => ({
      id: o.id,
      name: o.name,
      stage: o.stage,
      status: o.status,
      amount: Number(o.amount ?? 0),
      probability: o.probability ?? 0,
      expectedCloseDate: o.expected_close_date ?? null,
      ownerName: o.owner_user_id ? ownerNames.get(o.owner_user_id) ?? null : null,
      nextActionDate: o.next_action_date ?? null,
      nextActionText: o.next_action_text ?? null,
      lastActivityAt: o.last_activity_at ?? null,
    })),
    contacts: ((contactR.data ?? []) as any[]).map((c) => ({
      id: c.id,
      name: c.name,
      department: c.department ?? null,
      title: c.title ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      decisionRole: c.decision_role ?? null,
    })),
    activities: ((actR.data ?? []) as any[]).map((x) => ({
      id: x.id,
      activityType: x.activity_type,
      title: x.title ?? "",
      activityAt: x.activity_at,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Result = { ok: boolean; error?: string; conflict?: boolean; updatedAt?: string };

/**
 * セグメントを手動で割り当てる(null で自動マッピングに戻す)。
 * 未分類が多い運用では、パネルからその場で直せることが実用上いちばん効く。
 */
export async function setAccountSegmentAction(input: {
  accountId: string;
  segmentId: string | null;
  updatedAt: string;
}): Promise<Result> {
  await requireCtx();
  const r = await casUpdate("accounts", input.accountId, input.updatedAt, { segment_id: input.segmentId });
  if (!r.ok) return { ok: false, error: r.error, conflict: r.conflict };
  revalidatePath(MATRIX_PATH);
  revalidatePath(`/app/accounts/${input.accountId}`);
  return { ok: true, updatedAt: r.updated_at };
}

/** 手動ランクを設定する(null で自動判定に戻す)。 */
export async function setAccountRankAction(input: {
  accountId: string;
  rank: string | null;
  updatedAt: string;
}): Promise<Result> {
  await requireCtx();
  if (input.rank !== null && !["S", "A", "B", "C", "D"].includes(input.rank)) {
    return { ok: false, error: "不正なランクです" };
  }
  const r = await casUpdate("accounts", input.accountId, input.updatedAt, { rank: input.rank });
  if (!r.ok) return { ok: false, error: r.error, conflict: r.conflict };
  revalidatePath(MATRIX_PATH);
  revalidatePath(`/app/accounts/${input.accountId}`);
  return { ok: true, updatedAt: r.updated_at };
}

/**
 * 絞り込み条件を変えてマトリクスを取り直す。
 * 条件はセルの中身まで変えるので、画面側での絞り込みではなく RPC から引き直す。
 */
export async function fetchAccountMatrixAction(filter: MatrixFilter): Promise<AccountMatrix> {
  await requireCtx();
  return getAccountMatrix(filter);
}

/**
 * セル明細(「他N社」)の続きを取得する。
 * マトリクス本体は1セル数件しか返さないため、大きいセルはここから追加読込する。
 * filter はマトリクス本体と同じものを渡す(渡さないと「他N社」の件数と中身がずれる)。
 */
export async function listCellAccountsAction(input: {
  segmentKey: string;
  rank: string;
  offset: number;
  limit?: number;
  filter?: MatrixFilter;
}): Promise<{ ok: boolean; error?: string; rows: MatrixAccount[]; total: number }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("account_segment_rank_accounts", {
    p_segment: input.segmentKey,
    p_rank: input.rank,
    p_offset: Math.max(0, input.offset),
    p_limit: Math.min(Math.max(1, input.limit ?? 50), 200),
    p_filter: input.filter ?? {},
  });
  if (error) return { ok: false, error: error.message, rows: [], total: 0 };
  const res = (data ?? { rows: [], total: 0 }) as { rows: MatrixAccount[]; total: number };
  return { ok: true, rows: res.rows ?? [], total: res.total ?? 0 };
}
