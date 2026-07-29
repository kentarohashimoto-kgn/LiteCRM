import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { querySearchAnalytics } from "@/lib/seo/gsc";
import { fetchGa4DailyPages } from "@/lib/seo/ga4";
import { seoGoogleConfigured } from "@/lib/seo/google-sa";
import { buildPageRows, buildQueryRows, buildGa4Aggregates, rollupWeekly, type IngestSite } from "@/lib/seo/ingest";
import { todayJst, addDays, weekStartJst } from "@/lib/seo/site-match";

/**
 * SEO計測データの取込 本体（決定的処理・AIは使わない）。
 *
 * 夜間cron(/api/cron/seo-ingest)と、設定画面の「今すぐ取込を実行」から
 * 同じ処理を呼ぶために切り出している。手動実行できることが重要な理由:
 *  - 接続直後に「本当に取れるか」をその場で確かめられる（翌朝まで待たない）
 *  - 取込が失敗したとき、原因を直して即座に再実行できる
 *
 * 取込ウィンドウ: GSCは2〜3日遅れで確定するため D-3 を主対象とし、
 *   D-3〜D-16 を毎回 upsert し直す（後日確定分の取りこぼしを防ぐ）。
 * 冪等性: 全テーブルが unique 制約を持つ upsert。何度実行しても壊れない。
 */

const BACKFILL_DAYS = 16;
const LAG_DAYS = 3;

interface PropertyRow {
  id: string;
  tenant_id: string;
  name: string;
  gsc_property: string | null;
  ga4_property_id: string | null;
}

interface SiteRow {
  id: string;
  tenant_id: string;
  property_id: string;
  name: string;
  path_prefix: string;
  exclude_prefixes: string[] | null;
  inquiry_media: string | null;
}

export interface IngestResult {
  ok: boolean;
  sites: number;
  summary: Array<Record<string, unknown>>;
  errors: string[];
  window?: { startDate: string; endDate: string };
  skipped?: string;
  note?: string;
  error?: string;
}

/** trigger は batch_runs に記録され、夜間実行と手動実行を区別できる。 */
export async function runSeoIngest(trigger: "cron" | "manual"): Promise<IngestResult> {
  if (!seoGoogleConfigured()) {
    return { ok: false, error: "SEO用サービスアカウントが未設定です。", sites: 0, summary: [], errors: [] };
  }
  const startedAt = new Date().toISOString();
  const admin = getSupabaseAdmin();

  // 停止制御（既存のAIバッチ運用画面と同じ枠組み）
  const { data: jobRows } = await admin
    .from("batch_job_settings")
    .select("tenant_id, enabled")
    .eq("job_kind", "seo_ingest");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) {
    return { ok: true, skipped: "seo_ingest job disabled", sites: 0, summary: [], errors: [] };
  }

  const { data: propsRaw, error: propErr } = await admin
    .from("seo_properties")
    .select("id, tenant_id, name, gsc_property, ga4_property_id")
    .eq("status", "active");
  if (propErr) return { ok: false, error: `プロパティ取得失敗: ${propErr.message}`, sites: 0, summary: [], errors: [] };

  const properties = (propsRaw ?? []).filter((p) => enabledTenants.has(p.tenant_id as string)) as PropertyRow[];
  if (!properties.length) return { ok: true, note: "有効なプロパティなし", sites: 0, summary: [], errors: [] };

  const { data: sitesRaw } = await admin
    .from("seo_sites")
    .select("id, tenant_id, property_id, name, path_prefix, exclude_prefixes, inquiry_media")
    .eq("status", "active");
  const allSites = (sitesRaw ?? []) as SiteRow[];

  const endDate = addDays(todayJst(), -LAG_DAYS);
  const startDate = addDays(endDate, -(BACKFILL_DAYS - 1));

  const summary: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let touchedSites = 0;

  for (const prop of properties) {
    const sites = allSites.filter((s) => s.property_id === prop.id);
    if (!sites.length) continue;

    const matchers: IngestSite[] = sites.map((s) => ({
      id: s.id,
      tenantId: s.tenant_id,
      pathPrefix: s.path_prefix,
      excludePrefixes: s.exclude_prefixes ?? [],
    }));

    // ---- GSC: ページ次元 → サイト日次 + ページ別日次 ----
    let dailyRows: Awaited<ReturnType<typeof buildPageRows>>["daily"] = [];
    let pageRows: Awaited<ReturnType<typeof buildPageRows>>["pages"] = [];
    if (prop.gsc_property) {
      const res = await querySearchAnalytics({
        siteUrl: prop.gsc_property,
        startDate,
        endDate,
        dimensions: ["date", "page"],
        rowLimit: 25000,
      });
      if (!res.ok) {
        errors.push(`${prop.name} GSC(page): ${res.message}`);
      } else {
        const built = buildPageRows(res.rows, matchers);
        dailyRows = built.daily;
        pageRows = built.pages;
        if (pageRows.length) {
          const { error } = await admin.from("seo_page_daily").upsert(pageRows, { onConflict: "site_id,date,page_path" });
          if (error) errors.push(`${prop.name} page_daily保存: ${error.message}`);
        }
      }

      // ---- GSC: クエリ×ページ次元 ----
      const qres = await querySearchAnalytics({
        siteUrl: prop.gsc_property,
        startDate,
        endDate,
        dimensions: ["date", "query", "page"],
        rowLimit: 25000,
      });
      if (!qres.ok) {
        errors.push(`${prop.name} GSC(query): ${qres.message}`);
      } else {
        const queryRows = buildQueryRows(qres.rows, matchers);
        if (queryRows.length) {
          const { error } = await admin
            .from("seo_query_daily")
            .upsert(queryRows, { onConflict: "site_id,date,query,page_path" });
          if (error) errors.push(`${prop.name} query_daily保存: ${error.message}`);
          const weekly = rollupWeekly(queryRows, weekStartJst, (r) => `${r.query}|${r.page_path}`);
          if (weekly.length) {
            const { error: we } = await admin
              .from("seo_query_weekly")
              .upsert(weekly, { onConflict: "site_id,week_start,query,page_path" });
            if (we) errors.push(`${prop.name} query_weekly保存: ${we.message}`);
          }
        }
      }
    }

    // ---- GA4: セッション ----
    const ga4BySiteDate = new Map<string, { sessions: number; engaged: number; sec: number }>();
    if (prop.ga4_property_id) {
      const gres = await fetchGa4DailyPages(prop.ga4_property_id, startDate, endDate, 20000);
      if (!gres.ok) {
        errors.push(`${prop.name} GA4: ${gres.message}`);
      } else {
        for (const a of buildGa4Aggregates(gres.rows, matchers)) {
          ga4BySiteDate.set(`${a.siteId}|${a.date}`, {
            sessions: a.sessions,
            engaged: a.engagedSessions,
            sec: a.engagementSec,
          });
        }
      }
    }

    // ---- CRM: 当該メディアの問合せ・有効リード ----
    const inquiriesBySiteDate = await countInquiries(admin, sites, startDate, endDate);

    // ---- サイト日次を統合して保存 ----
    const merged = dailyRows.map((d) => {
      const key = `${d.site_id}|${d.date}`;
      const g = ga4BySiteDate.get(key);
      const inq = inquiriesBySiteDate.get(key);
      return {
        ...d,
        sessions: g?.sessions ?? 0,
        organic_sessions: g?.sessions ?? 0,
        engaged_sessions: g?.engaged ?? 0,
        avg_engagement_sec: g && g.sessions ? Math.round((g.sec / g.sessions) * 10) / 10 : null,
        inquiries: inq?.total ?? 0,
        leads_valid: inq?.valid ?? 0,
      };
    });
    if (merged.length) {
      const { error } = await admin.from("seo_daily_metrics").upsert(merged, { onConflict: "site_id,date" });
      if (error) errors.push(`${prop.name} daily保存: ${error.message}`);
    }

    // ---- 週次ロールアップ（ページ） ----
    if (pageRows.length) {
      const weekly = rollupWeekly(pageRows, weekStartJst, (r) => r.page_path);
      const { error } = await admin
        .from("seo_page_weekly")
        .upsert(weekly, { onConflict: "site_id,week_start,page_path" });
      if (error) errors.push(`${prop.name} page_weekly保存: ${error.message}`);
    }

    touchedSites += sites.length;
    summary.push({ property: prop.name, sites: sites.length, daily: merged.length, pages: pageRows.length });

    await admin.from("seo_sites").update({ last_ingested_date: endDate }).in("id", sites.map((s) => s.id));
  }

  // ---- 保持ポリシー（日次のパージ。週次は残す） ----
  const purgeBefore = { page: addDays(todayJst(), -180), query: addDays(todayJst(), -90) };
  await admin.from("seo_page_daily").delete().lt("date", purgeBefore.page);
  await admin.from("seo_query_daily").delete().lt("date", purgeBefore.query);

  // ---- 実行ログ（既存のバッチ運用画面にそのまま出る） ----
  const tenantIds = [...new Set(properties.map((p) => p.tenant_id))];
  for (const tenantId of tenantIds) {
    await admin.from("batch_runs").insert({
      tenant_id: tenantId,
      job_kind: "seo_ingest",
      run_date: todayJst(),
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status: errors.length ? "partial" : "success",
      targets_total: touchedSites,
      items_generated: summary.reduce((n, s) => n + Number(s.daily ?? 0), 0),
      items_failed: errors.length,
      detail: { trigger, window: { startDate, endDate }, summary, errors: errors.slice(0, 20) },
    });
  }

  return {
    ok: errors.length === 0,
    window: { startDate, endDate },
    sites: touchedSites,
    summary,
    errors: errors.slice(0, 20),
  };
}

/**
 * 当該サイトの問合せ件数（CRMのリード）を日別に数える。
 * 突合キーは leads.inquiry_media（HPフォームが送る media 値）。
 * 「有効」= 対象外(disqualified)に落とされていないリード。
 */
async function countInquiries(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sites: SiteRow[],
  startDate: string,
  endDate: string,
): Promise<Map<string, { total: number; valid: number }>> {
  const out = new Map<string, { total: number; valid: number }>();
  const medias = sites.filter((s) => s.inquiry_media).map((s) => s.inquiry_media as string);
  if (!medias.length) return out;

  const { data } = await admin
    .from("leads")
    .select("inquiry_media, funnel_stage, created_at")
    .in("inquiry_media", medias)
    .gte("created_at", `${startDate}T00:00:00+09:00`)
    .lte("created_at", `${endDate}T23:59:59+09:00`);

  for (const row of data ?? []) {
    const site = sites.find((s) => s.inquiry_media === row.inquiry_media);
    if (!site) continue;
    // JSTの暦日に寄せる
    const date = new Date(new Date(row.created_at as string).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const key = `${site.id}|${date}`;
    const cur = out.get(key) ?? { total: 0, valid: 0 };
    cur.total += 1;
    if (row.funnel_stage !== "disqualified") cur.valid += 1;
    out.set(key, cur);
  }
  return out;
}
