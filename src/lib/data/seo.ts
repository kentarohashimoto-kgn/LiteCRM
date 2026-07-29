import { getSupabaseServer } from "@/lib/supabase/server";
import { todayJst, addDays } from "@/lib/seo/site-match";

/**
 * SEO画面の参照ヘルパー（RLS適用済みクライアントを使う）。
 * 集計はDB側で確定済みの seo_daily_metrics を読むだけにし、画面で再計算しない。
 */

export interface SeoSiteSummary {
  id: string;
  name: string;
  baseUrl: string;
  audience: string;
  status: string;
  inquiryMedia: string | null;
  propertyName: string;
  gscStatus: string;
  ga4Status: string;
}

export interface SeoFunnel {
  impressions: number;
  clicks: number;
  ctr: number | null;
  position: number | null;
  sessions: number;
  inquiries: number;
  leadsValid: number;
  days: number;
}

export async function listSeoSites(): Promise<SeoSiteSummary[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("seo_sites")
    .select(
      "id, name, base_url, audience, status, inquiry_media, seo_properties(name, gsc_status, ga4_status)",
    )
    .order("is_primary", { ascending: false })
    .order("created_at");

  return (data ?? []).map((r) => {
    const prop = (r as { seo_properties?: { name?: string; gsc_status?: string; ga4_status?: string } })
      .seo_properties;
    return {
      id: r.id as string,
      name: r.name as string,
      baseUrl: r.base_url as string,
      audience: (r.audience as string) ?? "b2b",
      status: (r.status as string) ?? "active",
      inquiryMedia: (r.inquiry_media as string) ?? null,
      propertyName: prop?.name ?? "—",
      gscStatus: prop?.gsc_status ?? "unknown",
      ga4Status: prop?.ga4_status ?? "unknown",
    };
  });
}

/** 直近N日のファネル実測（データが無ければ全て0で返す）。 */
export async function getSeoFunnel(siteId: string, days = 30): Promise<SeoFunnel> {
  const sb = getSupabaseServer();
  const to = todayJst();
  const from = addDays(to, -(days - 1));
  const { data } = await sb
    .from("seo_daily_metrics")
    .select("impressions, clicks, position, sessions, inquiries, leads_valid")
    .eq("site_id", siteId)
    .gte("date", from)
    .lte("date", to);

  const rows = data ?? [];
  const impressions = rows.reduce((n, r) => n + Number(r.impressions ?? 0), 0);
  const clicks = rows.reduce((n, r) => n + Number(r.clicks ?? 0), 0);
  // 平均順位は表示回数を重みにした加重平均（単純平均にしない）
  let posNum = 0;
  let posDen = 0;
  for (const r of rows) {
    const p = r.position == null ? null : Number(r.position);
    const imp = Number(r.impressions ?? 0);
    if (p != null && imp > 0) {
      posNum += p * imp;
      posDen += imp;
    }
  }
  return {
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : null,
    position: posDen ? Math.round((posNum / posDen) * 100) / 100 : null,
    sessions: rows.reduce((n, r) => n + Number(r.sessions ?? 0), 0),
    inquiries: rows.reduce((n, r) => n + Number(r.inquiries ?? 0), 0),
    leadsValid: rows.reduce((n, r) => n + Number(r.leads_valid ?? 0), 0),
    days,
  };
}

/**
 * CRM実績から、期待値換算に使うレートを求める（直近365日の受注実績）。
 * 平均ではなく中央値を使う — 少数の大型案件に引きずられると、
 * SEO施策の期待売上が過大に見積もられ、優先順位を誤るため。
 */
export interface CrmRates {
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  medianDealAmount: number | null;
}

export async function getCrmRates(): Promise<CrmRates> {
  const sb = getSupabaseServer();
  const since = addDays(todayJst(), -365);
  const { data } = await sb
    .from("opportunities")
    .select("stage, amount, updated_at")
    .in("stage", ["won", "lost"])
    .gte("updated_at", `${since}T00:00:00+09:00`);

  const rows = data ?? [];
  const won = rows.filter((r) => r.stage === "won");
  const lost = rows.filter((r) => r.stage === "lost");
  const amounts = won
    .map((r) => Number(r.amount ?? 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const median = amounts.length
    ? amounts.length % 2
      ? amounts[(amounts.length - 1) / 2]
      : Math.round((amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2)
    : null;

  return {
    wonCount: won.length,
    lostCount: lost.length,
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    medianDealAmount: median,
  };
}
