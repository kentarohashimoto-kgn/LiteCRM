"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, clientIp } from "@/lib/audit-events";
import { OFFBOARDING_ITEMS } from "@/lib/offboarding";

/**
 * P2 ドライブ権限ガバナンスの参照・操作(owner/admin のみ。RLSでも担保)。
 * 検出事項の確認/解決、NDA台帳の管理、オフボーディング・チェックリストの消込。
 */

export interface FindingRow {
  id: string;
  kind: string;
  severity: string;
  scope_name: string | null;
  email: string | null;
  detail: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AgreementRow {
  id: string;
  email: string;
  display_name: string | null;
  kind: string;
  signed_on: string | null;
  expires_on: string | null;
  status: string;
}

export interface ChecklistItem { key: string; label: string; done: boolean; done_at?: string | null }
export interface ChecklistRow {
  id: string;
  target_email: string | null;
  target_name: string | null;
  items: ChecklistItem[];
  status: string;
  created_at: string;
}

/** メンバー削除時に呼ばれる。チェックリスト作成+管理者への通知。 */
export async function createOffboardingChecklist(
  tenantId: string,
  actorUserId: string,
  email: string | null,
  name: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: created } = await admin
    .from("offboarding_checklists")
    .insert({
      tenant_id: tenantId,
      target_email: email,
      target_name: name,
      items: OFFBOARDING_ITEMS.map((i) => ({ ...i, done: false, done_at: null })),
      created_by: actorUserId,
    })
    .select("id")
    .maybeSingle();

  const { data: admins } = await admin
    .from("memberships").select("user_id")
    .eq("tenant_id", tenantId).eq("status", "active").in("role", ["owner", "admin"]);
  for (const a of (admins ?? []) as { user_id: string }[]) {
    await admin.from("notifications").insert({
      tenant_id: tenantId, user_id: a.user_id, kind: "system",
      title: `退任処理の未完了: ${name ?? email ?? "メンバー"}`,
      body: "ドライブ権限・メール接続の剥奪チェックリストが未完了です",
      href: "/app/settings/drive-audit",
    });
  }
  // 監査画面に「未完了」として並ぶよう finding にも計上
  if (created) {
    await admin.from("drive_permission_findings").upsert({
      tenant_id: tenantId, kind: "offboarding", severity: "warn",
      scope_id: (created as { id: string }).id, scope_name: "退任処理",
      email: email ?? "", detail: `${name ?? email ?? "メンバー"} の権限剥奪チェックリストが未完了です`,
    }, { onConflict: "tenant_id,kind,scope_id,email" });
  }
}

/** 監査ダッシュボード用のデータ取得。 */
export async function fetchDriveAudit(): Promise<{
  findings: FindingRow[];
  agreements: AgreementRow[];
  checklists: ChecklistRow[];
  lastScan: string | null;
}> {
  await requireCtx();
  const sb = getSupabaseServer();
  const [f, a, c, s] = await Promise.all([
    sb.from("drive_permission_findings")
      .select("id, kind, severity, scope_name, email, detail, status, first_seen_at, last_seen_at")
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("last_seen_at", { ascending: false })
      .limit(200),
    sb.from("external_agreements").select("id, email, display_name, kind, signed_on, expires_on, status").order("created_at", { ascending: false }).limit(100),
    sb.from("offboarding_checklists").select("id, target_email, target_name, items, status, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(20),
    sb.from("drive_permission_snapshots").select("taken_on").order("taken_on", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    findings: (f.data ?? []) as FindingRow[],
    agreements: (a.data ?? []) as AgreementRow[],
    checklists: (c.data ?? []) as ChecklistRow[],
    lastScan: (s.data as { taken_on: string } | null)?.taken_on ?? null,
  };
}

/** 検出事項を「確認済み/対応済み」にする。 */
export async function resolveFindingAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const id = String(formData.get("id"));
  const sb = getSupabaseServer();
  await sb.from("drive_permission_findings")
    .update({ status: "resolved", resolved_by: ctx.userId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "drive.finding.resolve", target: id, ip: await clientIp() });
  revalidatePath("/app/settings/drive-audit");
}

/** NDA台帳に追加/更新。 */
export async function saveAgreementAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;
  const sb = getSupabaseServer();
  await sb.from("external_agreements").upsert({
    tenant_id: ctx.tenantId,
    email,
    display_name: String(formData.get("display_name") || "") || null,
    kind: String(formData.get("kind") || "NDA"),
    signed_on: String(formData.get("signed_on") || "") || null,
    expires_on: String(formData.get("expires_on") || "") || null,
    note: String(formData.get("note") || "") || null,
    status: "active",
    created_by: ctx.userId,
  }, { onConflict: "tenant_id,email,kind" });
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "nda.upsert", target: email, ip: await clientIp() });
  revalidatePath("/app/settings/drive-audit");
}

/** NDA記録を終了(解約)にする。 */
export async function terminateAgreementAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id"));
  const sb = getSupabaseServer();
  await sb.from("external_agreements").update({ status: "terminated" }).eq("id", id);
  revalidatePath("/app/settings/drive-audit");
}

/** オフボーディング項目のチェック消込。全項目完了で done。 */
export async function toggleOffboardingItemAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const id = String(formData.get("id"));
  const key = String(formData.get("key"));
  const sb = getSupabaseServer();
  const { data } = await sb.from("offboarding_checklists").select("items, target_email").eq("id", id).maybeSingle();
  if (!data) return;
  const row = data as { items: ChecklistItem[]; target_email: string | null };
  const items = row.items.map((i) => (i.key === key ? { ...i, done: !i.done, done_at: !i.done ? new Date().toISOString() : null } : i));
  const allDone = items.every((i) => i.done);
  await sb.from("offboarding_checklists").update({ items, status: allDone ? "done" : "open" }).eq("id", id);
  if (allDone) {
    // 対応する finding もクローズ
    await getSupabaseAdmin().from("drive_permission_findings")
      .update({ status: "resolved", resolved_by: ctx.userId, resolved_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId).eq("kind", "offboarding").eq("scope_id", id);
  }
  revalidatePath("/app/settings/drive-audit");
}
