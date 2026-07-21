/**
 * リード専用のデータアクセス。
 * リードは件数が大きく(数千〜万件)、全画面で全件をメモリに載せるのは非効率なため、
 * グローバルな workspace スナップショットから切り離し、ここで必要な形だけ取得する。
 *  - getLeadMetrics: ダッシュボード/予測/目標/レビュー等が使う「集計値」(行は返さない)
 *  - getAllLeads:    リード画面専用の全件取得(この画面でのみ materialize)
 *  - getLead:        単票取得
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { OppView } from "@/lib/data/select";
import type { Lead, LeadImportBatch, AcquirerAlias, LeadExportPreset } from "@/lib/types";
import { sizeBucket, type WsListRow, type WsQueueRow, type LeadsFilters, type CompaniesData, type FunnelData, type AnalysisData } from "@/lib/data/leads-workspace";

export interface LeadMetrics {
  total: number;
  byMonth: Map<string, number>; // acquired_at 月 -> 件数
  apptByMonth: Map<string, number>; // 決着=アポ獲得 を獲得月で
  wonByMonth: Map<string, number>; // リード起点の受注 を獲得月で
  bySource: Map<string, number>; // lead_source_id -> 件数
}

/**
 * リード集計。SQL集計関数(lead_metrics)で行を転送せずに取得する。
 * 引数 opps は後方互換のため受け取るが未使用(受注判定はSQL側で実施)。
 */
export async function getLeadMetrics(_opps?: OppView[]): Promise<LeadMetrics> {
  void _opps;
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("lead_metrics");
  const j = (data ?? {}) as { total?: number; byMonth?: Record<string, number>; apptByMonth?: Record<string, number>; wonByMonth?: Record<string, number>; bySource?: Record<string, number> };
  const toMap = (o?: Record<string, number>) => new Map(Object.entries(o ?? {}));
  return {
    total: j.total ?? 0,
    byMonth: toMap(j.byMonth),
    apptByMonth: toMap(j.apptByMonth),
    wonByMonth: toMap(j.wonByMonth),
    bySource: toMap(j.bySource),
  };
}

const LIST_PAGE = 100;
const LIST_COLS = "id,company_name,contact_name,email,rank,job_title,employee_size,raw_event,priority_score,disposition,call_owner,phone,mobile_phone,account_id,status,funnel_stage";

/** リード一覧: SQL でフィルタ＋優先度降順＋ページング(全件ロードしない)。 */
export async function queryLeadList(f: LeadsFilters): Promise<{ rows: WsListRow[]; total: number; page: number; pageSize: number }> {
  const sb = getSupabaseServer();
  const page = Math.max(1, f.page ?? 1);
  const start = (page - 1) * LIST_PAGE;
  let qy = sb.from("leads").select(LIST_COLS, { count: "exact" });
  const q = (f.q ?? "").replace(/[,%_()]/g, " ").trim();
  if (q) qy = qy.or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%`);
  if (f.sourceIdIn) qy = qy.in("lead_source_id", f.sourceIdIn);
  if (f.event) qy = qy.eq("raw_event", f.event);
  if (f.disposition) qy = qy.eq("disposition", f.disposition);
  if (f.rank) qy = qy.eq("rank", f.rank);
  const { data, count } = await qy
    .order("priority_score", { ascending: false, nullsFirst: false })
    .order("id")
    .range(start, start + LIST_PAGE - 1);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const list = (data ?? []) as any[];
  // エンゲージメント(person_engagement)をメールで突き合わせ
  const emails = [...new Set(list.map((l) => (l.email ?? "").toLowerCase()).filter(Boolean))];
  const engMap = new Map<string, { rank: string; score: number }>();
  if (emails.length) {
    const { data: eng } = await sb.from("person_engagement").select("email,rank,score").in("email", emails);
    for (const e of eng ?? []) engMap.set(String(e.email).toLowerCase(), { rank: e.rank ?? "D", score: e.score ?? 0 });
  }
  const rows: WsListRow[] = list.map((l) => {
    const e = engMap.get((l.email ?? "").toLowerCase());
    return {
      id: l.id, company: l.company_name ?? "", name: l.contact_name ?? "", rank: l.rank ?? "",
      jobTitle: l.job_title ?? "", empSizeBucket: sizeBucket(l.employee_size ?? ""), event: l.raw_event ?? "",
      score: l.priority_score ?? 0, disposition: l.disposition ?? "untouched", callOwner: l.call_owner ?? "",
      phone: l.phone ?? "", mobilePhone: l.mobile_phone ?? "", converted: !!l.account_id || l.status === "converted",
      engRank: e?.rank ?? "D", engScore: e?.score ?? 0, funnelStage: l.funnel_stage ?? "new",
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { rows, total: count ?? 0, page, pageSize: LIST_PAGE };
}

/** 架電キュー: 未着手・不通を優先度降順で上位300件(SQL)。 */
export async function queryCallQueue(): Promise<{ rows: WsQueueRow[]; total: number }> {
  const sb = getSupabaseServer();
  const { data, count } = await sb
    .from("leads")
    .select("id,company_name,contact_name,rank,job_title,raw_event,priority_score,disposition,phone,mobile_phone,call_owner", { count: "exact" })
    .in("disposition", ["untouched", "no_answer"])
    .order("priority_score", { ascending: false, nullsFirst: false })
    .order("id")
    .range(0, 299);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows: WsQueueRow[] = (data ?? []).map((l: any) => ({
    id: l.id, score: l.priority_score ?? 0, company: l.company_name ?? "", name: l.contact_name ?? "",
    rank: l.rank ?? "", jobTitle: l.job_title ?? "", event: l.raw_event ?? "", disposition: l.disposition ?? "untouched",
    phone: l.phone ?? "", mobilePhone: l.mobile_phone ?? "", callOwner: l.call_owner ?? "",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { rows, total: count ?? 0 };
}

/**
 * 企業ビュー/ファネル/分析: SQL集計RPC(0125)。行を転送しない。
 * 出力形状・可視範囲(RLS同等)はJS実装(leads-workspace.ts)と互換。
 * パリティ検証済み(2026-07-12: owner/external両ロールで全指標一致)。
 */
export async function getLeadsCompanies(): Promise<CompaniesData> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("leads_companies");
  if (error) throw new Error(`企業ビューの集計に失敗: ${error.message}`);
  const j = (data ?? {}) as Partial<CompaniesData>;
  return { rows: j.rows ?? [], total: j.total ?? 0, multi: j.multi ?? 0 };
}
export async function getLeadsFunnel(): Promise<FunnelData> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("leads_funnel");
  if (error) throw new Error(`ファネル集計に失敗: ${error.message}`);
  const j = (data ?? {}) as Partial<FunnelData>;
  return { stages: j.stages ?? {}, total: j.total ?? 0 };
}
export async function getLeadsAnalysis(): Promise<AnalysisData> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("leads_analysis");
  if (error) throw new Error(`リード分析の集計に失敗: ${error.message}`);
  const j = (data ?? {}) as Partial<AnalysisData>;
  return { events: j.events ?? [], scopes: j.scopes ?? {}, rawAcquirers: j.rawAcquirers ?? [] };
}

/** 流入フィルタ用の取込イベント一覧(取込履歴の小テーブルから)。 */
export async function getLeadEvents(): Promise<string[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("lead_import_batches").select("raw_event");
  const set = new Set<string>();
  for (const r of (data ?? []) as { raw_event: string | null }[]) if (r.raw_event) set.add(r.raw_event);
  return [...set];
}

/**
 * 「HP問合せ」タブ用: 問い合わせフォーム由来(/api/lead-intake)の流入元一覧。
 * 取込APIが作成/使用する lead_sources は description に "/api/lead-intake" を含むため、
 * これで判定すると流入元ラベル(資料請求：〇〇・無料相談 等)が増えても自動的に全て拾える。
 */
export async function getWebIntakeSources(): Promise<{ id: string; name: string }[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("lead_sources")
    .select("id,name")
    .ilike("description", "%/api/lead-intake%")
    .order("name");
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }));
}

/** 単票取得。 */
export async function getLead(id: string): Promise<Lead | null> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  return (data as Lead) ?? null;
}

/** 単票のエンゲージメントと接点履歴(リード詳細用)。 */
export async function getPersonEngagement(email?: string | null): Promise<{ rank: string; score: number; touch_count: number; types: string[] } | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  const sb = getSupabaseServer();
  const { data } = await sb.from("person_engagement").select("rank,score,touch_count,types").eq("email", e).maybeSingle();
  return data ? { rank: data.rank ?? "D", score: data.score ?? 0, touch_count: data.touch_count ?? 0, types: data.types ?? [] } : null;
}
export async function getPersonTouchpoints(email?: string | null): Promise<{ type: string; weight: number; occurred_at: string | null; source: string | null; meta: Record<string, unknown> }[]> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return [];
  const sb = getSupabaseServer();
  const { data } = await sb.from("touchpoints").select("type,weight,occurred_at,source,meta").eq("email", e).order("occurred_at", { ascending: false });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data ?? []) as any[]).map((t) => ({ type: t.type, weight: t.weight, occurred_at: t.occurred_at, source: t.source, meta: t.meta ?? {} }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** リード画面で使う小さめの付随データ(取込履歴・取得担当の別名)。 */
export async function getLeadImportBatches(): Promise<LeadImportBatch[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("lead_import_batches").select("*").order("created_at", { ascending: false });
  return (data ?? []) as LeadImportBatch[];
}
export async function getAcquirerAliases(): Promise<AcquirerAlias[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("acquirer_aliases").select("*");
  return (data ?? []) as AcquirerAlias[];
}
export async function getExportPresets(): Promise<LeadExportPreset[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("lead_export_presets").select("*").order("created_at");
  return (data ?? []) as LeadExportPreset[];
}
