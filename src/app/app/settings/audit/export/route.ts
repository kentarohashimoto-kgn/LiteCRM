import { NextRequest, NextResponse } from "next/server";
import { getCtxOrNull } from "@/lib/session";
import { queryAuditEventsForExport, auditActionLabel } from "@/lib/data/audit-events";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 監査ログのCSV抽出（管理者のみ）。フィルタはクエリ文字列で受ける。 */
export async function GET(req: NextRequest) {
  const ctx = await getCtxOrNull();
  if (!ctx || !["owner", "admin"].includes(ctx.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const clean = (v: string | null) => (v ?? "").trim() || undefined;
  const rows = await queryAuditEventsForExport({
    action: clean(sp.get("action")),
    userId: clean(sp.get("user")),
    from: clean(sp.get("from")),
    to: clean(sp.get("to")),
  });

  // ユーザー名の解決
  const sb = getSupabaseServer();
  const { data: profiles } = await sb.from("profiles").select("id, display_name");
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));

  const header = ["日時", "ユーザー", "メール", "操作", "対象", "詳細", "IP"].map(csvCell).join(",");
  const lines = rows.map((r) =>
    [
      fmtJst(r.created_at),
      (r.user_id && nameById.get(r.user_id)) || "",
      r.actor_email ?? "",
      auditActionLabel(r.action),
      r.target ?? "",
      r.meta && Object.keys(r.meta).length ? JSON.stringify(r.meta) : "",
      r.ip ?? "",
    ].map(csvCell).join(","),
  );
  const csv = "﻿" + [header, ...lines].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit_${stamp}.csv"`,
    },
  });
}
