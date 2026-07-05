import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * 毎朝のSlackダイジェスト(Vercel Cronから起動)。
 * 担当別に「今日のアポ／今日の次回AC／期限超過」を集計してSlack Webhookへ送信。
 * あわせてゴミ箱の30日超過レコードを自動パージする(B-2)。
 * 必要な環境変数: CRON_SECRET(認可), SLACK_WEBHOOK_URL(送信先)。未設定なら送信はしない。
 */
export async function GET(req: Request) {
  // Vercel Cron は Authorization: Bearer <CRON_SECRET> を付与する
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // ゴミ箱: 削除から30日を過ぎたレコードを完全削除(失敗しても他処理は続行)
  let purged: unknown = null;
  try {
    const { data } = await admin.rpc("trash_purge_expired");
    purged = data;
  } catch {
    purged = "error";
  }

  // 古いアプリ内通知の掃除(60日超)
  try {
    await admin.from("notifications").delete().lt("created_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString());
  } catch {
    /* 失敗しても他処理は続行 */
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  // JSTの「今日」
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const today = now.toISOString().slice(0, 10);
  const label = `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;

  const [profilesR, oppsR, schedR] = await Promise.all([
    admin.from("profiles").select("id,display_name,email"),
    admin
      .from("opportunities")
      .select("owner_user_id,account_id,name,yomi,status,next_action_date,next_action_text,first_meeting_date,appointment_at,proposal_required,proposal_status,proposal_due_date")
      .eq("status", "open")
      .is("deleted_at", null), // service roleはRLSを通らないため明示的に除外
    admin.from("sales_schedules").select("id,approval_status").in("approval_status", ["pending", "needs_revision"]),
  ]);

  const nameOf = new Map((profilesR.data ?? []).map((p) => [p.id as string, (p.display_name as string) ?? (p.email as string) ?? "—"]));
  const accIds = Array.from(new Set((oppsR.data ?? []).map((o) => o.account_id).filter(Boolean))) as string[];
  const accNames = new Map<string, string>();
  if (accIds.length) {
    const { data: accs } = await admin.from("accounts").select("id,name").in("id", accIds.slice(0, 500));
    for (const a of accs ?? []) accNames.set(a.id as string, a.name as string);
  }

  interface Row { appts: string[]; acs: string[]; overdue: number; proposals: string[]; }
  const byOwner = new Map<string, Row>();
  const ensure = (uid: string) => {
    let r = byOwner.get(uid);
    if (!r) { r = { appts: [], acs: [], overdue: 0, proposals: [] }; byOwner.set(uid, r); }
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
    // 提案書の提出期限(未提出のみ): 期日3日以内 or 超過
    const pd = o.proposal_due_date as string | null;
    if (o.proposal_required && o.proposal_status !== "submitted" && pd) {
      const in3days = new Date(new Date(today).getTime() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      if (pd <= in3days) ensure(uid).proposals.push(`${acc}(${pd}${pd < today ? "超過" : ""})`);
    }
  }

  const lines: string[] = [`:sunny: *CATORCE 今日の営業ダイジェスト（${label}）*`];
  const owners = Array.from(byOwner.entries()).filter(([, r]) => r.appts.length || r.acs.length || r.overdue || r.proposals.length);
  if (owners.length === 0) {
    lines.push("今日のアポ・次回ACはありません。");
  } else {
    for (const [uid, r] of owners) {
      const parts: string[] = [];
      if (r.appts.length) parts.push(`アポ ${r.appts.length}件（${r.appts.slice(0, 3).join(" / ")}${r.appts.length > 3 ? " 他" : ""}）`);
      if (r.acs.length) parts.push(`今日のAC ${r.acs.length}件`);
      if (r.overdue) parts.push(`:warning: 超過AC ${r.overdue}件`);
      if (r.proposals.length) parts.push(`:memo: 提案書の期日 ${r.proposals.length}件（${r.proposals.slice(0, 2).join(" / ")}${r.proposals.length > 2 ? " 他" : ""}）`);
      lines.push(`• *${nameOf.get(uid) ?? "未割当"}*: ${parts.join(" ・ ")}`);
    }
  }
  const pending = (schedR.data ?? []).length;
  if (pending) lines.push(`:bookmark_tabs: 承認待ちのスケジュール分類: *${pending}件*（経営レビューで確認）`);
  lines.push(`<${process.env.NEXT_PUBLIC_APP_URL ?? "https://litecrm.vercel.app"}/app/dashboard|ダッシュボードを開く>`);

  // A-1: 担当者ごとのアプリ内ダイジェスト通知(Slack未設定でも届く)
  let notified = 0;
  if (owners.length > 0) {
    try {
      const { data: tenant } = await admin.from("tenants").select("id").limit(1).maybeSingle();
      if (tenant) {
        const rows = owners
          .filter(([uid]) => uid)
          .map(([uid, r]) => {
            const parts: string[] = [];
            if (r.appts.length) parts.push(`アポ ${r.appts.length}件（${r.appts.slice(0, 3).join(" / ")}${r.appts.length > 3 ? " 他" : ""}）`);
            if (r.acs.length) parts.push(`今日のAC ${r.acs.length}件（${r.acs.slice(0, 3).join(" / ")}${r.acs.length > 3 ? " 他" : ""}）`);
            if (r.overdue) parts.push(`超過AC ${r.overdue}件`);
            if (r.proposals.length) parts.push(`提案書の期日 ${r.proposals.length}件（${r.proposals.slice(0, 2).join(" / ")}${r.proposals.length > 2 ? " 他" : ""}）`);
            return {
              tenant_id: tenant.id as string,
              user_id: uid,
              kind: "digest",
              title: `今日の営業ダイジェスト（${label}）`,
              body: parts.join("\n"),
              href: "/app/today",
            };
          });
        if (rows.length > 0) {
          const { error } = await admin.from("notifications").insert(rows);
          if (!error) notified = rows.length;
        }
      }
    } catch {
      /* 通知失敗は無視 */
    }
  }

  if (!webhook) {
    return NextResponse.json({ ok: true, owners: owners.length, pending, purged, notified, skipped: "SLACK_WEBHOOK_URL not configured" });
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });

  return NextResponse.json({ ok: res.ok, owners: owners.length, pending, purged, notified });
}
