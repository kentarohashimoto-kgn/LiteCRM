import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { expectedValueFromClicks, iceScore, isInCooldown, ACTION_PRIORS } from "@/lib/seo/expected-value";
import { estimateIntentLayer } from "@/lib/seo/benchmark";
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

      const rows: Record<string, unknown>[] = [];
      for (const ins of insights) {
        if (rows.length >= MAX_PER_DAY) break;
        const actionType = ins.action_type ?? "rewrite";
        const key = `${actionType}|${ins.query ?? ""}|${ins.page_path ?? ""}`;
        const last = lastByTarget.get(key);
        if (
          last &&
          isInCooldown({ lastProposedAt: last.date, lastStatus: last.status, rejectReason: last.reason, today })
        ) {
          skipped += 1;
          continue;
        }

        const extraClicks = Number(ins.metric_json?.extraClicks ?? 0);
        const expected = expectedValueFromClicks(extraClicks, rates);
        const intentLayer = ins.query ? estimateIntentLayer(ins.query) : null;
        const ice = iceScore(
          expected.revenue,
          actionType,
          { layer1: intentLayer === 1 },
          weights,
        );

        rows.push({
          tenant_id: ins.tenant_id,
          site_id: siteId,
          insight_id: ins.id,
          title: proposalTitle(ins, actionType),
          action_type: actionType,
          lever: LEVER_BY_KIND[ins.kind] ?? null,
          intent_layer: intentLayer,
          target_query: ins.query ?? "",
          target_page: ins.page_path ?? "",
          evidence_json: { kind: ins.kind, detected: ins.title, ...ins.metric_json },
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
function proposalTitle(ins: InsightRow, actionType: string): string {
  const label = ACTION_PRIORS[actionType]?.label ?? actionType;
  const target = ins.query ? `「${ins.query}」` : ins.page_path || "サイト全体";
  if (ins.kind === "intent_mix") return `発注検討層のキーワードを取りに行く（${label}）`;
  return `${target} の${label}`;
}
