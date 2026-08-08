"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listGscSites } from "@/lib/seo/gsc";
import { checkGa4Access } from "@/lib/seo/ga4";
import { getSeoCredentialInfo } from "@/lib/seo/google-sa";
import { runSeoIngest } from "@/lib/seo/run-ingest";
import { buildInstruction, EXECUTION_MODE, type TargetKeyword } from "@/lib/seo/instructions";
import { normalizePath, todayJst } from "@/lib/seo/site-match";
import { loadRates } from "@/lib/seo/run-proposals";
import { expectedValueFromClicks, iceScore, ACTION_PRIORS } from "@/lib/seo/expected-value";
import {
  groupGapsByPlan,
  keywordLine,
  planProposalTitle,
  type KeywordRankingRow,
} from "@/lib/seo/plan-gap";

const ADMIN_ROLES = ["owner", "admin"];
const SETTINGS_PATH = "/app/seo/settings";

/**
 * 接続診断 — サービスアカウントで Search Console / GA4 に到達できるかを確かめ、
 * 「アクセスできるプロパティ一覧」を保存する。
 *
 * これがあると、事前に GSC の登録形式（sc-domain: か URLプレフィックスか）や
 * GA4のプロパティIDを人が調べる必要がなくなる。ボタン1つで実態が分かる。
 */
export async function runSeoDiagnosticsAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  // 変数側に never 型を明示すると、TSが back() 以降を到達不能と理解して型を絞れる
  const back: (q: string) => never = (q) => redirect(`${SETTINGS_PATH}?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!propertyId) back("error=invalid");

  const sb = getSupabaseServer();
  const { data: prop } = await sb
    .from("seo_properties")
    .select("id, gsc_property, ga4_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) back("error=not_found");

  const cred = getSeoCredentialInfo();
  if (!cred.configured) {
    await sb
      .from("seo_properties")
      .update({
        gsc_status: "error",
        ga4_status: "error",
        gsc_checked_at: new Date().toISOString(),
        ga4_checked_at: new Date().toISOString(),
        diagnostics: { error: "サービスアカウントが未設定です（GOOGLE_SEO_SA_CREDENTIALS）。" },
      })
      .eq("id", propertyId);
    revalidatePath(SETTINGS_PATH);
    back("error=not_configured");
  }

  const diagnostics: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    serviceAccount: cred.clientEmail,
    credentialSource: cred.source,
  };
  const now = new Date().toISOString();
  let gscStatus = "unknown";
  let ga4Status = "unknown";

  // --- Search Console: アクセスできるプロパティを列挙する ---
  try {
    const res = await listGscSites();
    if (res.ok) {
      diagnostics.gscSites = res.sites.map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
      const target = prop.gsc_property as string | null;
      if (!target) {
        // 未設定なら「候補が見えている」ことだけ伝える（設定は人が選ぶ）
        gscStatus = res.sites.length ? "not_found" : "forbidden";
        diagnostics.gscHint = res.sites.length
          ? "アクセスできるプロパティが見つかりました。下の一覧から、このサイトに対応するものを選んで保存してください。"
          : "アクセスできるプロパティが1件もありません。Search Consoleの「ユーザーと権限」にサービスアカウントのメールアドレスを追加してください。";
      } else {
        const hit = res.sites.some((s) => s.siteUrl === target);
        gscStatus = hit ? "ok" : "not_found";
        if (!hit) {
          diagnostics.gscHint = `設定中のプロパティ「${target}」は、このサービスアカウントからは見えていません。一覧の値と一致しているか確認してください。`;
        }
      }
    } else {
      gscStatus = res.status;
      diagnostics.gscError = res.message;
    }
  } catch (e) {
    gscStatus = "error";
    diagnostics.gscError = e instanceof Error ? e.message : String(e);
  }

  // --- GA4: プロパティに到達できるか（直近7日のセッションを1回だけ取る） ---
  const ga4Id = prop.ga4_property_id as string | null;
  if (!ga4Id) {
    ga4Status = "unknown";
    diagnostics.ga4Hint =
      "GA4のプロパティIDが未設定です。GA4管理画面 → プロパティ設定 → プロパティID（数字）を入力してください。GA4が未導入の場合は、先にサイトへのGA4タグ設置が必要です。";
  } else {
    try {
      const res = await checkGa4Access(ga4Id);
      if (res.ok) {
        ga4Status = "ok";
        diagnostics.ga4Sessions7d = res.sessions;
        if (res.sessions === 0) {
          diagnostics.ga4Hint =
            "接続はできましたが、直近7日のセッションが0件です。GA4タグがサイトに設置されているか確認してください。";
        }
      } else {
        ga4Status = res.status;
        diagnostics.ga4Error = res.message;
      }
    } catch (e) {
      ga4Status = "error";
      diagnostics.ga4Error = e instanceof Error ? e.message : String(e);
    }
  }

  await sb
    .from("seo_properties")
    .update({
      gsc_status: gscStatus,
      ga4_status: ga4Status,
      gsc_checked_at: now,
      ga4_checked_at: now,
      diagnostics,
    })
    .eq("id", propertyId);

  revalidatePath(SETTINGS_PATH);
  back("saved=diagnosed");
}

/** 接続プロパティ（GSC / GA4 のID）を保存する。 */
export async function saveSeoPropertyAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  // 変数側に never 型を明示すると、TSが back() 以降を到達不能と理解して型を絞れる
  const back: (q: string) => never = (q) => redirect(`${SETTINGS_PATH}?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");

  const gsc = String(formData.get("gsc_property") ?? "").trim() || null;
  const ga4 = String(formData.get("ga4_property_id") ?? "").trim() || null;
  if (ga4 && !/^\d{6,15}$/.test(ga4)) back("error=ga4_format");

  const sb = getSupabaseServer();
  const up = await sb
    .from("seo_properties")
    .update({ gsc_property: gsc, ga4_property_id: ga4, status: "active" })
    .eq("id", id)
    .select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath(SETTINGS_PATH);
  back("saved=property");
}

/** サイト（計測単位）の設定を保存する。 */
export async function saveSeoSiteAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  // 変数側に never 型を明示すると、TSが back() 以降を到達不能と理解して型を絞れる
  const back: (q: string) => never = (q) => redirect(`${SETTINGS_PATH}?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");

  const sitemap = String(formData.get("sitemap_url") ?? "").trim() || null;
  const media = String(formData.get("inquiry_media") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "active");
  if (!["active", "planned", "paused"].includes(status)) back("error=invalid");

  const sb = getSupabaseServer();
  const up = await sb
    .from("seo_sites")
    .update({ sitemap_url: sitemap, inquiry_media: media, status })
    .eq("id", id)
    .select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath(SETTINGS_PATH);
  back("saved=site");
}

/**
 * 「今すぐ取込を実行」— 夜間cronと同じ処理を手動で走らせる。
 *
 * 接続を設定した直後に「本当に数字が取れるか」をその場で確認できるようにするため。
 * 翌朝まで待たないと成否が分からない状態は、導入時の最大の詰まりどころになる。
 * 冪等（upsert）なので何度押しても壊れない。
 */
export async function runSeoIngestNowAction(): Promise<void> {
  const ctx = await requireCtx();
  const back: (q: string) => never = (q) => redirect(`${SETTINGS_PATH}?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  let result: Awaited<ReturnType<typeof runSeoIngest>>;
  try {
    result = await runSeoIngest("manual");
  } catch (e) {
    back(`error=ingest_failed&msg=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/app/seo");
  if (result.skipped) back("error=ingest_disabled");
  if (result.error) back(`error=ingest_failed&msg=${encodeURIComponent(result.error)}`);
  if (result.errors.length) back(`error=ingest_partial&msg=${encodeURIComponent(result.errors[0].slice(0, 300))}`);
  back(`saved=ingested&sites=${result.sites}`);
}

/** ロードマップのマイルストーン完了/未完了を切り替える。 */
export async function setMilestoneStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/strategy?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "todo");
  if (!id || !["todo", "in_progress", "done", "skipped"].includes(to)) back("error=invalid");

  const sb = getSupabaseServer();
  await sb
    .from("seo_strategy_milestones")
    .update({ status: to, completed_at: to === "done" ? new Date().toISOString() : null })
    .eq("id", id);

  revalidatePath("/app/seo/strategy");
  back("saved=milestone");
}

/** 提案の承認 / 却下。却下理由は再提案のクールダウンと学習に使う。 */
export async function reviewProposalAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/proposals?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id || !["approved", "rejected", "snoozed"].includes(to)) back("error=invalid");

  const sb = getSupabaseServer();
  const up = await sb
    .from("seo_proposals")
    .update({
      status: to,
      reject_reason: to === "rejected" ? reason : null,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("insight_id");
  if (up.error) back("error=save_failed");

  // 承認された提案の元になった所見は、以後の検出対象から外す（同じ提案が翌日も出ないように）
  const insightId = up.data?.[0]?.insight_id as string | null;
  if (insightId) {
    await sb
      .from("seo_insights")
      .update({ status: to === "approved" ? "proposed" : "ignored" })
      .eq("id", insightId);
  }

  // 承認 = 実行チケット化。ここで指示書まで作るので、承認直後にHP担当へ渡せる。
  if (to === "approved") {
    const created = await createActionFromProposal(sb, ctx.userId, id);
    revalidatePath("/app/seo/actions");
    if (created === "duplicate_page") {
      revalidatePath("/app/seo/proposals");
      back("saved=approved_dup");
    }
  }

  revalidatePath("/app/seo/proposals");
  revalidatePath("/app/seo");
  back(to === "approved" ? "saved=approved" : "saved=rejected");
}

/**
 * 承認された提案から実行チケットを作る。
 * 指示書は決定的テンプレートで生成するので、AIが未稼働でもそのまま渡せる。
 *
 * G3（同一ページに未完了施策を並走させない）はここで判定する。
 * 並走すると効果がどちらの施策によるものか帰属できなくなる。
 */
async function createActionFromProposal(
  sb: ReturnType<typeof getSupabaseServer>,
  userId: string,
  proposalId: string,
): Promise<"ok" | "duplicate_page" | "skipped"> {
  const { data: p } = await sb
    .from("seo_proposals")
    .select(
      "id, tenant_id, site_id, title, action_type, target_query, target_page, article_plan_id, expected_json, evidence_json, plan_md, seo_sites(name, base_url)",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (!p) return "skipped";

  // 既に同じ提案からチケットを作っていれば二重に作らない
  const { data: existing } = await sb.from("seo_actions").select("id").eq("proposal_id", proposalId).limit(1);
  if (existing?.length) return "skipped";

  const site = (p as { seo_sites?: { name?: string; base_url?: string } }).seo_sites;
  const targetPage = (p.target_page as string) ?? "";
  const planId = (p.article_plan_id as string) ?? null;

  // 記事プラン由来なら「この記事で狙う語」を全部集める。
  // 執筆者はこれを見て1本の記事に見出しを割り当てる（1語1記事にしない）。
  const plan = planId ? await loadArticlePlan(sb, planId) : null;
  const planKeywords = plan?.keywords ?? [];
  const planTitle = plan?.title ?? "";

  let duplicate = false;
  if (targetPage) {
    const { data: openOnPage } = await sb
      .from("seo_actions")
      .select("id")
      .eq("site_id", p.site_id as string)
      .eq("target_page", targetPage)
      .not("status", "in", "(done,canceled)")
      .limit(1);
    duplicate = !!openOnPage?.length;
  }
  // 新規記事は target_page が空なので、ページでは重複を見つけられない。
  // 同じ記事プランに未完了の施策があるかで判定する。
  if (!duplicate && planId) {
    const { data: openOnPlan } = await sb
      .from("seo_actions")
      .select("id, seo_proposals!inner(article_plan_id)")
      .eq("site_id", p.site_id as string)
      .eq("seo_proposals.article_plan_id", planId)
      .not("status", "in", "(done,canceled)")
      .limit(1);
    duplicate = !!openOnPlan?.length;
  }

  const actionType = p.action_type as string;
  const instruction = buildInstruction({
    actionType,
    siteName: site?.name ?? "対象サイト",
    baseUrl: site?.base_url ?? "",
    targetQuery: (p.target_query as string) ?? "",
    targetPage,
    evidence: (p.evidence_json as Record<string, unknown>) ?? {},
    expected: (p.expected_json as Record<string, number>) ?? {},
    planTitle: planTitle || null,
    targetKeywords: planKeywords,
  });
  // AIが仮説・打ち手を書いていれば指示書に追記する（未生成でも成立する）
  const aiPlanMd = (p.plan_md as string) ?? "";
  const deliverable = aiPlanMd ? `${instruction}\n\n## AIが提案した打ち手\n${aiPlanMd}` : instruction;

  const mode = EXECUTION_MODE[actionType] ?? "external";
  const { data: action } = await sb
    .from("seo_actions")
    .insert({
      tenant_id: p.tenant_id as string,
      site_id: p.site_id as string,
      proposal_id: proposalId,
      action_type: actionType,
      execution_mode: mode,
      title: p.title as string,
      target_query: (p.target_query as string) ?? "",
      target_page: targetPage,
      expected_json: p.expected_json ?? {},
      deliverable_md: deliverable,
      status: "todo",
      note: duplicate
        ? "同じページに未完了の施策があります。効果の帰属が難しくなるため、先の施策の完了後に着手してください。"
        : null,
      created_by: userId,
    })
    .select("id")
    .maybeSingle();

  // 記事系はCRMの記事パイプラインに起票して、執筆フローに乗せる
  if (mode === "content" && action) {
    const kwNote = planKeywords.length
      ? `この記事で狙う語（${planKeywords.length}語）: ${planKeywords
          .map((k) => `${k.query}（月${k.volume}）`)
          .join(" / ")}`
      : `対象: ${targetPage || "新規"}`;
    const { data: idea } = await sb
      .from("content_ideas")
      .insert({
        tenant_id: p.tenant_id as string,
        theme: "SEO施策",
        // 記事プラン由来ならプランの記事タイトル案をそのまま渡す
        title: planTitle || (p.target_query as string) || (p.title as string),
        angle: p.title as string,
        target_keyword: (p.target_query as string) ?? null,
        source: "web_trend",
        status: "selected",
        note: `SEO施策から起票（${actionType}）。${kwNote}`,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();
    if (idea) {
      await sb.from("seo_actions").update({ content_idea_id: idea.id }).eq("id", action.id);
      // 記事プラン側にも紐付ける。記事プラン画面から二重に起票されるのを防ぐ。
      if (planId) {
        await sb
          .from("seo_article_plans")
          .update({ content_idea_id: idea.id, status: "writing" })
          .eq("id", planId)
          .is("content_idea_id", null);
        revalidatePath("/app/seo/plans");
      }
    }
  }

  return duplicate ? "duplicate_page" : "ok";
}

/**
 * 記事プランと、その記事で狙う語を指示書に渡せる形で読む。
 * 1記事=メインKW1つ+サブKW数語。ここを渡さないと執筆者は1語しか見えず、
 * 結局1語1記事の薄い記事になる。
 */
async function loadArticlePlan(
  sb: ReturnType<typeof getSupabaseServer>,
  planId: string,
): Promise<{ title: string; mainKeyword: string; angle: string | null; keywords: TargetKeyword[] } | null> {
  const { data: plan } = await sb
    .from("seo_article_plans")
    .select("title, main_keyword, angle")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return null;
  const { data: kws } = await sb
    .from("seo_keywords")
    .select("query, search_volume, target_position_6m, target_position_12m, intent_layer")
    .eq("article_plan_id", planId)
    .eq("status", "active")
    .order("search_volume", { ascending: false, nullsFirst: false });
  const main = (plan.main_keyword as string) ?? "";
  return {
    title: (plan.title as string) ?? "",
    mainKeyword: main,
    angle: (plan.angle as string) ?? null,
    keywords: (kws ?? []).map((k) => ({
      query: k.query as string,
      volume: Number(k.search_volume ?? 0),
      targetPosition: (k.target_position_6m as number) ?? (k.target_position_12m as number) ?? null,
      intentLayer: k.intent_layer == null ? null : Number(k.intent_layer),
      isMain: k.query === main,
    })),
  };
}

/** 施策の状態を進める。「反映しました」の記録が効果検証の起点になる。 */
export async function updateActionStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/actions?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager", "sales_rep"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "");
  const allowed = ["todo", "in_progress", "review", "waiting_deploy", "deployed", "done", "canceled"];
  if (!id || !allowed.includes(to)) back("error=invalid");

  const patch: Record<string, unknown> = { status: to };
  // 反映済みにした瞬間を効果検証の起点として記録する（DBトリガが検証期限を計算する）
  if (to === "deployed") {
    patch.applied_at = new Date().toISOString();
    patch.applied_by = ctx.userId;
  }
  if (to === "canceled") patch.applied_at = null;

  const sb = getSupabaseServer();
  const up = await sb.from("seo_actions").update(patch).eq("id", id).select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath("/app/seo/actions");
  revalidatePath("/app/seo");
  back(to === "deployed" ? "saved=applied" : "saved=status");
}

/**
 * KW順位表の1行から改善提案を即時起票する。
 *
 * 夜間バッチは1日10件の上限とクールダウンで提案を絞るため、
 * 「台帳に未対応の語が並んでいるのに提案が来ない」待ち時間が生まれる。
 * 人が順位表を見て「これを先にやる」と決めた瞬間に起票できる導線が要る。
 * 期待値・スコアの算術はバッチと同一（loadRates / groupGapsByPlan / iceScore）。
 *
 * クリックされたのは1語でも、起票するのは**その語が属する記事プラン1本ぶん**。
 * 1語1提案にすると、承認するたびに別々の記事が作られて薄い記事が量産される。
 */
export async function createProposalFromKeywordAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/keywords?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) back("error=forbidden");

  const keywordId = String(formData.get("keyword_id") ?? "").trim();
  if (!keywordId || !site) back("error=invalid");

  const sb = getSupabaseServer();
  // 順位表RPCの行をそのまま根拠にする（ギャップ状態・実測クリック・目標順位）
  const { data: rows } = await sb.rpc("seo_keyword_rankings", { p_site: site, p_weeks: 2 });
  const all = (rows ?? []) as KeywordRankingRow[];
  const kw = all.find((r) => String(r.keyword_id) === keywordId);
  if (!kw) back("error=not_found");

  // クリックされた語を含む記事プランの候補を作る（バッチと同じ束ね方）
  const planId = (kw.article_plan_id as string) ?? null;
  const scope = planId ? all.filter((r) => r.article_plan_id === planId) : [kw];
  const candidate = groupGapsByPlan(scope)[0];
  if (!candidate) back("saved=proposal_nogap");

  const query = candidate.mainKeyword;
  const actionType = candidate.actionType;
  const page = candidate.targetPage;

  // 同じ対象（またはこの記事プラン）の承認待ちが既にあれば増やさない
  let dup = sb
    .from("seo_proposals")
    .select("id")
    .eq("site_id", site)
    .eq("status", "pending_review");
  dup = planId ? dup.eq("article_plan_id", planId) : dup.eq("target_query", query);
  const { data: existing } = await dup.limit(1);
  if (existing?.length) back("saved=proposal_exists");

  const { rates, weights } = await loadRates(sb, site);
  const expected = expectedValueFromClicks(candidate.totalExtraClicks, rates);
  const layer = candidate.layer1 ? 1 : kw.intent_layer == null ? null : Number(kw.intent_layer);
  const ice = iceScore(expected.revenue, actionType, { layer1: candidate.layer1 }, weights);

  const main = candidate.keywords.find((k) => k.isMain) ?? candidate.keywords[0];
  const statusLabel =
    main.gapStatus === "no_page"
      ? "対策ページが無い"
      : main.gapStatus === "out"
        ? "ページはあるが圏外"
        : main.position != null
          ? `${main.position}位`
          : "順位計測中";

  const { data: siteRow } = await sb.from("seo_sites").select("tenant_id").eq("id", site).maybeSingle();
  if (!siteRow) back("error=not_found");

  const up = await sb.from("seo_proposals").upsert(
    {
      tenant_id: siteRow.tenant_id as string,
      site_id: site,
      article_plan_id: planId,
      title: planProposalTitle(candidate, ACTION_PRIORS[actionType]?.label ?? actionType),
      action_type: actionType,
      lever: actionType === "title_meta" ? "ctr" : "position",
      intent_layer: layer,
      target_query: query,
      target_page: page,
      evidence_json: {
        kind: "keyword_gap",
        detected: `KW順位表から手動起票。${
          candidate.planId ? `記事プラン「${candidate.planTitle}」で${candidate.keywords.length}語を狙う。` : ""
        }現状: ${statusLabel} / 想定検索数 月${candidate.totalVolume} / 目標 ${main.targetPosition}位`,
        queries: candidate.keywords.map(keywordLine).join(" ／ "),
        planTitle: candidate.planTitle,
        keywordCount: candidate.keywords.length,
        searchVolume: candidate.totalVolume,
        targetPosition: main.targetPosition,
        currentPosition: main.position ?? "圏外",
        impressions: candidate.totalImpressions,
        clicks: candidate.keywords.reduce((n, k) => n + k.clicks, 0),
        extraClicks: candidate.totalExtraClicks,
        gapStatus: main.gapStatus,
        difficulty: candidate.difficulty,
      },
      expected_json: expected,
      ice_impact: ice.impact,
      ice_confidence: ice.confidence,
      ice_effort: ice.effort,
      strategy_weight: ice.strategyWeight,
      ice_score: ice.score,
      status: "pending_review",
      proposed_date: todayJst(),
    },
    { onConflict: "site_id,proposed_date,action_type,target_query,target_page" },
  );
  if (up.error) back("error=save_failed");

  revalidatePath("/app/seo/proposals");
  revalidatePath("/app/seo/keywords");
  back("saved=proposal_created");
}

/**
 * 公開URLの登録と反映記録を1操作で行う。
 *
 * 運用実態は「指示書(プロンプト)を別AIに渡して記事を作り、公開したURLを持って戻る」
 * なので、着手→反映依頼→反映の3クリックを踏ませず、URLを貼った時点で
 * 反映済み(deployed)にする。applied_at はDBトリガで検証期限の起点になる。
 */
export async function recordActionPublishedAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/actions?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager", "sales_rep"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!id) back("error=invalid");
  // 絶対URLかパスのみ受け付ける（貼り間違いをここで弾く）
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) back("error=invalid_url");

  const sb = getSupabaseServer();
  const { data: action } = await sb
    .from("seo_actions")
    .select("id, target_page, content_idea_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!action) back("error=save_failed");

  const path = normalizePath(url);
  const patch: Record<string, unknown> = {
    status: "deployed",
    applied_at: new Date().toISOString(),
    applied_by: ctx.userId,
    published_url: url,
  };
  // 新規記事はチケット作成時点で対象ページが無い。公開URLで確定させると
  // G3(同一ページ並走の検出)と効果検証がこのページに対して効くようになる。
  if (!action.target_page) patch.target_page = path;

  const up = await sb.from("seo_actions").update(patch).eq("id", id).select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  // 紐づく記事ネタも公開済みへ同期する。パイプライン側を別途進める手間を無くす。
  if (action.content_idea_id) {
    await sb
      .from("content_ideas")
      .update({ status: "published" })
      .eq("id", action.content_idea_id)
      .neq("status", "published");
    revalidatePath("/app/content");
  }

  revalidatePath("/app/seo/actions");
  revalidatePath("/app/seo");
  back("saved=applied");
}

/**
 * 記事プランを記事ネタ（content_ideas）に起票して執筆フローに乗せる。
 * サブKWを含めて起票するので、執筆者が「この記事で何語狙うのか」を見て書ける。
 */
export async function startArticlePlanAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/plans?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const { data: plan } = await sb
    .from("seo_article_plans")
    .select("id, tenant_id, title, main_keyword, angle, content_idea_id, seo_clusters(name)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) back("error=not_found");
  if (plan.content_idea_id) back("error=already");

  // この記事で狙う語を全部渡す。執筆者が構成を決める材料になる。
  const { data: kws } = await sb
    .from("seo_keywords")
    .select("query, search_volume")
    .eq("article_plan_id", id)
    .order("search_volume", { ascending: false });
  const kwList = (kws ?? [])
    .map((k) => `${k.query}（月${k.search_volume ?? "—"}）`)
    .join(" / ");

  const cluster = (plan as { seo_clusters?: { name?: string } }).seo_clusters?.name ?? "SEO";
  const { data: idea } = await sb
    .from("content_ideas")
    .insert({
      tenant_id: plan.tenant_id as string,
      theme: cluster,
      title: plan.title as string,
      angle: (plan.angle as string) ?? null,
      target_keyword: plan.main_keyword as string,
      source: "web_trend",
      status: "selected",
      note: `SEO記事プランから起票。この記事で狙う語: ${kwList || plan.main_keyword}`,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (!idea) back("error=save_failed");

  await sb
    .from("seo_article_plans")
    .update({ content_idea_id: idea.id, status: "writing" })
    .eq("id", id);

  revalidatePath("/app/seo/plans");
  revalidatePath("/app/content");
  back("saved=started");
}

/**
 * 記事プランの対策URLを保存する。
 * 既存ページで狙うプランはURLが入って初めて「対策ページと実表示ページのズレ」
 * （カニバリの兆候）を検出できるようになる。
 */
export async function savePlanUrlAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const site = String(formData.get("site") ?? "");
  const back: (q: string) => never = (q) =>
    redirect(`/app/seo/plans?${site ? `site=${site}&` : ""}${q}`);
  if (!["owner", "admin", "sales_manager"].includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");
  const raw = String(formData.get("planned_url") ?? "").trim();
  // 絶対URLで貼られてもパスに正規化する（GSCのページパスと突合するため）
  let url: string | null = raw || null;
  if (url && /^https?:\/\//i.test(url)) {
    try {
      url = new URL(url).pathname;
    } catch {
      back("error=invalid");
    }
  }

  const sb = getSupabaseServer();
  const up = await sb
    .from("seo_article_plans")
    .update({ planned_url: url, is_existing_page: url != null })
    .eq("id", id)
    .select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath("/app/seo/plans");
  revalidatePath("/app/seo/keywords");
  back("saved=url");
}
