/**
 * URLの正規化と「どのサイト（計測単位）に属するか」の判定。純関数のみ（テスト対象）。
 *
 * catorce.jp は 1ドメインの中に性質の違う2サイトが同居している:
 *   /         … 法人向け（AI研修・AI顧問）  = B2B
 *   /career/  … 個人向け（フリーランス案件）= B2C
 * 検索意図もKPIも別物なので、GSC/GA4から降ってきた行を必ずどちらかに振り分ける。
 * この振り分けを誤ると、全ての集計・提案・効果検証が汚染される。
 */

export interface SiteMatcher {
  id: string;
  pathPrefix: string;
  excludePrefixes: string[];
}

/**
 * URLまたはパスを、比較可能なパスに正規化する。
 *  - 絶対URL → パス部分のみ
 *  - クエリ・フラグメントを除去（?utm_source= 等で行が分裂するのを防ぐ）
 *  - 先頭スラッシュを保証
 *  - 末尾の index.html を除去
 *  - 大文字小文字はパスでは区別されうるため保持する
 * 解釈できない入力は '/' を返す（取込を止めないため）。
 */
export function normalizePath(input: string): string {
  if (!input) return "/";
  let path = input.trim();

  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  } else {
    // 相対パスでもクエリ・フラグメントは落とす
    path = path.split("#")[0].split("?")[0];
  }
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/index\.html?$/i, "/");
  // 連続スラッシュを畳む
  path = path.replace(/\/{2,}/g, "/");
  return path;
}

/** パスが接頭辞に属するか。'/career/' は '/career' 自体にもマッチさせる。 */
export function pathHasPrefix(path: string, prefix: string): boolean {
  if (prefix === "/" || prefix === "") return true;
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path === p || path === p.slice(0, -1) || path.startsWith(p);
}

/**
 * パスが属するサイトを1つ選ぶ。
 *  1. exclude_prefixes に当たるサイトは候補から外す
 *  2. 残った候補のうち path_prefix が最も長いものを採用（/career/ が / に勝つ）
 * どれにも属さなければ null（取込側で捨てる）。
 */
export function matchSiteByPath<T extends SiteMatcher>(path: string, sites: T[]): T | null {
  let best: T | null = null;
  for (const site of sites) {
    if (!pathHasPrefix(path, site.pathPrefix)) continue;
    if (site.excludePrefixes.some((ex) => pathHasPrefix(path, ex))) continue;
    if (!best || site.pathPrefix.length > best.pathPrefix.length) best = site;
  }
  return best;
}

/**
 * 平均掲載順位の集計。
 * 単純平均は誤り — 表示回数1回のクエリと1万回のクエリが同じ重みになってしまう。
 * 必ず表示回数を重みにした加重平均を使う。
 */
export function weightedPosition(rows: Array<{ position: number; impressions: number }>): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.position) || !Number.isFinite(r.impressions) || r.impressions <= 0) continue;
    num += r.position * r.impressions;
    den += r.impressions;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

/** CTR。表示回数0のときは null（0%と0件を区別する）。 */
export function ctrOf(clicks: number, impressions: number): number | null {
  if (!impressions) return null;
  return Math.round((clicks / impressions) * 10000) / 10000;
}

/**
 * その日が属する週の月曜日を YYYY-MM-DD で返す。週次ロールアップのキー。
 * 引数は既にJSTの暦日（todayJst / GSCの返す日付）なので、
 * タイムゾーン変換をせずUTC暦日として素直に扱う（+09:00で解釈すると曜日が1日ずれる）。
 */
export function weekStartJst(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 月曜=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** JSTの今日。 */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日付をN日ずらす（YYYY-MM-DD）。 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
