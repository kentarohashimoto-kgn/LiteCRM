"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { isValidEmail, renderEmailTemplate } from "@/lib/email";
import { deliverTrackedEmail, type DeliverParams } from "@/lib/mail-deliver";
import { refreshAccessToken } from "@/lib/google-oauth";
import { logAudit, clientIp } from "@/lib/audit-events";

/**
 * リード一括メール(F-203 MVP・D2=手動トリガー)。
 * リード一覧の絞り込み結果に対し、テンプレを差し込んで送信者本人のアカウントから順次送信する。
 * ガードレール: サプレッション突合 / 同一テンプレの再送防止 / メール重複除外 / 1回300件上限。
 * 送信メールには開封/クリック計測と配信停止フッターが自動で付く(deliverTrackedEmail)。
 */

const SEND_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner", "inside_sales"];
const MAX_PER_RUN = 300;

export interface LeadMailFilters {
  q?: string;
  event?: string;       // raw_event(取込イベント)
  disposition?: string;
  rank?: string;        // 単一 or CSV("S,A")。ranks指定時は無視
  ranks?: string[];     // ランク複数選択
  leadIds?: string[];   // チェックボックスで個別選択した場合。指定時は他の絞り込みより優先
}

interface TargetLead { id: string; email: string; company: string; name: string }

interface TargetResolution {
  targets: TargetLead[];
  totalMatched: number;      // 絞り込み一致(メール有無問わず)
  noEmail: number;
  suppressed: number;
  alreadySent: number;       // 同一テンプレ送信済み
  duplicateEmail: number;    // 同一アドレスの重複(先頭のみ残す)
  capped: boolean;
}

async function resolveTargets(filters: LeadMailFilters, templateId: string): Promise<TargetResolution> {
  const sb = getSupabaseServer();
  let qy = sb.from("leads").select("id, email, company_name, contact_name, priority_score", { count: "exact" });
  const pickedIds = (filters.leadIds ?? []).filter(Boolean).slice(0, 500);
  if (pickedIds.length > 0) {
    // チェックボックスでの個別選択が最優先(他の絞り込みは適用済みの画面上で選んだ結果のため)
    qy = qy.in("id", pickedIds);
  } else {
    const q = (filters.q ?? "").replace(/[,%_()]/g, " ").trim();
    if (q) qy = qy.or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%`);
    if (filters.event) qy = qy.eq("raw_event", filters.event);
    if (filters.disposition) qy = qy.eq("disposition", filters.disposition);
    const ranks = (filters.ranks ?? (filters.rank ? filters.rank.split(",") : [])).map((r) => r.trim()).filter(Boolean);
    if (ranks.length === 1) qy = qy.eq("rank", ranks[0]);
    else if (ranks.length > 1) qy = qy.in("rank", ranks);
  }
  qy = qy.order("priority_score", { ascending: false, nullsFirst: false }).order("id").limit(2000);
  const { data, count } = await qy;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data ?? []) as any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let noEmail = 0;
  let duplicateEmail = 0;
  const seen = new Set<string>();
  const withEmail: TargetLead[] = [];
  for (const l of rows) {
    const email = String(l.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) { noEmail++; continue; }
    if (seen.has(email)) { duplicateEmail++; continue; }
    seen.add(email);
    withEmail.push({ id: l.id, email, company: l.company_name ?? "", name: l.contact_name ?? "" });
  }

  // サプレッション(配信停止・バウンス)除外
  const emails = withEmail.map((t) => t.email);
  const suppressedSet = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data: sup } = await sb.from("mail_suppressions").select("email").in("email", emails.slice(i, i + 200));
    for (const s of sup ?? []) suppressedSet.add(String(s.email).toLowerCase());
  }

  // 同一テンプレの送信済みリードを除外(再実行・重複クリックに冪等)
  const sentSet = new Set<string>();
  const ids = withEmail.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: sent } = await sb
      .from("email_messages")
      .select("lead_id")
      .eq("template_id", templateId)
      .eq("direction", "out")
      .in("status", ["sent", "queued"])
      .in("lead_id", ids.slice(i, i + 200));
    for (const m of sent ?? []) if (m.lead_id) sentSet.add(String(m.lead_id));
  }

  const eligible = withEmail.filter((t) => !suppressedSet.has(t.email) && !sentSet.has(t.id));
  const suppressed = withEmail.filter((t) => suppressedSet.has(t.email)).length;
  const alreadySent = withEmail.filter((t) => !suppressedSet.has(t.email) && sentSet.has(t.id)).length;
  const capped = eligible.length > MAX_PER_RUN;
  return {
    targets: eligible.slice(0, MAX_PER_RUN),
    totalMatched: count ?? rows.length,
    noEmail, suppressed, alreadySent, duplicateEmail, capped,
  };
}

export interface BulkMailPreview {
  ok: boolean;
  error?: string;
  sendable?: number;
  totalMatched?: number;
  noEmail?: number;
  suppressed?: number;
  alreadySent?: number;
  duplicateEmail?: number;
  capped?: boolean;
  sampleSubject?: string;
  sampleBody?: string;
  subjectTmpl?: string;      // テンプレ原文(送信前の直接編集の初期値)
  bodyTmpl?: string;
  sampleContact?: string;    // 差し込みプレビュー用の先頭リード
  sampleCompany?: string;
  senderName?: string;
  senderReady?: boolean;
}

/** テンプレ一覧(一括送信パネル用)。 */
export async function listMailTemplatesAction(): Promise<{ id: string; name: string; category: string }[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.from("email_templates").select("id, name, category").order("category").order("name");
  return (data ?? []).map((t) => ({ id: t.id as string, name: t.name as string, category: (t.category as string) ?? "other" }));
}

/** 送信前プレビュー: 対象件数の内訳と、先頭リードでの差し込み例。 */
export async function previewLeadBulkMailAction(filters: LeadMailFilters, templateId: string): Promise<BulkMailPreview> {
  const ctx = await requireCtx();
  if (!SEND_ROLES.includes(ctx.role)) return { ok: false, error: "送信権限がありません" };
  if (!templateId) return { ok: false, error: "テンプレートを選択してください" };
  const sb = getSupabaseServer();
  const [{ data: tpl }, { data: acc }, r] = await Promise.all([
    sb.from("email_templates").select("subject_tmpl, body_tmpl").eq("id", templateId).maybeSingle(),
    sb.from("user_mail_accounts").select("status, from_name").eq("user_id", ctx.userId).maybeSingle(),
    resolveTargets(filters, templateId),
  ]);
  if (!tpl) return { ok: false, error: "テンプレートが見つかりません" };
  const sample = r.targets[0];
  const vars = { contact: sample?.name || "(担当者名)", company: sample?.company || "(会社名)", opportunity: "", sender: (acc?.from_name as string) || "" };
  return {
    ok: true,
    sendable: r.targets.length,
    totalMatched: r.totalMatched,
    noEmail: r.noEmail,
    suppressed: r.suppressed,
    alreadySent: r.alreadySent,
    duplicateEmail: r.duplicateEmail,
    capped: r.capped,
    sampleSubject: renderEmailTemplate(tpl.subject_tmpl as string, vars),
    sampleBody: renderEmailTemplate(tpl.body_tmpl as string, vars),
    subjectTmpl: tpl.subject_tmpl as string,
    bodyTmpl: tpl.body_tmpl as string,
    sampleContact: sample?.name || "",
    sampleCompany: sample?.company || "",
    senderName: (acc?.from_name as string) || "",
    senderReady: acc?.status === "active",
  };
}

export interface BulkMailResult {
  ok: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  failures?: { email: string; error: string }[];
  skipped?: { suppressed: number; alreadySent: number; noEmail: number };
  batchId?: string;   // セグメント履歴(lead_mail_batches)のID。継続チャンクの呼出に渡す
}

/**
 * 一括送信本体。順次送信(送信者本人のSMTP/Gmail)。
 * batchSize(既定20・最大50)ずつ処理し、クライアント側で完了までループする
 * (送信済みリードは resolveTargets が除外するため、繰り返し呼んでも二重送信しない)。
 * 初回呼出でセグメント履歴(lead_mail_batches)を作成し、継続チャンクは opts.batchId で同じ行に積む。
 */
export async function sendLeadBulkMailAction(
  filters: LeadMailFilters,
  templateId: string,
  batchSize = 20,
  opts?: {
    batchId?: string;
    segmentTitle?: string;
    /** 送信直前の直接編集(全宛先に適用。{contact}等の差し込み変数は使用可)。未指定はテンプレの内容 */
    subjectTmpl?: string;
    bodyTmpl?: string;
  },
): Promise<BulkMailResult> {
  const ctx = await requireCtx();
  if (ctx.isPresentation) return { ok: false, error: "プレゼンモード中はメール送信できません" };
  if (!SEND_ROLES.includes(ctx.role)) return { ok: false, error: "送信権限がありません" };
  if (!mailCredSecretConfigured()) return { ok: false, error: "サーバーに MAIL_CRED_SECRET が未設定です（管理者に連絡してください）" };
  if (!templateId) return { ok: false, error: "テンプレートを選択してください" };

  const sb = getSupabaseServer();
  const { data: tpl } = await sb.from("email_templates").select("id, subject_tmpl, body_tmpl").eq("id", templateId).maybeSingle();
  if (!tpl) return { ok: false, error: "テンプレートが見つかりません" };
  // 送信直前の直接編集(件名・本文)。空文字は「編集で消した」と区別できないため、値がある時だけ上書き
  const subjectTmpl = (opts?.subjectTmpl ?? "").trim() || (tpl.subject_tmpl as string);
  const bodyTmpl = (opts?.bodyTmpl ?? "").trim() ? (opts?.bodyTmpl as string) : (tpl.body_tmpl as string);

  const { data: acc } = await sb
    .from("user_mail_accounts")
    .select("auth_method, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, oauth_refresh_token_enc, oauth_email, from_email, from_name, bcc_self, status")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!acc || acc.status !== "active") return { ok: false, error: "送信メールアカウントが未接続です。[メール設定]から接続してください。" };

  // 認証情報は一括分をまとめて1回だけ解決する
  let authArgs: Pick<DeliverParams, "authMethod" | "smtp" | "oauthAccessToken" | "from">;
  if (acc.auth_method === "google_oauth") {
    let refresh = "";
    try { refresh = decryptSecret(acc.oauth_refresh_token_enc as string); }
    catch { return { ok: false, error: "Google認証情報の復号に失敗しました。" }; }
    const tok = await refreshAccessToken(refresh);
    if (!tok.ok) return { ok: false, error: "Googleトークンの更新に失敗しました（再接続してください）: " + tok.error };
    authArgs = {
      authMethod: "google_oauth", oauthAccessToken: tok.accessToken,
      from: { email: (acc.oauth_email as string) || (acc.from_email as string), name: acc.from_name as string | null },
    };
  } else {
    let password = "";
    try { password = decryptSecret(acc.smtp_password_enc as string); }
    catch { return { ok: false, error: "送信資格情報の復号に失敗しました。" }; }
    authArgs = {
      authMethod: "smtp",
      from: { email: acc.from_email as string, name: acc.from_name as string | null },
      smtp: { host: acc.smtp_host as string, port: acc.smtp_port as number, secure: acc.smtp_secure as boolean, username: acc.smtp_username as string, password, fromEmail: acc.from_email as string, fromName: acc.from_name as string | null },
    };
  }

  const r = await resolveTargets(filters, templateId);
  if (r.targets.length === 0) return { ok: false, error: "送信対象がありません（メールなし/停止済み/送信済みを除外した結果0件）", batchId: opts?.batchId };
  const batch = r.targets.slice(0, Math.min(Math.max(1, batchSize), 50));

  // セグメント履歴: 初回チャンクで作成(タイトル未指定は自動命名)。継続チャンクは同じ行へ積む
  let batchId = opts?.batchId ?? null;
  if (!batchId) {
    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const autoTitle = `${filters.leadIds?.length ? "個別選択" : filters.event || "全体"} ${jstNow.toISOString().slice(5, 16).replace("-", "/").replace("T", " ")}`;
    const { data: b } = await sb.from("lead_mail_batches").insert({
      tenant_id: ctx.tenantId,
      title: (opts?.segmentTitle ?? "").trim().slice(0, 100) || autoTitle,
      template_id: templateId,
      filters: { q: filters.q ?? null, event: filters.event ?? null, disposition: filters.disposition ?? null, ranks: filters.ranks ?? null, leadIds: filters.leadIds?.length ? filters.leadIds : null },
      sent_by: ctx.userId,
    }).select("id").single();
    batchId = (b?.id as string) ?? null;
  }

  const senderName = (acc.from_name as string) || "";
  let sent = 0;
  const failures: { email: string; error: string }[] = [];
  for (const t of batch) {
    const vars = { contact: t.name, company: t.company, opportunity: "", sender: senderName };
    const res = await deliverTrackedEmail(sb, {
      tenantId: ctx.tenantId, loggedBy: ctx.userId,
      ...authArgs,
      bccSelf: false, // 一括送信でBCC自分は受信箱が溢れるため常時OFF
      to: t.email,
      subject: renderEmailTemplate(subjectTmpl, vars),
      body: renderEmailTemplate(bodyTmpl, vars),
      leadId: t.id, templateId, mailBatchId: batchId,
      createActivity: false,
      unsubscribeFooter: true,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "",
    });
    if (res.ok) sent++;
    else failures.push({ email: t.email, error: res.error });
    if (failures.length >= 10 && sent === 0) break; // 認証・経路異常の早期打切り(全滅を300回繰り返さない)
  }

  // セグメント履歴の件数を積み上げ(単一ユーザー操作のためread-modify-writeで十分)
  if (batchId) {
    const { data: cur } = await sb.from("lead_mail_batches").select("sent_count, failed_count").eq("id", batchId).maybeSingle();
    if (cur) {
      await sb.from("lead_mail_batches").update({
        sent_count: (cur.sent_count as number) + sent,
        failed_count: (cur.failed_count as number) + failures.length,
      }).eq("id", batchId);
    }
  }

  await logAudit({
    tenantId: ctx.tenantId, userId: ctx.userId, action: "mail.bulk_send",
    target: `template:${templateId}`,
    meta: { sent, failed: failures.length, filters: { ...filters }, suppressed: r.suppressed, already_sent: r.alreadySent },
    ip: clientIp(),
  });
  revalidatePath("/app/leads");
  revalidatePath("/app/email/history");
  return {
    ok: true, sent, failed: failures.length, failures: failures.slice(0, 10),
    skipped: { suppressed: r.suppressed, alreadySent: r.alreadySent, noEmail: r.noEmail },
    batchId: batchId ?? undefined,
  };
}
