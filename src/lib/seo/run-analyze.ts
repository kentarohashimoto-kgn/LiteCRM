import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { detectInsights, intentMix, intentMixInsight, type QueryAgg } from "@/lib/seo/analyze";
import { todayJst, addDays, weightedPosition } from "@/lib/seo/site-match";

/**
 * 機会・劣化の検出を実行し seo_insights に保存する（決定的処理・AIは使わない）。
 *
 * 直近28日 と その前28日 を比較して、機会（CTR・あと一歩）と
 * 劣化（順位低下・クリック減）を毎日同じ基準で洗い出す。
 * 取込(run-ingest)の直後に走らせる想定。冪等（同日同検出は上書き）。
 */

const WINDOW_DAYS = 28;
const MAX_PER_SITE = 40;

interface SiteRow {
  id: string;
  tenant_id: string;
  name: string;
  base_url: string;
}

export interface AnalyzeRunResult {
  ok: boolean;
  sites: number;
  insights: number;
  errors: string[];
}

/** サイト名・ドメインから指名検索の判定語を作る（例: カトルセHP（法人） → カトルセ / catorce）。 */
export function brandTermsFor(site: { name: string; base_url: string }): string[] {
  const terms = new Set<string>();
  const name = site.name.replace(/[（(].*?[)）]/g, "").replace(/HP|サイト/gi, "").trim();
  if (name) terms.add(name);
  try {
    const host = new URL(site.base_url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    if (label) terms.add(label);
  } catch {
    /* base_url が不正でも検出は続行する */
  }
  return [...terms];
}

/** 期間内のクエリ行を (query, page) 単位に畳む。順位は表示回数の加重平均。 */
async function loadQueryAggs(
  admin: ReturnType<typeof getSupabaseAdmin>,
  siteId: string,
  from: string,
  to: string,
): Promise<QueryAgg[]> {
  const { data } = await admin
    .from("seo_query_daily")
    .select("query, page_path, impressions, clicks, position")
    .eq("site_id", siteId)
    .gte("date", from)
    .lte("date", to);

  const map = new Map<string, { agg: QueryAgg; posRows: Array<{ position: number; impressions: number }> }>();
  for (const r of data ?? []) {
    const key = `${r.query}|${r.page_path ?? ""}`;
    const cur =
      map.get(key) ??
      { agg: { query: r.query as string, pagePath: (r.page_path as string) ?? "", impressions: 0, clicks: 0, position: null }, posRows: [] };
    const imp = Number(r.impressions ?? 0);
    cur.agg.impressions += imp;
    cur.agg.clicks += Number(r.clicks ?? 0);
    if (r.position != null && imp > 0) cur.posRows.push({ position: Number(r.position), impressions: imp });
    map.set(key, cur);
  }
  return [...map.values()].map((v) => ({ ...v.agg, position: weightedPosition(v.posRows) }));
}

export async function runSeoAnalysis(): Promise<AnalyzeRunResult> {
  const admin = getSupabaseAdmin();
  const errors: string[] = [];
  let insightCount = 0;

  const { data: jobRows } = await admin
    .from("batch_job_settings")
    .select("tenant_id, enabled")
    .eq("job_kind", "seo_ingest");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));

  const { data: sitesRaw } = await admin
    .from("seo_sites")
    .select("id, tenant_id, name, base_url")
    .eq("status", "active");
  const sites = ((sitesRaw ?? []) as SiteRow[]).filter((s) => enabledTenants.has(s.tenant_id));
  if (!sites.length) return { ok: true, sites: 0, insights: 0, errors: [] };

  const runDate = todayJst();
  // GSCの確定遅延を考慮し、D-3 を直近期間の終端にする
  const curTo = addDays(runDate, -3);
  const curFrom = addDays(curTo, -(WINDOW_DAYS - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(WINDOW_DAYS - 1));

  for (const site of sites) {
    try {
      const [current, previous] = await Promise.all([
        loadQueryAggs(admin, site.id, curFrom, curTo),
        loadQueryAggs(admin, site.id, prevFrom, prevTo),
      ]);
      if (!current.length) continue;

      const brandTerms = brandTermsFor(site);
      const found = detectInsights(current, previous.length ? previous : null, {
        brandTerms,
        limit: MAX_PER_SITE,
      });
      const mixInsight = intentMixInsight(intentMix(current, brandTerms));
      const all = mixInsight ? [mixInsight, ...found] : found;
      if (!all.length) continue;

      const rows = all.map((i) => ({
        tenant_id: site.tenant_id,
        site_id: site.id,
        run_date: runDate,
        kind: i.kind,
        scope: i.scope,
        query: i.query ?? "",
        page_path: i.pagePath ?? "",
        title: i.title,
        severity: i.severity,
        metric_json: i.metric,
        opportunity_score: i.opportunityScore,
        action_type: i.actionType,
        status: "open",
      }));
      const { error } = await admin
        .from("seo_insights")
        .upsert(rows, { onConflict: "site_id,run_date,kind,query,page_path" });
      if (error) errors.push(`${site.name}: ${error.message}`);
      else insightCount += rows.length;
    } catch (e) {
      errors.push(`${site.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 解決済み・古い所見の掃除（画面が過去の所見で埋まらないようにする）
  await admin.from("seo_insights").delete().lt("run_date", addDays(runDate, -180));

  return { ok: errors.length === 0, sites: sites.length, insights: insightCount, errors };
}
