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
  opportunities: number;
  won: number;
  revenue: number;
  cvr: number | null;
  leadToOpp: number | null;
  winRate: number | null;
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

/**
 * 直近N日のファネル実測。集計はDBのRPC(seo_funnel_summary)で確定させ、
 * 画面側では再計算しない（同じ数字が画面ごとに違う、を防ぐ）。
 */
export async function getSeoFunnel(siteId: string, days = 30): Promise<SeoFunnel> {
  const sb = getSupabaseServer();
  const to = todayJst();
  const from = addDays(to, -(days - 1));
  const { data } = await sb.rpc("seo_funnel_summary", { p_site: siteId, p_from: from, p_to: to });
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const n = (v: unknown) => Number(v ?? 0);
  const nOrNull = (v: unknown) => (v == null ? null : Number(v));
  return {
    impressions: n(r?.impressions),
    clicks: n(r?.clicks),
    ctr: nOrNull(r?.ctr),
    position: nOrNull(r?.avg_position),
    sessions: n(r?.sessions),
    inquiries: n(r?.inquiries),
    leadsValid: n(r?.leads_valid),
    opportunities: n(r?.opportunities),
    won: n(r?.won),
    revenue: n(r?.revenue),
    cvr: nOrNull(r?.cvr),
    leadToOpp: nOrNull(r?.lead_to_opp),
    winRate: nOrNull(r?.win_rate),
    days,
  };
}

/**
 * アトリビューション健全性。
 * 「集客の成果を売上として証明できる状態か」を示す。紐付け率が低いままだと、
 * SEOがどれだけ成功しても受注金額が¥0に見えてしまう。
 */
export interface AttributionHealth {
  opportunitiesTotal: number;
  opportunitiesLinked: number;
  linkRate: number | null;
  inquiryLeadsTotal: number;
  inquiryLeadsWithLanding: number;
  landingRate: number | null;
  unlinkedRecent: number;
}

export async function getAttributionHealth(tenantId: string, days = 90): Promise<AttributionHealth | null> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("seo_attribution_health", { p_tenant: tenantId, p_days: days });
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r) return null;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    opportunitiesTotal: n(r.opportunities_total),
    opportunitiesLinked: n(r.opportunities_linked),
    linkRate: r.link_rate == null ? null : Number(r.link_rate),
    inquiryLeadsTotal: n(r.inquiry_leads_total),
    inquiryLeadsWithLanding: n(r.inquiry_leads_with_landing),
    landingRate: r.landing_rate == null ? null : Number(r.landing_rate),
    unlinkedRecent: n(r.unlinked_recent),
  };
}

/** ページ別の売上貢献（「どの記事が稼いだか」）。 */
export interface SeoPageRevenue {
  pagePath: string;
  clicks: number;
  inquiries: number;
  leadsValid: number;
  opportunities: number;
  won: number;
  revenue: number;
}

export async function getSeoPageRevenue(siteId: string, days = 30, limit = 10): Promise<SeoPageRevenue[]> {
  const sb = getSupabaseServer();
  const to = todayJst();
  const from = addDays(to, -(days - 1));
  const { data } = await sb.rpc("seo_page_revenue", { p_site: siteId, p_from: from, p_to: to });
  return ((data ?? []) as Record<string, unknown>[]).slice(0, limit).map((r) => ({
    pagePath: String(r.page_path ?? "/"),
    clicks: Number(r.clicks ?? 0),
    inquiries: Number(r.inquiries ?? 0),
    leadsValid: Number(r.leads_valid ?? 0),
    opportunities: Number(r.opportunities ?? 0),
    won: Number(r.won ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));
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
