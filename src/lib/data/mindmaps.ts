/**
 * マインドマップのデータ取得(管理者専用)。RLS(admin_tenant_ids)により
 * owner/admin 以外はそもそも1行も取得できない。
 */

import { getSupabaseServer } from "@/lib/supabase/server";
import type { MindmapKind, MindmapLayout, MindmapLink, MindmapMeta, MindmapNode } from "@/lib/mindmap";
import type { WeeklyDeal, WeeklyEvent, WeeklySource, WeeklyTask } from "@/lib/mindmap-weekly";
import { addDays, weekDays } from "@/lib/mindmap-weekly";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MindmapListItem extends MindmapMeta {
  nodeCount: number;
}

const META_COLS = "id,title,kind,source,period_start,layout,note,created_at,updated_at";
const NODE_COLS =
  "id,parent_id,title,note,sort_order,collapsed,color,marker,status,due_date,ref_type,ref_id,ref_url";

function toMeta(r: any): MindmapMeta {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as MindmapKind,
    source: r.source,
    period_start: r.period_start ?? null,
    layout: (r.layout ?? "right") as MindmapLayout,
    note: r.note ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toNode(r: any): MindmapNode {
  return {
    id: r.id,
    parent_id: r.parent_id ?? null,
    title: r.title ?? "",
    note: r.note ?? null,
    sort_order: r.sort_order ?? 0,
    collapsed: !!r.collapsed,
    color: r.color ?? null,
    marker: r.marker ?? "none",
    status: r.status ?? "none",
    due_date: r.due_date ?? null,
    ref_type: r.ref_type ?? "none",
    ref_id: r.ref_id ?? null,
    ref_url: r.ref_url ?? null,
  };
}

/** マップ一覧(新しい順)。ノード数つき。 */
export async function listMindmaps(): Promise<MindmapListItem[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("mindmaps")
    .select(META_COLS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  const maps = (data ?? []) as any[];
  if (maps.length === 0) return [];

  const { data: nodes } = await sb
    .from("mindmap_nodes")
    .select("mindmap_id")
    .in(
      "mindmap_id",
      maps.map((m) => m.id),
    );
  const counts = new Map<string, number>();
  for (const n of (nodes ?? []) as any[]) counts.set(n.mindmap_id, (counts.get(n.mindmap_id) ?? 0) + 1);

  return maps.map((m) => ({ ...toMeta(m), nodeCount: counts.get(m.id) ?? 0 }));
}

export interface MindmapDetail {
  meta: MindmapMeta;
  nodes: MindmapNode[];
  links: MindmapLink[];
}

/** マップ1件(ノード・関連線つき)。存在しない/権限なしは null。 */
export async function getMindmap(id: string): Promise<MindmapDetail | null> {
  const sb = getSupabaseServer();
  const { data: meta } = await sb.from("mindmaps").select(META_COLS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!meta) return null;

  const [{ data: nodes }, { data: links }] = await Promise.all([
    sb.from("mindmap_nodes").select(NODE_COLS).eq("mindmap_id", id).order("sort_order").limit(3000),
    sb.from("mindmap_links").select("id,from_node_id,to_node_id,label").eq("mindmap_id", id).limit(500),
  ]);

  return {
    meta: toMeta(meta),
    nodes: ((nodes ?? []) as any[]).map(toNode),
    links: ((links ?? []) as any[]).map((l) => ({
      id: l.id,
      from_node_id: l.from_node_id,
      to_node_id: l.to_node_id,
      label: l.label ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 週次自動生成のための素材収集                                        */
/* ------------------------------------------------------------------ */

/**
 * 週次マインドマップの素材(CRM側)を集める。
 * カレンダー予定は呼び出し側(server action)で取得して events に足し込む。
 */
export async function collectWeeklyCrmSource(
  weekStart: string,
  ownerUserId: string,
): Promise<Omit<WeeklySource, "calendarConnected"> & { ownerName: string | null }> {
  const sb = getSupabaseServer();
  const days = weekDays(weekStart);
  const weekEnd = days[6];
  const thisMonth = `${weekStart.slice(0, 7)}-01`;
  const nextMonthStart = addDays(thisMonth, 32).slice(0, 7) + "-01";
  const monthAfterStart = addDays(nextMonthStart, 32).slice(0, 7) + "-01";

  // 商談(会議ログ)は日付列が meeting_date / meeting_at の2系統あるため、
  // それぞれの範囲で引いて id で重複排除する(片方が null の行を取りこぼさない)。
  const MEETING_COLS = "id,title,meeting_at,meeting_date,opportunity_id,opportunities(id,name,stage,yomi,accounts(name))";

  const [meetingsByDate, meetingsByTs, apptRes, dealsRes, tasksRes, reportRes, profileRes] = await Promise.all([
    sb.from("meetings").select(MEETING_COLS).gte("meeting_date", weekStart).lte("meeting_date", weekEnd).limit(200),
    sb
      .from("meetings")
      .select(MEETING_COLS)
      .gte("meeting_at", `${weekStart}T00:00:00+09:00`)
      .lte("meeting_at", `${weekEnd}T23:59:59+09:00`)
      .limit(200),
    // 週内のアポ(案件のアポ日時)
    sb
      .from("opportunities")
      .select("id,name,stage,yomi,appointment_at,first_meeting_date,accounts(name)")
      .is("deleted_at", null)
      .gte("appointment_at", `${weekStart}T00:00:00+09:00`)
      .lte("appointment_at", `${weekEnd}T23:59:59+09:00`)
      .limit(200),
    // 今月・来月クロージング予定(オープン案件)
    sb
      .from("opportunities")
      .select(
        "id,name,amount,probability,yomi,stage,expected_close_date,next_action_text,next_action_date,owner_user_id,status,accounts(name)",
      )
      .is("deleted_at", null)
      .eq("status", "open")
      .gte("expected_close_date", thisMonth)
      .lt("expected_close_date", monthAfterStart)
      .order("amount", { ascending: false })
      .limit(300),
    // 期日が今週まで(遅延含む)のタスク
    sb
      .from("tasks")
      .select("id,title,due_date,status,opportunity_id,account_id,accounts(name)")
      .neq("status", "done")
      .lte("due_date", weekEnd)
      .gte("due_date", addDays(weekStart, -60))
      .limit(200),
    sb
      .from("weekly_rep_reports")
      .select("next_week_plan,month_ahead_plan")
      .eq("owner_user_id", ownerUserId)
      .lte("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("profiles").select("display_name,email").eq("id", ownerUserId).maybeSingle(),
  ]);

  const events: WeeklyEvent[] = [];
  const seen = new Set<string>();

  const meetingRows = new Map<string, any>();
  for (const m of [...((meetingsByDate.data ?? []) as any[]), ...((meetingsByTs.data ?? []) as any[])]) {
    meetingRows.set(m.id, m);
  }

  for (const m of meetingRows.values()) {
    const date = m.meeting_at
      ? new Date(m.meeting_at).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
      : m.meeting_date;
    if (!date || date < weekStart || date > weekEnd) continue;
    const opp = m.opportunities;
    events.push({
      id: `meeting-${m.id}`,
      title: m.title || opp?.name || "商談",
      date,
      startAt: m.meeting_at ?? null,
      endAt: null,
      source: "crm",
      accountName: opp?.accounts?.name ?? null,
      opportunityId: opp?.id ?? m.opportunity_id ?? null,
      opportunityName: opp?.name ?? null,
      stage: opp?.stage ?? null,
      yomi: opp?.yomi ?? null,
      url: opp?.id ? `/app/opportunities/${opp.id}` : null,
    });
    if (opp?.id) seen.add(`${opp.id}:${date}`);
  }

  for (const o of (apptRes.data ?? []) as any[]) {
    const date = o.appointment_at
      ? new Date(o.appointment_at).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
      : o.first_meeting_date;
    if (!date || date < weekStart || date > weekEnd) continue;
    if (seen.has(`${o.id}:${date}`)) continue; // 商談ログがある日は重複させない
    events.push({
      id: `appt-${o.id}`,
      title: `アポ: ${o.name}`,
      date,
      startAt: o.appointment_at ?? null,
      endAt: null,
      source: "crm",
      accountName: o.accounts?.name ?? null,
      opportunityId: o.id,
      opportunityName: o.name,
      stage: o.stage ?? null,
      yomi: o.yomi ?? null,
      url: `/app/opportunities/${o.id}`,
    });
  }

  const ownerIds = Array.from(
    new Set(((dealsRes.data ?? []) as any[]).map((d) => d.owner_user_id).filter(Boolean)),
  ) as string[];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await sb.from("profiles").select("id,display_name,email").in("id", ownerIds);
    for (const p of (profs ?? []) as any[]) ownerNames.set(p.id, p.display_name || p.email || "");
  }

  const deals: WeeklyDeal[] = ((dealsRes.data ?? []) as any[]).map((d) => ({
    id: d.id,
    name: d.name,
    accountName: d.accounts?.name ?? null,
    amount: Number(d.amount ?? 0),
    probability: d.probability != null ? Number(d.probability) : null,
    yomi: d.yomi ?? null,
    stage: d.stage ?? null,
    expectedCloseDate: d.expected_close_date ?? null,
    nextAction: d.next_action_text ?? null,
    ownerName: d.owner_user_id ? ownerNames.get(d.owner_user_id) ?? null : null,
  }));

  const tasks: WeeklyTask[] = ((tasksRes.data ?? []) as any[]).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    status: t.status,
    accountName: t.accounts?.name ?? null,
    opportunityId: t.opportunity_id ?? null,
  }));

  const rep = reportRes.data as any;
  const prof = profileRes.data as any;

  return {
    weekStart,
    events,
    deals,
    tasks,
    repPlan: rep ? { nextWeekPlan: rep.next_week_plan ?? null, monthAheadPlan: rep.month_ahead_plan ?? null } : null,
    ownerName: prof ? prof.display_name || prof.email || null : null,
  };
}
