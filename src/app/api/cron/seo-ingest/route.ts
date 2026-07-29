import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { querySearchAnalytics } from "@/lib/seo/gsc";
import { fetchGa4DailyPages } from "@/lib/seo/ga4";
import { seoGoogleConfigured } from "@/lib/seo/google-sa";
import {
  buildPageRows,
  buildQueryRows,
  buildGa4Aggregates,
  rollupWeekly,
  type IngestSite,
} from "@/lib/seo/ingest";
import { todayJst, addDays, weekStartJst } from "@/lib/seo/site-match";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WO-30: SEO計測基盤の日次取込（F-301 / 決定的処理）。
 *
 * Search Console と GA4 から実測値を取り込み、サイト単位・日単位で確定させる。
 * AIは一切使わない — 数値がブレるとPDCAの継続性が壊れるため、集計は必ずここで確定する。
 *
 * 取込ウィンドウ: GSCは2〜3日遅れで確定するため D-3 を主対象とし、
 *   D-3〜D-16 を毎日 upsert し直す（後日確定分の取りこぼしを防ぐ）。
 * サイト振り分け: 1つのGSCプロパティ(catorce.jp)を path_prefix で
 *   本体(B2B) / career(B2C) に分割する（検索意図もKPIも別物のため）。
 *
 * 認可: Authorization: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='seo_ingest')。
 * 冪等性: 全てのテーブルが unique 制約を持つ upsert。同日に何度実行しても壊れない。
 */

const BACKFILL_DAYS = 16; // D-3 から遡って再取得する日数
const LAG_DAYS = 3; // GSCの確定遅延

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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!seoGoogleConfigured()) {
    return NextResponse.json({ ok: false, error: "SEO用サービスアカウントが未設定です。" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();

  // 停止制御（既存のAIバッチ運用画面と同じ枠組み）
  const { data: jobRows } = await admin
    .from("batch_job_settings")
    .select("tenant_id, enabled")
    .eq("job_kind", "seo_ingest");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) {
    return NextResponse.json({ ok: true, skipped: "seo_ingest job disabled", sites: 0 });
  }

  const { data: propsRaw, error: propErr } = await admin
    .from("seo_properties")
    .select("id, tenant_id, name, gsc_property, ga4_property_id")
    .eq("status", "active");
  if (propErr) return NextResponse.json({ ok: false, error: `プロパティ取得失敗: ${propErr.message}` }, { status: 500 });

  const properties = (propsRaw ?? []).filter((p) => enabledTenants.has(p.tenant_id as string)) as PropertyRow[];
  if (!properties.length) return NextResponse.json({ ok: true, note: "有効なプロパティなし", sites: 0 });

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
      detail: { window: { startDate, endDate }, summary, errors: errors.slice(0, 20) },
    });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    window: { startDate, endDate },
    sites: touchedSites,
    summary,
    errors: errors.slice(0, 20),
  });
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
