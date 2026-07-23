import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cardMessage, textMessage } from "./cards";
import type { ChatMessagePayload } from "./client";
import { listTenantMembers } from "./ai-task-parse";

/**
 * P2拡張: 自由文の問いかけに答える読み取り専用クエリ集。
 *   ・商談/アポ一覧（任意期間・時刻順 or 担当者別・メンバー絞り込み）
 *   ・成約見込み案件（任意の月）
 *   ・要催促案件（AC期限超過 / 長期間活動なし / 再アプローチ日到来）
 */

export interface InsightFilter {
  /** 特定メンバーに絞る場合そのuser_id（scope=mine時は依頼者自身） */
  memberId: string | null;
  memberLabel: string | null; // カード見出し用（「・村上」等）
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app";
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
function jstDayOf(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function jstTimeOf(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 3600000).toISOString().slice(11, 16);
}
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
function mdw(d: string): string {
  const w = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
  return `${md(d)}(${w})`;
}

async function ownerNameMap(tenantId: string): Promise<Map<string, string>> {
  const members = await listTenantMembers(tenantId);
  return new Map(members.map((m) => [m.id, m.name.split(" ")[0] || m.name]));
}

/** 商談・アポ一覧（期間指定、時刻順 or 担当者別） */
export async function meetingsList(
  tenantId: string,
  opts: {
    start: string;
    end: string;
    groupBy: "time" | "owner";
    filter: InsightFilter;
  },
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const { start, end, groupBy, filter } = opts;
  const names = await ownerNameMap(tenantId);
  const multiDay = start !== end;

  // meetings（打合せ予定）
  let mq = admin
    .from("meetings")
    .select("title, meeting_at, meeting_date, owner_user_id, opportunities(name, accounts(name))")
    .eq("tenant_id", tenantId)
    .gte("meeting_date", start)
    .lte("meeting_date", end);
  if (filter.memberId) mq = mq.eq("owner_user_id", filter.memberId);
  const { data: meetings } = await mq;

  // アポ商談（appointment_at / 初回商談日 が期間内）
  let oq = admin
    .from("opportunities")
    .select("name, appointment_at, first_meeting_date, owner_user_id, yomi, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .eq("yomi", "4.アポ");
  if (filter.memberId) oq = oq.eq("owner_user_id", filter.memberId);
  const { data: appts } = await oq;

  interface Item {
    day: string;
    time: string;
    owner: string;
    body: string;
  }
  const items: Item[] = [];
  // 同一アポの二重表示防止: 打合せ予定と商談側アポの両方に記録されるため、
  // 「日付＋時刻＋取引先」で重複排除する（打合せ予定を優先し、案件名は行に統合）。
  const seen = new Set<string>();
  const dedupeKey = (day: string, time: string, acc: string) => `${day}|${time}|${acc}`;
  // 取引先名の重複を除いた案件名（「◯◯株式会社 / AI研修」→「AI研修」）
  const cleanOppName = (oppName: string | null | undefined, acc: string): string => {
    if (!oppName) return "";
    return oppName
      .replace(acc, "")
      .replace(/^[\s/／・|｜-]+|[\s/／・|｜-]+$/g, "")
      .trim();
  };

  for (const m of meetings ?? []) {
    const opp = m.opportunities as { name?: string; accounts?: { name?: string } } | null;
    const acc = opp?.accounts?.name ?? "—";
    const day = m.meeting_date as string;
    const time = m.meeting_at ? jstTimeOf(m.meeting_at as string) : "終日";
    seen.add(dedupeKey(day, time, acc));
    const title = m.title as string;
    const extra = cleanOppName(opp?.name, acc);
    const label = extra && !title.includes(extra) ? `${title} / ${extra}` : title;
    items.push({
      day,
      time,
      owner: names.get(m.owner_user_id as string) ?? "—",
      body: `<b>${acc}</b>｜${label}`,
    });
  }
  for (const o of appts ?? []) {
    const day = o.appointment_at ? jstDayOf(o.appointment_at as string) : (o.first_meeting_date as string | null);
    if (!day || day < start || day > end) continue;
    const time = o.appointment_at ? jstTimeOf(o.appointment_at as string) : "終日";
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    if (seen.has(dedupeKey(day, time, acc))) continue; // 打合せ予定側に既にある
    seen.add(dedupeKey(day, time, acc));
    items.push({
      day,
      time,
      owner: names.get(o.owner_user_id as string) ?? "—",
      body: `<b>${acc}</b>｜${cleanOppName(o.name as string, acc) || (o.name as string)}`,
    });
  }

  const rangeLabel = multiDay ? `${mdw(start)}〜${mdw(end)}` : mdw(start);
  if (items.length === 0) {
    return textMessage(`${rangeLabel} の商談・アポはありません${filter.memberLabel ? `（${filter.memberLabel}）` : ""}。`);
  }
  items.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));

  let lines: string[];
  if (groupBy === "owner") {
    // 担当者別: ◆担当名 の見出しの下に日時順で列挙
    const byOwner = new Map<string, Item[]>();
    for (const it of items) {
      const arr = byOwner.get(it.owner) ?? [];
      arr.push(it);
      byOwner.set(it.owner, arr);
    }
    lines = [];
    const owners = [...byOwner.keys()].sort((a, b) => (byOwner.get(b)!.length - byOwner.get(a)!.length));
    for (const owner of owners) {
      const list = byOwner.get(owner)!;
      lines.push(`◆ <b>${owner}</b>（${list.length}件）`);
      for (const it of list.slice(0, 8)) {
        lines.push(`　${multiDay ? `${mdw(it.day)} ` : ""}${it.time} ${it.body}`);
      }
      if (list.length > 8) lines.push(`　…他 ${list.length - 8}件`);
    }
  } else {
    lines = items.slice(0, 20).map(
      (it) => `${multiDay ? `${mdw(it.day)} ` : ""}${it.time} ${it.body}（${it.owner}）`,
    );
    if (items.length > 20) lines.push(`…他 ${items.length - 20}件`);
  }

  return cardMessage({
    title: `商談・アポ ${rangeLabel} ${items.length}件${filter.memberLabel ? `・${filter.memberLabel}` : ""}`,
    lines,
    buttonText: "カレンダーを開く",
    buttonUrl: `${appUrl()}/app/calendar`,
  });
}

/** 成約見込みの案件（対象月指定） */
export async function closingDeals(
  tenantId: string,
  opts: { month: string; filter: InsightFilter }, // month: YYYY-MM
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const { month, filter } = opts;
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
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
  if (filter.memberId) q = q.eq("owner_user_id", filter.memberId);
  const { data } = await q;

  const rows = (data ?? [])
    .filter((o) => {
      const yomi = (o.yomi as string | null) ?? "";
      if (/^(7|8)\./.test(yomi)) return false;
      return /^(0|1|2)\./.test(yomi) || ((o.probability as number | null) ?? 0) >= 50;
    })
    .sort(
      (a, b) =>
        (((b.probability as number) ?? 0) - ((a.probability as number) ?? 0)) ||
        (((b.amount as number) ?? 0) - ((a.amount as number) ?? 0)),
    );

  const label = `${y}/${m}`;
  if (rows.length === 0) {
    return textMessage(`${label} 成約見込みの高い案件は見つかりませんでした${filter.memberLabel ? `（${filter.memberLabel}）` : ""}。`);
  }
  const total = rows.reduce((s, o) => s + ((o.amount as number) ?? 0), 0);
  const lines = rows.slice(0, 10).map((o) => {
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const who = names.get(o.owner_user_id as string) ?? "—";
    const close = (o.expected_close_date as string | null) ?? (o.expected_revenue_month as string | null);
    return `<b>${acc}</b>｜${o.name} — ${yen(o.amount)} / ${o.yomi ?? `${o.probability}%`} / ${close ? md(close) : "—"}（${who}）`;
  });
  if (rows.length > 10) lines.push(`…他 ${rows.length - 10}件`);
  lines.push(`合計見込み: <b>${yen(total)}</b>（${rows.length}件）`);
  return cardMessage({
    title: `${label} 成約見込み ${rows.length}件${filter.memberLabel ? `・${filter.memberLabel}` : ""}`,
    lines,
    buttonText: "商談一覧を開く",
    buttonUrl: `${appUrl()}/app/opportunities`,
  });
}

/** 催促・フォローが必要な案件 */
export async function needsFollowup(
  tenantId: string,
  opts: { filter: InsightFilter },
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const { filter } = opts;
  const today = jstDate(0);
  const staleBefore = new Date(Date.now() - 14 * 86400000).toISOString();
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
  if (filter.memberId) q = q.eq("owner_user_id", filter.memberId);
  const { data } = await q;

  const rows = (data ?? [])
    .filter((o) => !/^(7|8)\./.test((o.yomi as string | null) ?? ""))
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
    title: `⚠️ 要フォロー ${rows.length}件${filter.memberLabel ? `・${filter.memberLabel}` : ""}`,
    lines,
    buttonText: "商談一覧を開く",
    buttonUrl: `${appUrl()}/app/opportunities`,
  });
}
