/**
 * リード専用のデータアクセス。
 * リードは件数が大きく(数千〜万件)、全画面で全件をメモリに載せるのは非効率なため、
 * グローバルな workspace スナップショットから切り離し、ここで必要な形だけ取得する。
 *  - getLeadMetrics: ダッシュボード/予測/目標/レビュー等が使う「集計値」(行は返さない)
 *  - getAllLeads:    リード画面専用の全件取得(この画面でのみ materialize)
 *  - getLead:        単票取得
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { monthKey, startOfMonth } from "@/lib/utils";
import type { OppView } from "@/lib/data/select";
import type { Lead } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function paginate<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface LeadMetrics {
  total: number;
  byMonth: Map<string, number>; // acquired_at 月 -> 件数
  apptByMonth: Map<string, number>; // 決着=アポ獲得 を獲得月で
  wonByMonth: Map<string, number>; // リード起点の受注 を獲得月で
  bySource: Map<string, number>; // lead_source_id -> 件数
}

interface NarrowLead {
  id: string;
  acquired_at: string | null;
  disposition: string | null;
  lead_source_id: string | null;
}

/**
 * 集計に必要な最小列だけを取得して集計する(行はクライアントに渡らない)。
 * 受注(won)判定は呼び出し側が持つ opportunities(lead_id 紐付き)から導出。
 */
export async function getLeadMetrics(opps: OppView[]): Promise<LeadMetrics> {
  const sb = getSupabaseServer();
  const rows = await paginate<NarrowLead>((from, to) =>
    sb.from("leads").select("id,acquired_at,disposition,lead_source_id").order("id").range(from, to),
  );
  const wonLeadIds = new Set(opps.filter((o) => o.lead_id && o.status === "won").map((o) => o.lead_id));

  const byMonth = new Map<string, number>();
  const apptByMonth = new Map<string, number>();
  const wonByMonth = new Map<string, number>();
  const bySource = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };

  for (const r of rows) {
    const mk = r.acquired_at ? monthKey(startOfMonth(new Date(r.acquired_at))) : null;
    inc(byMonth, mk);
    if (r.disposition === "appointment") inc(apptByMonth, mk);
    if (wonLeadIds.has(r.id)) inc(wonByMonth, mk);
    if (r.lead_source_id) inc(bySource, r.lead_source_id);
  }
  return { total: rows.length, byMonth, apptByMonth, wonByMonth, bySource };
}

/** リード画面専用: 全件取得(獲得日の新しい順)。この画面でのみ全件を materialize する。 */
export async function getAllLeads(): Promise<Lead[]> {
  const sb = getSupabaseServer();
  return paginate<Lead>((from, to) =>
    sb.from("leads").select("*").order("acquired_at", { ascending: false }).order("id").range(from, to),
  );
}

/** 単票取得。 */
export async function getLead(id: string): Promise<Lead | null> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  return (data as Lead) ?? null;
}
