import { normalizePath, matchSiteByPath, weightedPosition, ctrOf, type SiteMatcher } from "./site-match";

/**
 * GSC/GA4 の生データを、サイト単位・日単位の保存形に組み立てる（純関数・テスト対象）。
 *
 * 設計上の要点:
 *  - 1つのGSCプロパティ(catorce.jp)の行を、path_prefix で複数サイト(本体 / career)に振り分ける。
 *  - 保存件数に上限を設ける（日次テーブルの肥大を防ぐ。設計書 §13 データ量試算）。
 *  - 平均順位は必ず表示回数の加重平均（単純平均は誤り）。
 *
 * API呼び出しは含めない（server-onlyにせずテスト可能に保つため）。取得は cron 側の責務。
 */

export const PAGE_ROWS_PER_DAY = 300;
export const QUERY_ROWS_PER_DAY = 500;

/** GSC searchAnalytics の1行（keys の並びはリクエストの dimensions 順）。 */
export interface GscRowLike {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** GA4 の1行。 */
export interface Ga4RowLike {
  date: string;
  pagePath: string;
  sessions: number;
  engagedSessions: number;
  userEngagementSec: number;
}

export interface IngestSite extends SiteMatcher {
  tenantId: string;
}

export interface DailyMetricRow {
  tenant_id: string;
  site_id: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  position: number | null;
}

export interface PageDailyRow extends DailyMetricRow {
  page_path: string;
}

export interface QueryDailyRow extends DailyMetricRow {
  query: string;
  page_path: string;
}

interface Bucket {
  clicks: number;
  impressions: number;
  posRows: Array<{ position: number; impressions: number }>;
}

const newBucket = (): Bucket => ({ clicks: 0, impressions: 0, posRows: [] });

function addToBucket(b: Bucket, row: GscRowLike) {
  b.clicks += row.clicks ?? 0;
  b.impressions += row.impressions ?? 0;
  b.posRows.push({ position: row.position ?? 0, impressions: row.impressions ?? 0 });
}

function finish(b: Bucket) {
  return {
    clicks: b.clicks,
    impressions: b.impressions,
    ctr: ctrOf(b.clicks, b.impressions),
    position: weightedPosition(b.posRows),
  };
}

/** 日ごとに表示回数上位N件だけ残す（それ以外は捨てる。週次ロールアップには影響しない）。 */
function topNPerDay<T extends { site_id: string; date: string; impressions: number }>(rows: T[], n: number): T[] {
  const byDate = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.site_id}|${r.date}`;
    const arr = byDate.get(key) ?? [];
    arr.push(r);
    byDate.set(key, arr);
  }
  const out: T[] = [];
  for (const arr of byDate.values()) {
    arr.sort((a, b) => b.impressions - a.impressions);
    out.push(...arr.slice(0, n));
  }
  return out;
}

/**
 * GSCの (date, page) 行 → サイト別の日次サマリー + ページ別日次。
 * サイト日次の平均順位は、そのサイトに属する全ページ行の加重平均で求める。
 */
export function buildPageRows(
  rows: GscRowLike[],
  sites: IngestSite[],
): { daily: DailyMetricRow[]; pages: PageDailyRow[] } {
  const dailyMap = new Map<string, DailyMetricRow>();
  const posBySiteDate = new Map<string, Array<{ position: number; impressions: number }>>();
  const perPage = new Map<string, { siteId: string; tenantId: string; date: string; path: string; b: Bucket }>();

  for (const row of rows) {
    const [date, rawPage] = row.keys;
    if (!date || !rawPage) continue;
    const path = normalizePath(rawPage);
    const site = matchSiteByPath(path, sites);
    if (!site) continue;

    const dKey = `${site.id}|${date}`;
    let d = dailyMap.get(dKey);
    if (!d) {
      d = { tenant_id: site.tenantId, site_id: site.id, date, impressions: 0, clicks: 0, ctr: null, position: null };
      dailyMap.set(dKey, d);
    }
    d.clicks += row.clicks ?? 0;
    d.impressions += row.impressions ?? 0;

    const posArr = posBySiteDate.get(dKey) ?? [];
    posArr.push({ position: row.position ?? 0, impressions: row.impressions ?? 0 });
    posBySiteDate.set(dKey, posArr);

    const pKey = `${dKey}|${path}`;
    let p = perPage.get(pKey);
    if (!p) {
      p = { siteId: site.id, tenantId: site.tenantId, date, path, b: newBucket() };
      perPage.set(pKey, p);
    }
    addToBucket(p.b, row);
  }

  for (const [key, d] of dailyMap) {
    d.ctr = ctrOf(d.clicks, d.impressions);
    d.position = weightedPosition(posBySiteDate.get(key) ?? []);
  }

  const pages: PageDailyRow[] = [...perPage.values()].map((p) => ({
    tenant_id: p.tenantId,
    site_id: p.siteId,
    date: p.date,
    page_path: p.path,
    ...finish(p.b),
  }));

  return { daily: [...dailyMap.values()], pages: topNPerDay(pages, PAGE_ROWS_PER_DAY) };
}

/** GSCの (date, query, page) 行 → クエリ別日次。 */
export function buildQueryRows(rows: GscRowLike[], sites: IngestSite[]): QueryDailyRow[] {
  const map = new Map<
    string,
    { siteId: string; tenantId: string; date: string; query: string; path: string; b: Bucket }
  >();

  for (const row of rows) {
    const [date, query, rawPage] = row.keys;
    if (!date || !query) continue;
    const path = normalizePath(rawPage ?? "/");
    const site = matchSiteByPath(path, sites);
    if (!site) continue;

    const key = `${site.id}|${date}|${query}|${path}`;
    let m = map.get(key);
    if (!m) {
      m = { siteId: site.id, tenantId: site.tenantId, date, query, path, b: newBucket() };
      map.set(key, m);
    }
    addToBucket(m.b, row);
  }

  const rowsOut: QueryDailyRow[] = [...map.values()].map((m) => ({
    tenant_id: m.tenantId,
    site_id: m.siteId,
    date: m.date,
    query: m.query,
    page_path: m.path,
    ...finish(m.b),
  }));
  return topNPerDay(rowsOut, QUERY_ROWS_PER_DAY);
}

export interface Ga4Aggregate {
  siteId: string;
  date: string;
  sessions: number;
  engagedSessions: number;
  engagementSec: number;
}

/** GA4の (date, pagePath) 行 → サイト×日のセッション集計。 */
export function buildGa4Aggregates(rows: Ga4RowLike[], sites: IngestSite[]): Ga4Aggregate[] {
  const map = new Map<string, Ga4Aggregate>();
  for (const r of rows) {
    const path = normalizePath(r.pagePath);
    const site = matchSiteByPath(path, sites);
    if (!site) continue;
    const key = `${site.id}|${r.date}`;
    const cur =
      map.get(key) ?? { siteId: site.id, date: r.date, sessions: 0, engagedSessions: 0, engagementSec: 0 };
    cur.sessions += r.sessions;
    cur.engagedSessions += r.engagedSessions;
    cur.engagementSec += r.userEngagementSec;
    map.set(key, cur);
  }
  return [...map.values()];
}

/** 日次のページ/クエリ行を週次ロールアップに畳む。 */
export function rollupWeekly<T extends PageDailyRow | QueryDailyRow>(
  rows: T[],
  weekStartOf: (date: string) => string,
  keyOf: (row: T) => string,
): Array<Omit<T, "date"> & { week_start: string }> {
  const map = new Map<string, { base: T; week: string; b: Bucket }>();
  for (const r of rows) {
    const week = weekStartOf(r.date);
    const key = `${r.site_id}|${week}|${keyOf(r)}`;
    let m = map.get(key);
    if (!m) {
      m = { base: r, week, b: newBucket() };
      map.set(key, m);
    }
    m.b.clicks += r.clicks;
    m.b.impressions += r.impressions;
    m.b.posRows.push({ position: r.position ?? 0, impressions: r.impressions });
  }
  return [...map.values()].map(({ base, week, b }) => {
    const { date: _date, ...rest } = base;
    return { ...(rest as Omit<T, "date">), week_start: week, ...finish(b) };
  });
}
