/**
 * メモ・議事録ページの参照ヘルパー。行はRLS（テナント内共有）でスコープ済み。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { MemoKind } from "@/lib/memo";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MemoPageListItem {
  id: string;
  title: string;
  kind: MemoKind;
  parent_id: string | null;
  parentTitle: string | null;
  opportunity_id: string | null;
  oppName: string | null;
  meeting_id: string | null;
  meetingTitle: string | null;
  bodyPreview: string;
  recordingCount: number;
  updated_at: string;
}

/** ページ一覧（更新が新しい順）。q はタイトル/本文の部分一致。 */
export async function listMemoPages(q?: string): Promise<MemoPageListItem[]> {
  const sb = getSupabaseServer();
  let query = sb
    .from("memo_pages")
    .select("id,title,kind,parent_id,body,opportunity_id,meeting_id,updated_at")
    .order("updated_at", { ascending: false })
    .limit(300);
  const needle = (q ?? "").trim();
  if (needle) {
    // PostgREST の or() はカンマ・括弧が構文文字のため除去し、ilike のワイルドカードはエスケープ
    const esc = needle.replace(/[,()]/g, " ").replace(/[%_]/g, (c) => `\\${c}`).trim();
    if (esc) query = query.or(`title.ilike.%${esc}%,body.ilike.%${esc}%`);
  }
  const { data } = await query;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const parentIds = Array.from(new Set(rows.map((r) => r.parent_id).filter(Boolean)));
  const oppIds = Array.from(new Set(rows.map((r) => r.opportunity_id).filter(Boolean)));
  const meetingIds = Array.from(new Set(rows.map((r) => r.meeting_id).filter(Boolean)));
  const pageIds = rows.map((r) => r.id);

  const [pR, oR, mR, recR] = await Promise.all([
    parentIds.length
      ? sb.from("memo_pages").select("id,title").in("id", parentIds)
      : Promise.resolve({ data: [] as any[] }),
    oppIds.length
      ? sb.from("opportunities").select("id,name").in("id", oppIds)
      : Promise.resolve({ data: [] as any[] }),
    meetingIds.length
      ? sb.from("meetings").select("id,title").in("id", meetingIds)
      : Promise.resolve({ data: [] as any[] }),
    sb.from("meeting_recordings").select("id,memo_page_id").in("memo_page_id", pageIds),
  ]);
  const pMap = new Map((pR.data ?? []).map((x: any) => [x.id, x.title]));
  const oMap = new Map((oR.data ?? []).map((x: any) => [x.id, x.name]));
  const mMap = new Map((mR.data ?? []).map((x: any) => [x.id, x.title]));
  const recCount = new Map<string, number>();
  for (const r of (recR.data ?? []) as any[]) {
    if (r.memo_page_id) recCount.set(r.memo_page_id, (recCount.get(r.memo_page_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title || "無題",
    kind: (r.kind === "minutes" ? "minutes" : "memo") as MemoKind,
    parent_id: r.parent_id ?? null,
    parentTitle: r.parent_id ? pMap.get(r.parent_id) ?? null : null,
    opportunity_id: r.opportunity_id ?? null,
    oppName: r.opportunity_id ? oMap.get(r.opportunity_id) ?? null : null,
    meeting_id: r.meeting_id ?? null,
    meetingTitle: r.meeting_id ? mMap.get(r.meeting_id) ?? null : null,
    bodyPreview: String(r.body ?? "").slice(0, 120),
    recordingCount: recCount.get(r.id) ?? 0,
    updated_at: r.updated_at,
  }));
}

export interface MemoPageDetail {
  id: string;
  title: string;
  body: string;
  kind: MemoKind;
  parent: { id: string; title: string } | null;
  children: { id: string; title: string; kind: MemoKind; updated_at: string }[];
  opportunity: { id: string; name: string; account_id: string | null } | null;
  meeting: { id: string; title: string; meeting_date: string | null } | null;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

/** ページ詳細（親・サブページ・紐付け先の名前も解決）。 */
export async function getMemoPage(id: string): Promise<MemoPageDetail | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("memo_pages")
    .select("id,title,body,kind,parent_id,opportunity_id,meeting_id,owner_user_id,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as any;

  const [pR, cR, oR, mR] = await Promise.all([
    r.parent_id
      ? sb.from("memo_pages").select("id,title").eq("id", r.parent_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    sb
      .from("memo_pages")
      .select("id,title,kind,updated_at")
      .eq("parent_id", r.id)
      .order("updated_at", { ascending: false })
      .limit(50),
    r.opportunity_id
      ? sb.from("opportunities").select("id,name,account_id").eq("id", r.opportunity_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    r.meeting_id
      ? sb.from("meetings").select("id,title,meeting_date").eq("id", r.meeting_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);

  return {
    id: r.id,
    title: r.title ?? "",
    body: r.body ?? "",
    kind: (r.kind === "minutes" ? "minutes" : "memo") as MemoKind,
    parent: pR.data ? { id: pR.data.id, title: pR.data.title || "無題" } : null,
    children: ((cR.data ?? []) as any[]).map((c) => ({
      id: c.id,
      title: c.title || "無題",
      kind: (c.kind === "minutes" ? "minutes" : "memo") as MemoKind,
      updated_at: c.updated_at,
    })),
    opportunity: oR.data ? { id: oR.data.id, name: oR.data.name ?? "—", account_id: oR.data.account_id ?? null } : null,
    meeting: mR.data ? { id: mR.data.id, title: mR.data.title ?? "—", meeting_date: mR.data.meeting_date ?? null } : null,
    owner_user_id: r.owner_user_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface LinkOppOption {
  id: string;
  label: string;
}
export interface LinkMeetingOption {
  id: string;
  label: string;
}

/** 紐付け先の案件候補（更新が新しい順・顧客名付き）。現在の紐付け先は必ず含める。 */
export async function listLinkableOpportunities(currentOppId?: string | null): Promise<LinkOppOption[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select("id,name,account_id,updated_at")
    .order("updated_at", { ascending: false })
    .limit(300);
  let rows = (data ?? []) as any[];
  if (currentOppId && !rows.some((r) => r.id === currentOppId)) {
    const { data: cur } = await sb.from("opportunities").select("id,name,account_id").eq("id", currentOppId).maybeSingle();
    if (cur) rows = [cur as any, ...rows];
  }
  const accIds = Array.from(new Set(rows.map((r) => r.account_id).filter(Boolean)));
  const { data: accs } = accIds.length
    ? await sb.from("accounts").select("id,name").in("id", accIds)
    : { data: [] as any[] };
  const aMap = new Map((accs ?? []).map((a: any) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    label: `${r.account_id ? `${aMap.get(r.account_id) ?? "—"} / ` : ""}${r.name ?? "—"}`,
  }));
}

/** 案件配下の商談候補（新しい順・日付付き）。 */
export async function listLinkableMeetings(opportunityId: string): Promise<LinkMeetingOption[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("meetings")
    .select("id,title,meeting_date")
    .eq("opportunity_id", opportunityId)
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .limit(100);
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id,
    label: `${m.meeting_date ? `${String(m.meeting_date).slice(0, 10)} ` : ""}${m.title ?? "商談"}`,
  }));
}
