import { getSupabaseServer } from "@/lib/supabase/server";
import { todayJst, addDays } from "@/lib/seo/site-match";
import { completionRate, coverageRate, DEFAULT_RATES, type StrategyRates, type IntentCoverage } from "@/lib/seo/strategy";

/**
 * 戦略ボード（F-306）の参照ヘルパー。
 * 戦略ドキュメントの各章に1対1で対応するデータを集める。
 */

export interface Strategy {
  id: string;
  siteId: string;
  name: string;
  periodFrom: string;
  periodTo: string;
  targetMonthlyRevenue: number;
  currentPhase: string;
  rates: StrategyRates;
  /** 各レートを CRM実績 と 想定値 のどちらから取ったか（画面にバッジを出す） */
  rateSources: Record<keyof StrategyRates, "crm" | "assumed">;
}

/** 有効な戦略を1本取得し、CRM実績で置ける値は実績に差し替える。 */
export async function getStrategy(
  siteId: string,
  crm: { winRate: number | null; medianDealAmount: number | null },
  funnel: { leadToOpp: number | null; cvr: number | null; ctr: number | null },
): Promise<Strategy | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("seo_strategies")
    .select(
      "id, site_id, name, period_from, period_to, target_monthly_revenue, current_phase, assumed_deal_amount, assumed_win_rate, assumed_opp_rate, assumed_valid_rate, assumed_inquiry_cvr, assumed_ctr",
    )
    .eq("site_id", siteId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const num = (v: unknown, fallback: number) => (v == null ? fallback : Number(v));
  const sources = {} as Record<keyof StrategyRates, "crm" | "assumed">;

  // 実績が取れているものは実績を優先する。実績が無い段だけ想定値で埋める。
  const pick = (key: keyof StrategyRates, actual: number | null, assumed: unknown, fallback: number): number => {
    if (actual != null && actual > 0) {
      sources[key] = "crm";
      return actual;
    }
    sources[key] = "assumed";
    return num(assumed, fallback);
  };

  const rates: StrategyRates = {
    dealAmount: pick("dealAmount", crm.medianDealAmount, data.assumed_deal_amount, DEFAULT_RATES.dealAmount),
    winRate: pick("winRate", crm.winRate, data.assumed_win_rate, DEFAULT_RATES.winRate),
    oppRate: pick("oppRate", funnel.leadToOpp, data.assumed_opp_rate, DEFAULT_RATES.oppRate),
    validRate: pick("validRate", null, data.assumed_valid_rate, DEFAULT_RATES.validRate),
    inquiryCvr: pick("inquiryCvr", funnel.cvr, data.assumed_inquiry_cvr, DEFAULT_RATES.inquiryCvr),
    sessionPerClick: DEFAULT_RATES.sessionPerClick,
    ctr: pick("ctr", funnel.ctr, data.assumed_ctr, DEFAULT_RATES.ctr),
  };
  sources.sessionPerClick = "assumed";

  return {
    id: data.id as string,
    siteId: data.site_id as string,
    name: data.name as string,
    periodFrom: data.period_from as string,
    periodTo: data.period_to as string,
    targetMonthlyRevenue: Number(data.target_monthly_revenue ?? 0),
    currentPhase: (data.current_phase as string) ?? "phase0",
    rates,
    rateSources: sources,
  };
}

export interface ClusterRow {
  id: string;
  name: string;
  priority: number;
  status: string;
  targetArticleCount: number;
  articleCount: number;
  hasPillar: boolean;
  completion: number;
  clicks: number;
  note: string | null;
}

/** クラスタごとの進捗。記事本数は seo_pages の紐付けから数える。 */
export async function getClusterProgress(siteId: string, days = 30): Promise<ClusterRow[]> {
  const sb = getSupabaseServer();
  const to = todayJst();
  const from = addDays(to, -(days - 1));

  const [clustersR, pagesR, clicksR] = await Promise.all([
    sb
      .from("seo_clusters")
      .select("id, name, priority, status, target_article_count, pillar_page_id, note")
      .eq("site_id", siteId)
      .order("priority"),
    sb.from("seo_pages").select("id, cluster_id, url_path").eq("site_id", siteId),
    sb.from("seo_page_daily").select("page_path, clicks").eq("site_id", siteId).gte("date", from).lte("date", to),
  ]);

  const clicksByPath = new Map<string, number>();
  for (const r of clicksR.data ?? []) {
    const k = r.page_path as string;
    clicksByPath.set(k, (clicksByPath.get(k) ?? 0) + Number(r.clicks ?? 0));
  }
  const pages = pagesR.data ?? [];

  return (clustersR.data ?? []).map((c) => {
    const mine = pages.filter((p) => p.cluster_id === c.id);
    const hasPillar = !!c.pillar_page_id;
    const articleCount = mine.filter((p) => p.id !== c.pillar_page_id).length;
    const clicks = mine.reduce((n, p) => n + (clicksByPath.get(p.url_path as string) ?? 0), 0);
    const target = Number(c.target_article_count ?? 8);
    return {
      id: c.id as string,
      name: c.name as string,
      priority: Number(c.priority ?? 3),
      status: (c.status as string) ?? "planned",
      targetArticleCount: target,
      articleCount,
      hasPillar,
      completion: completionRate(hasPillar, articleCount, target),
      clicks,
      note: (c.note as string) ?? null,
    };
  });
}

/**
 * 検索意図3層のカバレッジ。
 * 「10位以内」の判定は週次ロールアップの加重平均順位を使う
 * （日次はブレるため、判断に使う数字としては不適切）。
 */
export async function getIntentCoverage(siteId: string, days = 28): Promise<IntentCoverage[]> {
  const sb = getSupabaseServer();
  const to = todayJst();
  const from = addDays(to, -days);

  const [kwR, weeklyR] = await Promise.all([
    sb.from("seo_keywords").select("query, intent_layer").eq("site_id", siteId).eq("is_target", true),
    sb
      .from("seo_query_weekly")
      .select("query, position, impressions, clicks")
      .eq("site_id", siteId)
      .gte("week_start", from),
  ]);

  // 同一クエリの複数行（ページ違い・週違い）を、表示回数の加重平均で1つにまとめる
  const agg = new Map<string, { posNum: number; posDen: number; impressions: number; clicks: number }>();
  for (const r of weeklyR.data ?? []) {
    const q = r.query as string;
    const cur = agg.get(q) ?? { posNum: 0, posDen: 0, impressions: 0, clicks: 0 };
    const imp = Number(r.impressions ?? 0);
    const pos = r.position == null ? null : Number(r.position);
    if (pos != null && imp > 0) {
      cur.posNum += pos * imp;
      cur.posDen += imp;
    }
    cur.impressions += imp;
    cur.clicks += Number(r.clicks ?? 0);
    agg.set(q, cur);
  }

  const layers: Array<1 | 2 | 3> = [1, 2, 3];
  return layers.map((layer) => {
    const kws = (kwR.data ?? []).filter((k) => Number(k.intent_layer ?? 0) === layer);
    let ranked = 0;
    let impressions = 0;
    let clicks = 0;
    for (const k of kws) {
      const a = agg.get(k.query as string);
      if (!a) continue;
      impressions += a.impressions;
      clicks += a.clicks;
      const pos = a.posDen > 0 ? a.posNum / a.posDen : null;
      if (pos != null && pos <= 10) ranked += 1;
    }
    return {
      layer,
      label: "",
      keywordCount: kws.length,
      rankedTop10: ranked,
      coverageRate: coverageRate(ranked, kws.length),
      impressions,
      clicks,
    };
  });
}

export interface MilestoneRow {
  id: string;
  phase: string;
  seq: number;
  title: string;
  dueDate: string | null;
  status: string;
}

export async function getMilestones(strategyId: string): Promise<MilestoneRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("seo_strategy_milestones")
    .select("id, phase, seq, title, due_date, status")
    .eq("strategy_id", strategyId)
    .order("phase")
    .order("seq");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    phase: r.phase as string,
    seq: Number(r.seq ?? 0),
    title: r.title as string,
    dueDate: (r.due_date as string) ?? null,
    status: (r.status as string) ?? "todo",
  }));
}
