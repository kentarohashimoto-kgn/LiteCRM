import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * ターゲットKW台帳と順位トラッキングの参照（F-307）。
 *
 * 「狙った語が何位取れているか」を見るための入口。
 * これが無いと、Search Consoleに出てきた語を磨くだけの対処療法になる。
 * 背景: docs/SEO_STRATEGY_V2_KEYWORD_DRIVEN_2026-07.md
 */

export type GapStatus = "no_page" | "out" | "far" | "striking" | "top10";

export interface KeywordRanking {
  keywordId: string;
  query: string;
  intentLayer: number | null;
  clusterName: string | null;
  searchVolume: number | null;
  /** 二段階目標。表示0のドメインに単発目標は運用できない。 */
  target6m: number | null;
  target12m: number | null;
  priority: number;
  /** 対策ページ（記事プラン）。1検索意図=1ページ。カニバリ防止の要。 */
  planTitle: string | null;
  plannedUrl: string | null;
  isExistingPage: boolean;
  currentPosition: number | null;
  prevPosition: number | null;
  delta: number | null;
  impressions: number;
  clicks: number;
  rankingPage: string | null;
  pageMismatch: boolean;
  gapStatus: GapStatus;
}

/** ギャップ状態の意味と、そこから決まる打ち手。 */
export const GAP_META: Record<GapStatus, { label: string; action: string; tone: "bad" | "warn" | "ok" }> = {
  no_page: { label: "未対応", action: "新規記事を作る", tone: "bad" },
  out: { label: "圏外", action: "既存ページが的を外している。作り直す", tone: "bad" },
  far: { label: "21位以下", action: "リライトで押し上げる", tone: "warn" },
  striking: { label: "11〜20位", action: "リライトで1ページ目へ", tone: "warn" },
  top10: { label: "10位以内", action: "CTR改善で刈り取る／守る", tone: "ok" },
};

export const LAYER_LABEL: Record<number, string> = {
  1: "第1層 発注検討（今すぐ客）",
  2: "第2層 課題認識（そのうち客）",
  3: "第3層 情報収集",
};

export async function getKeywordRankings(siteId: string): Promise<KeywordRanking[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("seo_keyword_rankings", { p_site: siteId, p_weeks: 2 });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    keywordId: String(r.keyword_id),
    query: String(r.query),
    intentLayer: r.intent_layer == null ? null : Number(r.intent_layer),
    clusterName: (r.cluster_name as string) ?? null,
    searchVolume: r.search_volume == null ? null : Number(r.search_volume),
    target6m: r.target_position_6m == null ? null : Number(r.target_position_6m),
    target12m: r.target_position_12m == null ? null : Number(r.target_position_12m),
    priority: Number(r.priority ?? 3),
    planTitle: (r.plan_title as string) ?? null,
    plannedUrl: (r.planned_url as string) ?? null,
    isExistingPage: !!r.is_existing_page,
    currentPosition: r.current_position == null ? null : Number(r.current_position),
    prevPosition: r.prev_position == null ? null : Number(r.prev_position),
    delta: r.delta == null ? null : Number(r.delta),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    rankingPage: (r.ranking_page as string) ?? null,
    pageMismatch: !!r.page_mismatch,
    gapStatus: (r.gap_status as GapStatus) ?? "no_page",
  }));
}

export interface KeywordGapRow {
  intentLayer: number | null;
  gapStatus: GapStatus;
  keywords: number;
  totalVolume: number;
  totalImpressions: number;
  totalClicks: number;
}

export async function getKeywordGap(siteId: string): Promise<KeywordGapRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("seo_keyword_gap", { p_site: siteId });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    intentLayer: r.intent_layer == null ? null : Number(r.intent_layer),
    gapStatus: (r.gap_status as GapStatus) ?? "no_page",
    keywords: Number(r.keywords ?? 0),
    totalVolume: Number(r.total_volume ?? 0),
    totalImpressions: Number(r.total_impressions ?? 0),
    totalClicks: Number(r.total_clicks ?? 0),
  }));
}

/**
 * 「狙っていなかったが取れている語」= 拾い物。
 * 捨てるのではなく仮説の種として扱う。ここから台帳に昇格させる。
 */
export interface DiscoveredQuery {
  query: string;
  impressions: number;
  clicks: number;
  position: number | null;
  pagePath: string | null;
}

export async function getDiscoveredQueries(siteId: string, limit = 15): Promise<DiscoveredQuery[]> {
  const sb = getSupabaseServer();
  const [weeklyR, kwR] = await Promise.all([
    sb
      .from("seo_query_weekly")
      .select("query, page_path, impressions, clicks, position")
      .eq("site_id", siteId)
      .order("impressions", { ascending: false })
      .limit(400),
    sb.from("seo_keywords").select("query").eq("site_id", siteId),
  ]);
  const known = new Set((kwR.data ?? []).map((k) => String(k.query)));

  const agg = new Map<string, { impressions: number; clicks: number; posNum: number; posDen: number; page: string | null }>();
  for (const r of weeklyR.data ?? []) {
    const q = String(r.query);
    if (known.has(q)) continue;
    const imp = Number(r.impressions ?? 0);
    const cur = agg.get(q) ?? { impressions: 0, clicks: 0, posNum: 0, posDen: 0, page: null };
    cur.impressions += imp;
    cur.clicks += Number(r.clicks ?? 0);
    if (r.position != null && imp > 0) {
      cur.posNum += Number(r.position) * imp;
      cur.posDen += imp;
    }
    if (!cur.page) cur.page = (r.page_path as string) || null;
    agg.set(q, cur);
  }

  return [...agg.entries()]
    .map(([query, v]) => ({
      query,
      impressions: v.impressions,
      clicks: v.clicks,
      position: v.posDen > 0 ? Math.round((v.posNum / v.posDen) * 10) / 10 : null,
      pagePath: v.page,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * 記事プラン別の進捗。
 * 1記事 = メインKW1つ + サブKW数語。KW1語だけ見て諦めないための単位。
 */
export interface ArticlePlanProgress {
  planId: string;
  title: string;
  mainKeyword: string;
  intentLayer: number | null;
  clusterName: string | null;
  difficulty: number | null;
  priority: number;
  pageRole: string | null;
  pageType: string | null;
  plannedUrl: string | null;
  isExistingPage: boolean;
  status: string;
  publishedUrl: string | null;
  keywordCount: number;
  totalVolume: number;
  rankedTop10: number;
  rankedAny: number;
  impressions: number;
  clicks: number;
}

export async function getArticlePlans(siteId: string): Promise<ArticlePlanProgress[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("seo_article_plan_progress", { p_site: siteId });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    planId: String(r.plan_id),
    title: String(r.title),
    mainKeyword: String(r.main_keyword),
    intentLayer: r.intent_layer == null ? null : Number(r.intent_layer),
    clusterName: (r.cluster_name as string) ?? null,
    difficulty: r.difficulty == null ? null : Number(r.difficulty),
    priority: Number(r.priority ?? 3),
    pageRole: (r.page_role as string) ?? null,
    pageType: (r.page_type as string) ?? null,
    plannedUrl: (r.planned_url as string) ?? null,
    isExistingPage: !!r.is_existing_page,
    status: String(r.status ?? "planned"),
    publishedUrl: (r.published_url as string) ?? null,
    keywordCount: Number(r.keyword_count ?? 0),
    totalVolume: Number(r.total_volume ?? 0),
    rankedTop10: Number(r.ranked_top10 ?? 0),
    rankedAny: Number(r.ranked_any ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
  }));
}

/** 難易度の意味。検索数だけで選ぶと競合が強い語ばかり狙って半年成果ゼロになる。 */
export const DIFFICULTY_LABEL: Record<number, { label: string; note: string }> = {
  1: { label: "易", note: "ニッチ・自社商材名。競合ほぼ無し" },
  2: { label: "やや易", note: "ツール名×法人、業種別、階層別" },
  3: { label: "中", note: "中間。ある程度のドメイン実力が必要" },
  4: { label: "難", note: "一般語＋修飾。大手と競合する" },
  5: { label: "最難", note: "一般語ビッグ。後半で挑む" },
};

export const PLAN_STATUS_LABEL: Record<string, string> = {
  planned: "未着手",
  writing: "執筆中",
  review: "確認中",
  published: "公開済み",
};
