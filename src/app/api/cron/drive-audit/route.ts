import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { getActiveConnection } from "@/lib/storage/connections";
import { listPermissions, listFolderChildren, resolveAuditDrives, type DrivePermission } from "@/lib/storage/gdrive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * P2 ドライブ権限監査(夜間)。共有ドライブと案件フォルダの実際の権限を取得して
 * スナップショット化し、CRMの在籍情報・NDA台帳と突合して要対応事項を検出する。
 * 「人が思い出す棚卸し」を「レポートを承認する作業」に置き換えるのが目的。
 * 設計: docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §3.6
 * 認可: Bearer CRON_SECRET。
 */

/** 社内ドメイン(ここに属さないアドレス=外部委託/パートナーとしてNDA照合の対象)。 */
const INTERNAL_DOMAINS = ["catorce.jp"];

function domainOf(email: string | null): string {
  return (email ?? "").split("@")[1]?.toLowerCase() ?? "";
}
function isInternal(email: string | null, extra: string[]): boolean {
  const d = domainOf(email);
  return [...INTERNAL_DOMAINS, ...extra].includes(d);
}

interface Finding {
  kind: string;
  severity: "info" | "warn" | "high";
  scopeId: string;
  scopeName: string;
  email: string;
  detail: string;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });

  const admin = getSupabaseAdmin();
  const { data: conns } = await admin
    .from("tenant_storage_connections")
    .select("tenant_id")
    .eq("provider", "gdrive")
    .eq("status", "active");
  const tenants = Array.from(new Set(((conns ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)));
  if (tenants.length === 0) return NextResponse.json({ ok: true, note: "接続なし", scanned: 0 });

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let scanned = 0, findingCount = 0, notified = 0;

  for (const tenantId of tenants) {
    const conn = await getActiveConnection(tenantId, "gdrive");
    if (!conn) continue;
    const extraInternal = (conn.config?.internalDomains as string[] | undefined) ?? ["mail.catorce.jp"];

    // --- 突合材料: 在籍メンバーのメール / NDA台帳 / 前回スナップショット ---
    const [{ data: profiles }, { data: agreements }, { data: prevRows }] = await Promise.all([
      admin.from("profiles").select("id, email").not("email", "is", null),
      admin.from("external_agreements").select("email, expires_on, status").eq("tenant_id", tenantId),
      admin
        .from("drive_permission_snapshots")
        .select("scope_id, email, taken_on")
        .eq("tenant_id", tenantId)
        .lt("taken_on", today)
        .order("taken_on", { ascending: false })
        .limit(2000),
    ]);
    const { data: memberIds } = await admin.from("memberships").select("user_id").eq("tenant_id", tenantId).eq("status", "active");
    const activeUserIds = new Set(((memberIds ?? []) as { user_id: string }[]).map((m) => m.user_id));
    const memberEmails = new Set(
      ((profiles ?? []) as { id: string; email: string }[])
        .filter((p) => activeUserIds.has(p.id))
        .map((p) => p.email.toLowerCase()),
    );
    const ndaByEmail = new Map(
      ((agreements ?? []) as { email: string; expires_on: string | null; status: string }[]).map((a) => [a.email.toLowerCase(), a]),
    );
    const prevKeys = new Set(((prevRows ?? []) as { scope_id: string; email: string | null }[]).map((r) => `${r.scope_id}|${(r.email ?? "").toLowerCase()}`));
    const hadPrevSnapshot = (prevRows ?? []).length > 0;

    const snapshotRows: Record<string, unknown>[] = [];
    const findings: Finding[] = [];

    const scan = async (scopeKind: "drive" | "folder", scopeId: string, scopeName: string, boIsolated: boolean) => {
      const res = await listPermissions(conn, scopeId);
      if (!res.ok) return;
      scanned++;
      for (const p of res.permissions as DrivePermission[]) {
        const email = (p.email ?? "").toLowerCase();
        snapshotRows.push({
          tenant_id: tenantId, taken_on: today, scope_kind: scopeKind, scope_id: scopeId, scope_name: scopeName,
          permission_id: p.permissionId, grantee_type: p.granteeType, email: p.email, role: p.role, is_deleted: p.deleted,
        });

        // 1) 削除済みアカウントの権限が残っている
        if (p.deleted) {
          findings.push({ kind: "deleted_account", severity: "high", scopeId, scopeName, email, detail: `削除済みアカウントに ${p.role} 権限が残っています` });
          continue;
        }
        if (p.granteeType === "anyone") {
          findings.push({ kind: "direct_grant", severity: "high", scopeId, scopeName, email: "anyone", detail: "リンクを知る全員に公開されています" });
          continue;
        }
        if (p.granteeType === "domain" || !email) continue;

        const internal = isInternal(email, extraInternal);

        // 2) BOドライブへの侵入(営業・外部は入れてはいけない)
        if (boIsolated && p.granteeType === "group" && !email.startsWith("backoffice@")) {
          findings.push({ kind: "bo_intrusion", severity: "high", scopeId, scopeName, email, detail: "機微情報ドライブに backoffice 以外のグループ権限があります" });
        }
        if (boIsolated && p.granteeType === "user" && !internal) {
          findings.push({ kind: "bo_intrusion", severity: "high", scopeId, scopeName, email, detail: "機微情報ドライブに外部アドレスの権限があります" });
        }

        // 3) 外部アドレスのNDA未締結/期限切れ
        if (!internal && p.granteeType === "user") {
          const nda = ndaByEmail.get(email);
          if (!nda || nda.status !== "active") {
            findings.push({ kind: "no_nda", severity: "warn", scopeId, scopeName, email, detail: "外部アドレスに権限がありますが、NDA台帳に有効な記録がありません" });
          } else if (nda.expires_on && nda.expires_on < today) {
            findings.push({ kind: "no_nda", severity: "warn", scopeId, scopeName, email, detail: `NDAの有効期限が切れています(${nda.expires_on})` });
          }
        }

        // 4) 在籍していない社内アドレスの権限(グループ外しの漏れ)
        if (internal && p.granteeType === "user" && !memberEmails.has(email)) {
          findings.push({ kind: "unknown_member", severity: "warn", scopeId, scopeName, email, detail: "CRMに在籍記録のない社内アドレスに権限があります" });
        }

        // 5) ドライブ本体への個人直付与(グループ経由が原則)
        if (scopeKind === "drive" && p.granteeType === "user" && p.role !== "organizer") {
          findings.push({ kind: "direct_grant", severity: "info", scopeId, scopeName, email, detail: "グループを経由しない個人への直接付与です(棚卸し漏れの原因になります)" });
        }

        // 6) 前日までに存在しなかった外部付与(気づかない共有拡大)
        if (hadPrevSnapshot && !internal && !prevKeys.has(`${scopeId}|${email}`)) {
          findings.push({ kind: "new_external", severity: "warn", scopeId, scopeName, email, detail: "新たに外部アドレスへ権限が付与されました" });
        }
      }
    };

    for (const d of resolveAuditDrives(conn)) {
      await scan("drive", d.id, d.name, d.boIsolated);
      // 案件フォルダ単位の外部共有(パートナー招待)も監査対象
      if (d.scanFolders) {
        const children = await listFolderChildren(conn, d.id, 100);
        if (children.ok) {
          for (const f of children.files.filter((x) => x.mimeType === "application/vnd.google-apps.folder").slice(0, 50)) {
            await scan("folder", f.externalId, `${d.name}/${f.title}`, d.boIsolated);
          }
        }
      }
    }

    if (snapshotRows.length > 0) {
      await admin.from("drive_permission_snapshots").delete().eq("tenant_id", tenantId).eq("taken_on", today);
      await admin.from("drive_permission_snapshots").insert(snapshotRows);
      // 90日より古いスナップショットは掃除(監査証跡は findings 側に残る)
      const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      await admin.from("drive_permission_snapshots").delete().eq("tenant_id", tenantId).lt("taken_on", cutoff);
    }

    // findings は同一事象を1行に集約(last_seen_at のみ更新)
    let newHigh = 0;
    for (const f of findings) {
      const { data: existing } = await admin
        .from("drive_permission_findings")
        .select("id, status")
        .eq("tenant_id", tenantId).eq("kind", f.kind).eq("scope_id", f.scopeId).eq("email", f.email)
        .maybeSingle();
      if (existing) {
        await admin.from("drive_permission_findings").update({ last_seen_at: new Date().toISOString(), detail: f.detail, severity: f.severity }).eq("id", (existing as { id: string }).id);
      } else {
        await admin.from("drive_permission_findings").insert({
          tenant_id: tenantId, kind: f.kind, severity: f.severity, scope_id: f.scopeId,
          scope_name: f.scopeName, email: f.email, detail: f.detail,
        });
        if (f.severity === "high") newHigh++;
      }
      findingCount++;
    }

    // 解消済み(今回検出されなかった open な事項)は自動クローズ
    const seenKeys = new Set(findings.map((f) => `${f.kind}|${f.scopeId}|${f.email}`));
    const { data: openRows } = await admin
      .from("drive_permission_findings")
      .select("id, kind, scope_id, email")
      .eq("tenant_id", tenantId).eq("status", "open").neq("kind", "offboarding");
    for (const r of (openRows ?? []) as { id: string; kind: string; scope_id: string; email: string }[]) {
      if (!seenKeys.has(`${r.kind}|${r.scope_id}|${r.email}`)) {
        await admin.from("drive_permission_findings").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", r.id);
      }
    }

    // 新規の重大事項のみ管理者へ通知(毎晩鳴らさない)
    if (newHigh > 0) {
      const { data: admins } = await admin.from("memberships").select("user_id, role").eq("tenant_id", tenantId).eq("status", "active").in("role", ["owner", "admin"]);
      for (const a of (admins ?? []) as { user_id: string }[]) {
        await admin.from("notifications").insert({
          tenant_id: tenantId, user_id: a.user_id, kind: "system",
          title: `ドライブ権限の要確認が${newHigh}件`,
          body: "削除済みアカウントの残存権限や機微ドライブへの侵入など、重大な検出があります",
          href: "/app/settings/drive-audit",
        });
        notified++;
      }
    }
  }

  return NextResponse.json({ ok: true, scanned, findings: findingCount, notified });
}
