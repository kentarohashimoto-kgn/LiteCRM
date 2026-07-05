import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * 毎朝のSlackダイジェスト(Vercel Cronから起動)。
 * 担当別に「今日のアポ／今日の次回AC／期限超過」を集計してSlack Webhookへ送信。
 * 必要な環境変数: CRON_SECRET(認可), SLACK_WEBHOOK_URL(送信先)。未設定なら何もしない。
 */
export async function GET(req: Request) {
  // Vercel Cron は Authorization: Bearer <CRON_SECRET> を付与する
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: true, skipped: "SLACK_WEBHOOK_URL not configured" });
  }

  const admin = getSupabaseAdmin();
  // JSTの「今日」
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const today = now.toISOString().slice(0, 10);
  const label = `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;

  const [profilesR, oppsR, schedR] = await Promise.all([
    admin.from("profiles").select("id,display_name,email"),
    admin
      .from("opportunities")
      .select("owner_user_id,account_id,name,yomi,status,next_action_date,next_action_text,first_meeting_date,appointment_at")
      .eq("status", "open"),
    admin.from("sales_schedules").select("id,approval_status").in("approval_status", ["pending", "needs_revision"]),
  ]);

  const nameOf = new Map((profilesR.data ?? []).map((p) => [p.id as string, (p.display_name as string) ?? (p.email as string) ?? "—"]));
  const accIds = Array.from(new Set((oppsR.data ?? []).map((o) => o.account_id).filter(Boolean))) as string[];
  const accNames = new Map<string, string>();
  if (accIds.length) {
    const { data: accs } = await admin.from("accounts").select("id,name").in("id", accIds.slice(0, 500));
    for (const a of accs ?? []) accNames.set(a.id as string, a.name as string);
  }

  interface Row { appts: string[]; acs: string[]; overdue: number; }
  const byOwner = new Map<string, Row>();
  const ensure = (uid: string) => {
    let r = byOwner.get(uid);
    if (!r) { r = { appts: [], acs: [], overdue: 0 }; byOwner.set(uid, r); }
    return r;
  };

  for (const o of oppsR.data ?? []) {
    const uid = (o.owner_user_id as string) ?? "";
    const acc = accNames.get(o.account_id as string) ?? "—";
    // 今日のアポ(初回商談日 or アポ日時が今日)
    const apptDay = o.appointment_at ? new Date(new Date(o.appointment_at as string).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : (o.first_meeting_date as string | null);
    if (apptDay === today && o.yomi === "4.アポ") {
      const hm = o.appointment_at ? new Date(new Date(o.appointment_at as string).getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16) : "終日";
      ensure(uid).appts.push(`${hm} ${acc}`);
    }
    // 今日の次回AC / 期限超過
    const ac = o.next_action_date as string | null;
    if (ac === today) ensure(uid).acs.push(acc);
    else if (ac && ac < today) ensure(uid).overdue += 1;
  }

  const lines: string[] = [`:sunny: *CATORCE 今日の営業ダイジェスト（${label}）*`];
  const owners = Array.from(byOwner.entries()).filter(([, r]) => r.appts.length || r.acs.length || r.overdue);
  if (owners.length === 0) {
    lines.push("今日のアポ・次回ACはありません。");
  } else {
    for (const [uid, r] of owners) {
      const parts: string[] = [];
      if (r.appts.length) parts.push(`アポ ${r.appts.length}件（${r.appts.slice(0, 3).join(" / ")}${r.appts.length > 3 ? " 他" : ""}）`);
      if (r.acs.length) parts.push(`今日のAC ${r.acs.length}件`);
      if (r.overdue) parts.push(`:warning: 超過AC ${r.overdue}件`);
      lines.push(`• *${nameOf.get(uid) ?? "未割当"}*: ${parts.join(" ・ ")}`);
    }
  }
  const pending = (schedR.data ?? []).length;
  if (pending) lines.push(`:bookmark_tabs: 承認待ちのスケジュール分類: *${pending}件*（経営レビューで確認）`);
  lines.push(`<${process.env.NEXT_PUBLIC_APP_URL ?? "https://litecrm.vercel.app"}/app/dashboard|ダッシュボードを開く>`);

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });

  return NextResponse.json({ ok: res.ok, owners: owners.length, pending });
}
