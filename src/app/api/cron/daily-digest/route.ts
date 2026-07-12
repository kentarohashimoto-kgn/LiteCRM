import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * 毎朝のSlackダイジェスト(Vercel Cronから起動)。
 * 担当別に「今日のアポ／今日の次回AC／期限超過」を集計してSlack Webhookへ送信。
 * あわせてゴミ箱の30日超過レコードを自動パージする(B-2)。
 * 必要な環境変数: CRON_SECRET(認可), SLACK_WEBHOOK_URL(送信先)。未設定なら送信はしない。
 */
export async function GET(req: Request) {
  // Vercel Cron は Authorization: Bearer <CRON_SECRET> を付与する
  // fail-closed: CRON_SECRET 未設定なら拒否(監査2026-07-12。従来は未設定時に素通しで、
  // trash_purge(物理削除)等を無認可で叩けた)
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) {
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

  // BO期日チェック(助成金マイルストーン/展示会タスク): 3日以内・超過を担当者(なければBOメンバー全員)へ通知
  let boNotified = 0;
  try {
    const in3 = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const [{ data: tenant }, msR, taskR, fuR, boMembersR] = await Promise.all([
      admin.from("tenants").select("id").limit(1).maybeSingle(),
      admin
        .from("subsidy_milestones")
        .select("label, due_date, subsidy_cases(account_name, training_name, assignee_user_id, status)")
        .eq("status", "todo")
        .lte("due_date", in3),
      admin
        .from("expo_tasks")
        .select("name, due_date, assignee_user_id, expo_projects(name, status)")
        .in("status", ["todo", "doing"])
        .lte("due_date", in3),
      admin
        .from("fu_meetings")
        .select("round_months, due_date, schedule_status, fu_cases(account_name, assignee_user_id, status)")
        .in("schedule_status", ["not_scheduled", "scheduled"])
        .lte("due_date", in3),
      admin.from("memberships").select("user_id").eq("status", "active").in("role", ["back_office", "hr", "owner", "admin"]),
    ]);
    const boUsers = (boMembersR.data ?? []).map((m) => m.user_id as string);
    const byUser = new Map<string, string[]>();
    const push = (uid: string | null, line: string) => {
      const targets = uid ? [uid] : boUsers;
      for (const u of targets) {
        const arr = byUser.get(u) ?? [];
        arr.push(line);
        byUser.set(u, arr);
      }
    };
    for (const m of (msR.data ?? []) as unknown as { label: string; due_date: string; subsidy_cases: { account_name: string; training_name: string; assignee_user_id: string | null; status: string } | null }[]) {
      if (m.subsidy_cases?.status !== "open") continue;
      push(m.subsidy_cases?.assignee_user_id ?? null, `助成金: ${m.subsidy_cases?.account_name ?? ""} ${m.label}（期日 ${m.due_date}${m.due_date < today ? " 超過" : ""}）`);
    }
    for (const t of (taskR.data ?? []) as unknown as { name: string; due_date: string; assignee_user_id: string | null; expo_projects: { name: string; status: string } | null }[]) {
      if (t.expo_projects?.status !== "confirmed") continue;
      push(t.assignee_user_id, `展示会: ${t.expo_projects?.name ?? ""}｜${t.name}（期日 ${t.due_date}${t.due_date < today ? " 超過" : ""}）`);
    }
    for (const f of (fuR.data ?? []) as unknown as { round_months: number; due_date: string; schedule_status: string; fu_cases: { account_name: string; assignee_user_id: string | null; status: string } | null }[]) {
      if (f.fu_cases?.status !== "open") continue;
      push(f.fu_cases?.assignee_user_id ?? null, `研修後FU: ${f.fu_cases?.account_name ?? ""} ${f.round_months}ヶ月後Mtg${f.schedule_status === "not_scheduled" ? "・未調整" : ""}（期日 ${f.due_date}${f.due_date < today ? " 超過" : ""}）`);
    }
    if (tenant && byUser.size > 0) {
      const rows = Array.from(byUser.entries()).map(([uid, lines2]) => ({
        tenant_id: tenant.id as string,
        user_id: uid,
        kind: "bo_due",
        title: `バックオフィスの期日（3日以内/超過 ${lines2.length}件）`,
        body: lines2.slice(0, 8).join("\n") + (lines2.length > 8 ? `\n他${lines2.length - 8}件` : ""),
        href: "/app/bo",
      }));
      const { error } = await admin.from("notifications").insert(rows);
      if (!error) boNotified = rows.length;
    }
  } catch {
    /* BO通知失敗は無視 */
  }

  if (!webhook) {
    return NextResponse.json({ ok: true, owners: owners.length, pending, purged, notified, boNotified, skipped: "SLACK_WEBHOOK_URL not configured" });
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });

  return NextResponse.json({ ok: res.ok, owners: owners.length, pending, purged, notified, boNotified });
}
