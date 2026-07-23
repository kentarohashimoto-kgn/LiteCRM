import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cardMessage, textMessage } from "./cards";
import type { ChatMessagePayload } from "./client";
import { listTenantMembers } from "./ai-task-parse";

/**
 * P2拡張: 自由文の問いかけに答える読み取り専用クエリ集。
 *   ・明日の商談一覧（meetings + アポ商談）
 *   ・今月成約見込み（成約予定/売上月が今月 × 確度・ヨミ良好）
 *   ・要催促案件（AC期限超過 / 長期間活動なし / 再アプローチ日到来）
 * scope=mine は依頼者の担当分のみ、team は全員分。
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app";
}
function jstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function jstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function yen(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  return `¥${(v || 0).toLocaleString("ja-JP")}`;
}
function md(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

async function ownerNameMap(tenantId: string): Promise<Map<string, string>> {
  const members = await listTenantMembers(tenantId);
  return new Map(members.map((m) => [m.id, m.name.split(" ")[0] || m.name]));
}

/** ① 明日の商談・アポ一覧 */
export async function tomorrowMeetings(
  tenantId: string,
  userId: string,
  scope: "mine" | "team",
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const tomorrow = jstDate(1);
  const names = await ownerNameMap(tenantId);

  // meetings（打合せ予定）
  let mq = admin
    .from("meetings")
    .select("title, meeting_at, meeting_date, owner_user_id, opportunities(name, accounts(name))")
    .eq("tenant_id", tenantId)
    .eq("meeting_date", tomorrow);
  if (scope === "mine") mq = mq.eq("owner_user_id", userId);
  const { data: meetings } = await mq;

  // アポ商談（appointment_at が明日 / 初回商談日が明日）
  let oq = admin
    .from("opportunities")
    .select("name, appointment_at, first_meeting_date, owner_user_id, yomi, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .eq("yomi", "4.アポ");
  if (scope === "mine") oq = oq.eq("owner_user_id", userId);
  const { data: appts } = await oq;

  const items: Array<{ time: string; line: string }> = [];
  for (const m of meetings ?? []) {
    const acc = (m.opportunities as { accounts?: { name?: string } } | null)?.accounts?.name ?? "";
    const time = m.meeting_at
      ? new Date(new Date(m.meeting_at as string).getTime() + 9 * 3600000).toISOString().slice(11, 16)
      : "終日";
    const who = names.get(m.owner_user_id as string) ?? "—";
    items.push({ time, line: `${time} <b>${acc || "—"}</b>｜${m.title}（${who}）` });
  }
  for (const o of appts ?? []) {
    const apptDay = o.appointment_at
      ? new Date(new Date(o.appointment_at as string).getTime() + 9 * 3600000).toISOString().slice(0, 10)
      : (o.first_meeting_date as string | null);
    if (apptDay !== tomorrow) continue;
    const time = o.appointment_at
      ? new Date(new Date(o.appointment_at as string).getTime() + 9 * 3600000).toISOString().slice(11, 16)
      : "終日";
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const who = names.get(o.owner_user_id as string) ?? "—";
    items.push({ time, line: `${time} <b>${acc}</b>｜${o.name}（${who}）` });
  }

  if (items.length === 0) {
    return textMessage(`明日（${md(tomorrow)}）の商談・アポはありません。`);
  }
  items.sort((a, b) => a.time.localeCompare(b.time));
  return cardMessage({
    title: `明日の商談（${md(tomorrow)}）${items.length}件${scope === "mine" ? "・自分" : ""}`,
    lines: items.slice(0, 15).map((i) => i.line),
    buttonText: "カレンダーを開く",
    buttonUrl: `${appUrl()}/app/calendar`,
  });
}

/** ② 今月成約見込みの案件 */
export async function closingThisMonth(
  tenantId: string,
  userId: string,
  scope: "mine" | "team",
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const now = jstNow();
  const ym = now.toISOString().slice(0, 7); // YYYY-MM
  const monthStart = `${ym}-01`;
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
  const names = await ownerNameMap(tenantId);

  let q = admin
    .from("opportunities")
    .select(
      "name, amount, probability, yomi, expected_close_date, expected_revenue_month, owner_user_id, accounts(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .or(
      `and(expected_close_date.gte.${monthStart},expected_close_date.lt.${nextMonth}),` +
        `and(expected_revenue_month.gte.${monthStart},expected_revenue_month.lt.${nextMonth})`,
    );
  if (scope === "mine") q = q.eq("owner_user_id", userId);
  const { data } = await q;

  // 確度が高いもの（A/Bヨミ or 確度50%以上）を優先表示
  const rows = (data ?? [])
    .filter((o) => {
      const yomi = (o.yomi as string | null) ?? "";
      if (/^(7|8)\./.test(yomi)) return false; // オチ/キャンセル除外
      return /^(0|1|2)\./.test(yomi) || ((o.probability as number | null) ?? 0) >= 50;
    })
    .sort((a, b) => ((b.probability as number) ?? 0) - ((a.probability as number) ?? 0) || ((b.amount as number) ?? 0) - ((a.amount as number) ?? 0));

  if (rows.length === 0) {
    return textMessage(`今月（${ym.replace("-", "/")}）成約見込みの高い案件は見つかりませんでした。`);
  }
  const total = rows.reduce((s, o) => s + (((o.amount as number) ?? 0) || 0), 0);
  const lines = rows.slice(0, 10).map((o) => {
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const who = names.get(o.owner_user_id as string) ?? "—";
    const close = (o.expected_close_date as string | null) ?? (o.expected_revenue_month as string | null);
    return `<b>${acc}</b>｜${o.name} — ${yen(o.amount)} / ${o.yomi ?? `${o.probability}%`} / ${close ? md(close) : "—"}（${who}）`;
  });
  if (rows.length > 10) lines.push(`…他 ${rows.length - 10}件`);
  lines.push(`合計見込み: <b>${yen(total)}</b>（${rows.length}件）`);
  return cardMessage({
    title: `今月成約見込み ${rows.length}件${scope === "mine" ? "・自分" : ""}`,
    lines,
    buttonText: "商談一覧を開く",
    buttonUrl: `${appUrl()}/app/opportunities`,
  });
}

/** ③ 催促・フォローが必要な案件 */
export async function needsFollowup(
  tenantId: string,
  userId: string,
  scope: "mine" | "team",
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const today = jstDate(0);
  const staleBefore = new Date(Date.now() - 14 * 86400000).toISOString(); // 14日活動なし
  const names = await ownerNameMap(tenantId);

  let q = admin
    .from("opportunities")
    .select(
      "name, next_action_date, next_action_text, last_activity_at, reapproach_date, yomi, owner_user_id, accounts(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .or(
      `next_action_date.lt.${today},` +
        `reapproach_date.lte.${today},` +
        `and(next_action_date.is.null,last_activity_at.lt.${staleBefore})`,
    );
  if (scope === "mine") q = q.eq("owner_user_id", userId);
  const { data } = await q;

  const rows = (data ?? [])
    .filter((o) => !/^(7|8)\./.test(((o.yomi as string | null) ?? "")))
    .map((o) => {
      const nad = o.next_action_date as string | null;
      const overdue = nad && nad < today ? Math.round((Date.parse(today) - Date.parse(nad)) / 86400000) : 0;
      return { o, overdue };
    })
    .sort((a, b) => b.overdue - a.overdue);

  if (rows.length === 0) {
    return textMessage("催促が必要な案件はありません。よく回っています👏");
  }
  const lines = rows.slice(0, 10).map(({ o, overdue }) => {
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const who = names.get(o.owner_user_id as string) ?? "—";
    const nad = o.next_action_date as string | null;
    let reason: string;
    if (overdue > 0) {
      reason = `AC期限 ${md(nad!)}から<b>${overdue}日超過</b>${o.next_action_text ? `（${o.next_action_text}）` : ""}`;
    } else if (o.reapproach_date && (o.reapproach_date as string) <= today) {
      reason = `再アプローチ日（${md(o.reapproach_date as string)}）到来`;
    } else {
      const days = o.last_activity_at
        ? Math.round((Date.now() - Date.parse(o.last_activity_at as string)) / 86400000)
        : null;
      reason = days ? `最終活動から<b>${days}日</b>経過` : "活動記録なし";
    }
    return `<b>${acc}</b>｜${o.name} — ${reason}（${who}）`;
  });
  if (rows.length > 10) lines.push(`…他 ${rows.length - 10}件`);
  return cardMessage({
    title: `⚠️ 要フォロー ${rows.length}件${scope === "mine" ? "・自分" : ""}`,
    lines,
    buttonText: "商談一覧を開く",
    buttonUrl: `${appUrl()}/app/opportunities`,
  });
}
