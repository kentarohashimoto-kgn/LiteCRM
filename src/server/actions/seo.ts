"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listGscSites } from "@/lib/seo/gsc";
import { checkGa4Access } from "@/lib/seo/ga4";
import { getSeoCredentialInfo } from "@/lib/seo/google-sa";
import { runSeoIngest } from "@/lib/seo/run-ingest";

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

  revalidatePath("/app/seo/proposals");
  revalidatePath("/app/seo");
  back(to === "approved" ? "saved=approved" : "saved=rejected");
}
