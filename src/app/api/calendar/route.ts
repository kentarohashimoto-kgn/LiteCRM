import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * D-2 カレンダー連携v1: アポ(時刻付き案件)のICSフィード。
 * Googleカレンダーの「URLで追加」に
 *   https://<APP>/api/calendar?token=<CALENDAR_FEED_TOKEN>[&owner=<uuid>]
 * を登録すると、CRMのアポが自動反映される(GCal側が定期取得・一方向同期)。
 *
 * 認可: CALENDAR_FEED_TOKEN(未設定なら無効)。ownerで担当者を絞り込み可能。
 */
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function GET(req: Request) {
  const secret = process.env.CALENDAR_FEED_TOKEN;
  const url = new URL(req.url);
  if (!secret || url.searchParams.get("token") !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const owner = url.searchParams.get("owner");

  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();
  let q = admin
    .from("opportunities")
    .select("id, name, appointment_at, owner_user_id, accounts(name)")
    .not("appointment_at", "is", null)
    .is("deleted_at", null)
    .gte("appointment_at", since)
    .lte("appointment_at", until)
    .limit(500);
  if (owner) q = q.eq("owner_user_id", owner);
  const { data } = await q;

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    appointment_at: string;
    owner_user_id: string | null;
    accounts: { name: string } | null;
  }[];
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_user_id).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await admin.from("profiles").select("id, display_name, email").in("id", ownerIds);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string) || "");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://litecrm.vercel.app";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CATORCE Sales OS//appointments//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CATORCE アポ",
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];
  for (const r of rows) {
    const start = new Date(r.appointment_at);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 既定60分
    const ownerName = r.owner_user_id ? names.get(r.owner_user_id) ?? "" : "";
    const title = `アポ: ${r.accounts?.name ? `${r.accounts.name}｜` : ""}${r.name}${ownerName ? `（${ownerName}）` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:opp-${r.id}@catorce-sales-os`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(`${appUrl}/app/opportunities/${r.id}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="catorce-appointments.ics"',
    },
  });
}
