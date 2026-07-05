"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "attachments";
const MAX_SIZE = 15 * 1024 * 1024; // 提案書PDFはやや大きめまで許容

export type ProposalStatus = "not_started" | "drafting" | "submitted" | "revising";

export interface ProposalVersionView {
  id: string;
  version: number;
  title: string | null;
  url: string | null;
  file_name: string | null;
  note: string | null;
  submitted_at: string;
  created_by: string | null;
  fileUrl: string | null; // 署名URL(1時間)
}

/** 案件の提案書バージョン一覧(新しい順)＋添付の署名URL。 */
export async function listProposalVersions(opportunityId: string): Promise<ProposalVersionView[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("proposal_versions")
    .select("id, version, title, url, file_name, storage_path, note, submitted_at, created_by")
    .eq("opportunity_id", opportunityId)
    .order("version", { ascending: false });
  const rows = (data ?? []) as (ProposalVersionView & { storage_path: string | null })[];
  const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    try {
      const admin = getSupabaseAdmin();
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
    } catch {
      /* service role未設定ならリンクなしで表示 */
    }
  }
  return rows.map(({ storage_path, ...r }) => ({ ...r, fileUrl: storage_path ? urls.get(storage_path) ?? null : null }));
}

/** 提案書の要否フラグを切り替える(必要にしたら進捗を「未着手」で初期化)。 */
export async function setProposalRequiredAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  const required = String(formData.get("required")) === "1";
  if (required) {
    const { data } = await sb.from("opportunities").select("proposal_status").eq("id", oppId).maybeSingle();
    await sb
      .from("opportunities")
      .update({ proposal_required: true, proposal_status: (data?.proposal_status as string) ?? "not_started" })
      .eq("id", oppId);
  } else {
    await sb
      .from("opportunities")
      .update({ proposal_required: false, proposal_status: null, proposal_due_date: null })
      .eq("id", oppId);
  }
  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/opportunities");
}

/** 提案の進捗・提出期限を更新。 */
export async function updateProposalMetaAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  const status = String(formData.get("proposal_status") || "not_started") as ProposalStatus;
  const due = String(formData.get("proposal_due_date") || "");
  await sb
    .from("opportunities")
    .update({ proposal_status: status, proposal_due_date: due || null })
    .eq("id", oppId);
  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/opportunities");
}

/**
 * 提案書バージョンを追加(URL または ファイルの少なくとも一方)。
 * 版番号は自動採番。追加時に案件の進捗を「提出済み」に更新する。
 */
export async function addProposalVersionAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = String(formData.get("opportunity_id"));
  const title = String(formData.get("title") || "").trim().slice(0, 200);
  const url = String(formData.get("url") || "").trim().slice(0, 1000);
  const note = String(formData.get("note") || "").trim().slice(0, 1000);
  const submittedAt = String(formData.get("submitted_at") || "") || new Date().toISOString().slice(0, 10);
  const file = formData.get("file") as File | null;
  const hasFile = file && file.size > 0;
  if (!url && !hasFile) return;
  if (hasFile && file.size > MAX_SIZE) return;

  // ファイルは非公開バケットへ(署名URLで配布)
  let storagePath: string | null = null;
  let fileName: string | null = null;
  if (hasFile) {
    try {
      const admin = getSupabaseAdmin();
      fileName = file.name.replace(/[\\/]/g, "_").slice(0, 150);
      storagePath = `${ctx.tenantId}/proposal/${oppId}/${randomUUID()}_${fileName}`;
      const buf = Buffer.from(await file.arrayBuffer());
      const { error } = await admin.storage.from(BUCKET).upload(storagePath, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (error) return;
    } catch {
      return; // service role未設定
    }
  }

  const { data: maxRow } = await sb
    .from("proposal_versions")
    .select("version")
    .eq("opportunity_id", oppId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((maxRow?.version as number) ?? 0) + 1;

  const { error: insErr } = await sb.from("proposal_versions").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    version,
    title: title || `提案書 v${version}`,
    url: url || null,
    file_name: fileName,
    storage_path: storagePath,
    note: note || null,
    submitted_at: submittedAt,
    created_by: ctx.userId,
  });
  if (insErr) {
    if (storagePath) {
      try { await getSupabaseAdmin().storage.from(BUCKET).remove([storagePath]); } catch { /* noop */ }
    }
    return;
  }

  // 提出=進捗を「提出済み」へ(フラグも立てる)
  await sb
    .from("opportunities")
    .update({ proposal_required: true, proposal_status: "submitted" })
    .eq("id", oppId);

  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/opportunities");
}

/** 提案書バージョンを削除(作成者 or 管理者。RLSが担保)。 */
export async function deleteProposalVersionAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const oppId = String(formData.get("opportunity_id"));
  const { data: row } = await sb.from("proposal_versions").select("storage_path").eq("id", id).maybeSingle();
  const { error, count } = await sb.from("proposal_versions").delete({ count: "exact" }).eq("id", id);
  if (!error && (count ?? 0) > 0 && row?.storage_path) {
    try { await getSupabaseAdmin().storage.from(BUCKET).remove([row.storage_path as string]); } catch { /* noop */ }
  }
  revalidatePath(`/app/opportunities/${oppId}`);
}

/* ============================================================
 * 提案タブ(案件一覧)用
 * ============================================================ */

export interface ProposalOppRow {
  id: string;
  name: string;
  account_name: string | null;
  yomi: string | null;
  amount: number;
  status: string;
  owner_name: string;
  proposal_status: string | null;
  proposal_due_date: string | null;
  latest: { version: number; title: string | null; url: string | null; fileUrl: string | null; submitted_at: string } | null;
}

/** 提案書が必要な案件の一覧＋最新提出バージョン。 */
export async function fetchProposalOppsAction(): Promise<ProposalOppRow[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data: opps } = await sb
    .from("opportunities")
    .select("id, name, yomi, amount, status, proposal_status, proposal_due_date, owner_user_id, accounts(name)")
    .eq("proposal_required", true)
    .order("proposal_due_date", { ascending: true, nullsFirst: false })
    .limit(500);
  const rows = (opps ?? []) as unknown as {
    id: string; name: string; yomi: string | null; amount: number; status: string;
    proposal_status: string | null; proposal_due_date: string | null;
    owner_user_id: string | null; accounts: { name: string } | null;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [{ data: versions }, { data: profs }] = await Promise.all([
    sb
      .from("proposal_versions")
      .select("opportunity_id, version, title, url, storage_path, submitted_at")
      .in("opportunity_id", ids)
      .order("version", { ascending: false }),
    sb.from("profiles").select("id, display_name, email").in("id", rows.map((r) => r.owner_user_id).filter(Boolean) as string[]),
  ]);
  const nameOf = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || "—"]));

  // 案件ごとの最新版(version降順で最初に出たもの)
  const latestByOpp = new Map<string, { version: number; title: string | null; url: string | null; storage_path: string | null; submitted_at: string }>();
  for (const v of (versions ?? []) as { opportunity_id: string; version: number; title: string | null; url: string | null; storage_path: string | null; submitted_at: string }[]) {
    if (!latestByOpp.has(v.opportunity_id)) latestByOpp.set(v.opportunity_id, v);
  }

  // 最新版の添付に署名URL
  const paths = Array.from(latestByOpp.values()).map((v) => v.storage_path).filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    try {
      const admin = getSupabaseAdmin();
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
    } catch {
      /* noop */
    }
  }

  return rows.map((r) => {
    const lv = latestByOpp.get(r.id);
    return {
      id: r.id,
      name: r.name,
      account_name: r.accounts?.name ?? null,
      yomi: r.yomi,
      amount: r.amount,
      status: r.status,
      owner_name: r.owner_user_id ? nameOf.get(r.owner_user_id) ?? "—" : "—",
      proposal_status: r.proposal_status,
      proposal_due_date: r.proposal_due_date,
      latest: lv
        ? { version: lv.version, title: lv.title, url: lv.url, fileUrl: lv.storage_path ? urls.get(lv.storage_path) ?? null : null, submitted_at: lv.submitted_at }
        : null,
    };
  });
}
