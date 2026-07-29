import { normalizePath } from "./site-match";

/**
 * 問合せの流入経路判定（純関数・テスト対象）。
 *
 * 「SEOが売上をいくら生んだか」を言うには、まず1件ずつの問合せが
 * 検索由来なのか広告・メール・直接なのかを決定的に分類する必要がある。
 * ここが曖昧だと、後続のROI計算がすべて信用できなくなる。
 *
 * 判定は utm パラメータ > 広告クリックID > リファラ の優先順。
 * utm は送信側が明示した意図なので最も信頼でき、リファラは推測でしかない。
 */

export type AcquisitionType = "organic" | "paid" | "direct" | "referral" | "email" | "social" | "unknown";

export interface AttributionInput {
  landingPage?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  gclid?: string | null;
}

/** 主要な検索エンジンのホスト（部分一致で判定）。 */
const SEARCH_HOSTS = ["google.", "yahoo.co.jp", "bing.com", "duckduckgo.com", "baidu.com", "naver."];
/** SNS（検索とは分けて数える。SEO成果に混ぜない）。 */
const SOCIAL_HOSTS = ["x.com", "twitter.com", "facebook.com", "instagram.com", "linkedin.com", "t.co", "youtube.com"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 流入経路を判定する。
 * 広告クリックID(gclid)があれば、リファラが検索エンジンでも必ず paid（誤って
 * SEOの成果に計上しないため）。
 */
export function classifyAcquisition(input: AttributionInput): AcquisitionType {
  const medium = (input.utmMedium ?? "").trim().toLowerCase();
  const source = (input.utmSource ?? "").trim().toLowerCase();

  // 広告は最優先で除外する。SEOの成果に広告流入が混ざると判断を誤る。
  if ((input.gclid ?? "").trim()) return "paid";
  if (["cpc", "ppc", "paid", "paidsearch", "display", "cpm", "retargeting"].includes(medium)) return "paid";

  if (["email", "e-mail", "mail", "newsletter"].includes(medium)) return "email";
  if (medium === "organic") return "organic";
  if (["social", "social-network", "sns"].includes(medium)) return "social";
  if (medium === "referral") return "referral";
  if (source && !medium) {
    // medium が無くても source から判別できることがある
    if (SEARCH_HOSTS.some((h) => source.includes(h.replace(".", "")))) return "organic";
    if (SOCIAL_HOSTS.some((h) => source.includes(h.split(".")[0]))) return "social";
  }

  const ref = (input.referrer ?? "").trim();
  if (!ref) return "direct";
  const host = hostOf(ref);
  if (!host) return "unknown";
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return "organic";
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return "social";
  return "referral";
}

/** SEO（自然検索）の成果として数えてよい流入か。 */
export function isOrganic(type: AcquisitionType): boolean {
  return type === "organic";
}

export interface NormalizedAttribution {
  landingPage: string | null;
  entryReferrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  gclid: string | null;
  acquisitionType: AcquisitionType;
}

const cut = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/**
 * フォームから送られた生の値を、保存できる形に正規化する。
 * 着地ページはクエリを落としたパスにする（?utm_source= 違いで
 * 同じページが別ページとして集計されるのを防ぐ）。
 */
export function normalizeAttribution(body: Record<string, unknown>): NormalizedAttribution {
  const rawLanding = cut(body.landing_page ?? body.landingPage ?? body.page_url ?? body.pageUrl, 500);
  const referrer = cut(body.referrer ?? body.entry_referrer, 500);
  const utmSource = cut(body.utm_source ?? body.utmSource, 100);
  const utmMedium = cut(body.utm_medium ?? body.utmMedium, 100);
  const gclid = cut(body.gclid, 200);

  return {
    landingPage: rawLanding ? normalizePath(rawLanding) : null,
    entryReferrer: referrer,
    utmSource,
    utmMedium,
    utmCampaign: cut(body.utm_campaign ?? body.utmCampaign, 200),
    utmTerm: cut(body.utm_term ?? body.utmTerm, 200),
    utmContent: cut(body.utm_content ?? body.utmContent, 200),
    gclid,
    acquisitionType: classifyAcquisition({
      landingPage: rawLanding,
      referrer,
      utmSource,
      utmMedium,
      gclid,
    }),
  };
}
