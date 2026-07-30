import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { expectedValueFromClicks, iceScore, isInCooldown, ACTION_PRIORS } from "@/lib/seo/expected-value";
import { estimateIntentLayer } from "@/lib/seo/benchmark";
import { groupInsightsByPage, isPageScopedAction, type Insight } from "@/lib/seo/analyze";
import { DEFAULT_RATES, type StrategyRates } from "@/lib/seo/strategy";
import { todayJst } from "@/lib/seo/site-match";

/**
 * 検出した機会(seo_insights)を「承認できる提案」に変換する（決定的処理）。
 *
 * 提案の中身のうち、期待値とスコアはここで確定させる。
 * AI（WO-34の夜間ジョブ）が書くのは仮説と打ち手の文章だけなので、
 * AIが動いていなくても提案としては成立し、承認して実行できる。
 *
 * 1日の新規提案は上限つき。人が処理できる量を超えると承認が形骸化するため。
 */

const MAX_PER_DAY = 10;

/** 検出種別 → レバー（どの段に効く施策か）。 */
const LEVER_BY_KIND: Record<string, string> = {
  zero_click: "ctr",
  ctr_opportunity: "ctr",
  striking_distance: "position",
  rank_decline: "position",
  click_drop: "ctr",
  cannibalization: "position",
  intent_mix: "lead_quality",
};

export interface ProposalRunResult {
  ok: boolean;
  created: number;
  skipped: number;
  errors: string[];
}

interface InsightRow {
  id: string;
  tenant_id: string;
  site_id: string;
  kind: string;
  query: string;
  page_path: string;
  title: string;
  metric_json: Record<string, unknown>;
  opportunity_score: number;
  action_type: string | null;
}

/** 戦略からレートと係数を取り、CRM実績で置ける値は実績を優先する。 */
async function loadRates(
  admin: ReturnType<typeof getSupabaseAdmin>,
  siteId: string,
): Promise<{ rates: StrategyRates; weights: { priorityCluster: number; layer1: number; currentPhase: number }; priorityClusterIds: Set<string> }> {
  const { data: st } = await admin
    .from("seo_strategies")
    .select(
      "id, assumed_deal_amount, assumed_win_rate, assumed_opp_rate, assumed_valid_rate, assumed_inquiry_cvr, assumed_ctr, weight_priority_cluster, weight_layer1, weight_current_phase",
    )
    .eq("site_id", siteId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const n = (v: unknown, f: number) => (v == null ? f : Number(v));
  const rates: StrategyRates = {
    dealAmount: n(st?.assumed_deal_amount, DEFAULT_RATES.dealAmount),
    winRate: n(st?.assumed_win_rate, DEFAULT_RATES.winRate),
    oppRate: n(st?.assumed_opp_rate, DEFAULT_RATES.oppRate),
    validRate: n(st?.assumed_valid_rate, DEFAULT_RATES.validRate),
    inquiryCvr: n(st?.assumed_inquiry_cvr, DEFAULT_RATES.inquiryCvr),
    sessionPerClick: DEFAULT_RATES.sessionPerClick,
    ctr: n(st?.assumed_ctr, DEFAULT_RATES.ctr),
  };

  const { data: clusters } = await admin
    .from("seo_clusters")
    .select("id, priority")
    .eq("site_id", siteId)
    .lte("priority", 2);

  return {
    rates,
    weights: {
      priorityCluster: n(st?.weight_priority_cluster, 1.5),
      layer1: n(st?.weight_layer1, 1.3),
      currentPhase: n(st?.weight_current_phase, 1.2),
    },
    priorityClusterIds: new Set((clusters ?? []).map((c) => c.id as string)),
  };
}

export async function runSeoProposals(): Promise<ProposalRunResult> {
  const admin = getSupabaseAdmin();
  const errors: string[] = [];
  const today = todayJst();
  let created = 0;
  let skipped = 0;

  const { data: jobRows } = await admin
    .from("batch_job_settings")
    .select("tenant_id, enabled")
    .eq("job_kind", "seo_ingest");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));

  const { data: sites } = await admin.from("seo_sites").select("id, tenant_id, name").eq("status", "active");
  for (const site of (sites ?? []).filter((s) => enabledTenants.has(s.tenant_id as string))) {
    const siteId = site.id as string;
    try {
      // 最新の検出日の所見だけを対象にする（古い所見から提案を作らない）
      const { data: latest } = await admin
        .from("seo_insights")
        .select("run_date")
        .eq("site_id", siteId)
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) continue;

      const { data: insightsRaw } = await admin
        .from("seo_insights")
        .select("id, tenant_id, site_id, kind, query, page_path, title, metric_json, opportunity_score, action_type")
        .eq("site_id", siteId)
        .eq("run_date", latest.run_date as string)
        .eq("status", "open")
        .order("opportunity_score", { ascending: false })
        .limit(60);
      const insights = (insightsRaw ?? []) as InsightRow[];
      if (!insights.length) continue;

      const { rates, weights } = await loadRates(admin, siteId);

      // クールダウン判定用に、同一サイトの直近提案を引く
      const { data: recent } = await admin
        .from("seo_proposals")
        .select("action_type, target_query, target_page, status, reject_reason, proposed_date")
        .eq("site_id", siteId)
        .order("proposed_date", { ascending: false })
        .limit(500);
      const lastByTarget = new Map<string, { status: string; reason: string | null; date: string }>();
      for (const r of recent ?? []) {
        const key = `${r.action_type}|${r.target_query}|${r.target_page}`;
        if (!lastByTarget.has(key)) {
          lastByTarget.set(key, {
            status: r.status as string,
            reason: (r.reject_reason as string) ?? null,
            date: r.proposed_date as string,
          });
        }
      }

      // ページ単位に束ねる。タイトルを1回書き換えれば、そのページに来る全クエリの
      // CTRが動く。束ねないと「同じ記事のタイトル改善」が何件も並び、期待売上も
      // 分割されて実際より小さく見え、承認の判断を誤らせる。
      const asInsights = insights.map((ins) => ({
        id: ins.id,
        kind: ins.kind as Insight["kind"],
        scope: "query" as const,
        query: ins.query || null,
        pagePath: ins.page_path || null,
        title: ins.title,
        severity: "medium" as const,
        metric: (ins.metric_json ?? {}) as Record<string, number | string | null>,
        opportunityScore: Number(ins.opportunity_score ?? 0),
        actionType: ins.action_type ?? "rewrite",
      }));
      const { grouped, ungrouped } = groupInsightsByPage(asInsights);

      type Candidate = {
        actionType: string;
        query: string;
        page: string;
        extraClicks: number;
        title: string;
        evidence: Record<string, unknown>;
        layer1: boolean;
        insightIds: string[];
      };
      const candidates: Candidate[] = [];

      for (const g of grouped) {
        const others = g.queries.length - 1;
        candidates.push({
          actionType: g.actionType,
          query: g.primaryQuery,
          page: g.pagePath,
          extraClicks: g.totalExtraClicks,
          title: `${g.pagePath} の${ACTION_PRIORS[g.actionType]?.label ?? g.actionType}（「${g.primaryQuery}」${
            others > 0 ? ` ほか${others}語` : ""
          }）`,
          evidence: {
            kind: g.kinds.join(","),
            detected: `このページは ${g.queries.length}語 で機会があります（合計 +${g.totalExtraClicks}クリック/月の見込み）`,
            queries: g.queries
              .map((q) => `${q.query}（${q.position ?? "—"}位 / 表示${q.impressions} / +${q.extraClicks}クリック）`)
              .join(" ／ "),
            impressions: g.totalImpressions,
            extraClicks: g.totalExtraClicks,
          },
          layer1: g.hasLayer1,
          insightIds: g.sourceInsightIds,
        });
      }

      for (const ins of ungrouped) {
        // サイトレベルの構造課題(intent_mix)は「今日の1件を承認する」粒度ではないため、
        // 提案化せず戦略ボードとサマリーの要対応で扱う。
        if (ins.kind === "intent_mix") continue;
        const actionType = ins.actionType;
        if (isPageScopedAction(actionType) && ins.pagePath) continue; // 束ね済み
        candidates.push({
          actionType,
          query: ins.query ?? "",
          page: ins.pagePath ?? "",
          extraClicks: Number(ins.metric.extraClicks ?? 0),
          title: proposalTitleFor(actionType, ins.query, ins.pagePath),
          evidence: { kind: ins.kind, detected: ins.title, ...ins.metric },
          layer1: !!ins.query && estimateIntentLayer(ins.query) === 1,
          insightIds: ins.id ? [ins.id] : [],
        });
      }
      candidates.sort((a, b) => b.extraClicks - a.extraClicks);

      const rows: Record<string, unknown>[] = [];
      for (const c of candidates) {
        if (rows.length >= MAX_PER_DAY) break;
        const key = `${c.actionType}|${c.query}|${c.page}`;
        const last = lastByTarget.get(key);
        if (
          last &&
          isInCooldown({ lastProposedAt: last.date, lastStatus: last.status, rejectReason: last.reason, today })
        ) {
          skipped += 1;
          continue;
        }
        const expected = expectedValueFromClicks(c.extraClicks, rates);
        const intentLayer = c.query ? estimateIntentLayer(c.query) : null;
        const ice = iceScore(expected.revenue, c.actionType, { layer1: c.layer1 }, weights);

        rows.push({
          tenant_id: site.tenant_id as string,
          site_id: siteId,
          insight_id: c.insightIds[0] ?? null,
          title: c.title,
          action_type: c.actionType,
          lever: LEVER_BY_KIND[String(c.evidence.kind ?? "").split(",")[0]] ?? null,
          intent_layer: c.layer1 ? 1 : intentLayer,
          target_query: c.query,
          target_page: c.page,
          evidence_json: c.evidence,
          expected_json: expected,
          ice_impact: ice.impact,
          ice_confidence: ice.confidence,
          ice_effort: ice.effort,
          strategy_weight: ice.strategyWeight,
          ice_score: ice.score,
          status: "pending_review",
          proposed_date: today,
        });
      }

      if (rows.length) {
        const { error } = await admin
          .from("seo_proposals")
          .upsert(rows, { onConflict: "site_id,proposed_date,action_type,target_query,target_page" });
        if (error) errors.push(`${site.name}: ${error.message}`);
        else created += rows.length;
      }
    } catch (e) {
      errors.push(`${site.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: errors.length === 0, created, skipped, errors };
}

/** 承認画面でそのまま読める提案タイトル。何をするのかが一目で分かる形にする。 */
function proposalTitleFor(actionType: string, query: string | null, page: string | null): string {
  const label = ACTION_PRIORS[actionType]?.label ?? actionType;
  const target = query ? `「${query}」` : page || "サイト全体";
  return `${target} の${label}`;
}
