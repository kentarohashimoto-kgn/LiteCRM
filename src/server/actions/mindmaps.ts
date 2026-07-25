"use server";

import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-mail";
import { refreshAccessToken } from "@/lib/google-oauth";
import { listCalendarEvents } from "@/lib/google-calendar";
import { loadFeedEventsForUser } from "@/server/actions/calendar-feed";
import { collectWeeklyCrmSource } from "@/lib/data/mindmaps";
import { mondayJst } from "@/lib/data/weekly-snapshot";
import {
  MAX_NODES,
  MAX_TITLE,
  normalizeNode,
  validateNodes,
  type MindmapLayout,
  type MindmapNode,
} from "@/lib/mindmap";
import {
  addDays,
  buildWeeklyMindmap,
  seminarTemplate,
  weekDays,
  type NodeSpec,
  type WeeklyEvent,
} from "@/lib/mindmap-weekly";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * マインドマップ(管理者専用)のサーバーアクション。
 * すべて requireAdminCtx() で owner/admin に限定し、DB側も admin_tenant_ids() のRLSで二重に守る。
 */

/* ------------------------------------------------------------------ */
/* 共通: NodeSpec ツリー → DB行                                        */
/* ------------------------------------------------------------------ */

interface NodeRow {
  id: string;
  tenant_id: string;
  mindmap_id: string;
  parent_id: string | null;
  title: string;
  note: string | null;
  sort_order: number;
  collapsed: boolean;
  color: string | null;
  marker: string;
  status: string;
  due_date: string | null;
  ref_type: string;
  ref_id: string | null;
  ref_url: string | null;
}

function flattenSpec(spec: NodeSpec, tenantId: string, mindmapId: string): NodeRow[] {
  const rows: NodeRow[] = [];
  const walk = (node: NodeSpec, parentId: string | null, order: number) => {
    if (rows.length >= MAX_NODES) return;
    const id = randomUUID();
    rows.push({
      id,
      tenant_id: tenantId,
      mindmap_id: mindmapId,
      parent_id: parentId,
      title: (node.title || "").slice(0, MAX_TITLE),
      note: node.note ? node.note.slice(0, 5000) : null,
      sort_order: order,
      collapsed: !!node.collapsed,
      color: node.color ?? null,
      marker: node.marker ?? "none",
      status: "none",
      due_date: node.due_date ?? null,
      ref_type: node.ref_type ?? "none",
      ref_id: node.ref_id ?? null,
      ref_url: node.ref_url ?? null,
    });
    (node.children ?? []).forEach((c, i) => walk(c, id, i));
  };
  walk(spec, null, 0);
  return rows;
}

/** マップ本体＋ノードを作成し、マップIDを返す。 */
async function insertMap(
  ctx: { tenantId: string; userId: string },
  meta: { title: string; kind: string; source: "manual" | "auto"; periodStart?: string | null; layout?: MindmapLayout; note?: string | null },
  spec: NodeSpec,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("mindmaps")
    .insert({
      tenant_id: ctx.tenantId,
      title: meta.title.slice(0, MAX_TITLE),
      kind: meta.kind,
      source: meta.source,
      period_start: meta.periodStart ?? null,
      layout: meta.layout ?? "right",
      note: meta.note ?? null,
      owner_user_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "マップを作成できませんでした" };

  const rows = flattenSpec(spec, ctx.tenantId, data.id as string);
  const { error: nodeErr } = await sb.from("mindmap_nodes").insert(rows);
  if (nodeErr) {
    await sb.from("mindmaps").delete().eq("id", data.id);
    return { ok: false, error: nodeErr.message };
  }
  return { ok: true, id: data.id as string };
}

/* ------------------------------------------------------------------ */
/* 作成 / 複製 / 削除                                                  */
/* ------------------------------------------------------------------ */

/** 空マップ or 研修・セミナーテンプレートを作成して編集画面へ。 */
export async function createMindmapAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const title = String(formData.get("title") ?? "").trim() || "新しいマインドマップ";
  const kind = String(formData.get("kind") ?? "freeform");
  const spec: NodeSpec =
    kind === "seminar" ? seminarTemplate(title) : { title, children: [{ title: "テーマ1" }, { title: "テーマ2" }] };

  const res = await insertMap(ctx, { title, kind: kind === "seminar" ? "seminar" : "freeform", source: "manual" }, spec);
  if (!res.ok) redirect(`/app/mindmaps?error=${encodeURIComponent(res.error)}`);
  revalidatePath("/app/mindmaps");
  redirect(`/app/mindmaps/${res.id}`);
}

/** マップを複製(ノード構造ごとコピー)。 */
export async function duplicateMindmapAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();

  const { data: meta } = await sb
    .from("mindmaps")
    .select("title,kind,source,period_start,layout,note")
    .eq("id", id)
    .maybeSingle();
  if (!meta) return;
  const { data: nodes } = await sb
    .from("mindmap_nodes")
    .select("id,parent_id,title,note,sort_order,collapsed,color,marker,status,due_date,ref_type,ref_id,ref_url")
    .eq("mindmap_id", id)
    .limit(MAX_NODES);

  const { data: created } = await sb
    .from("mindmaps")
    .insert({
      tenant_id: ctx.tenantId,
      title: `${(meta as any).title} のコピー`.slice(0, MAX_TITLE),
      kind: (meta as any).kind,
      source: "manual",
      period_start: (meta as any).period_start,
      layout: (meta as any).layout,
      note: (meta as any).note,
      owner_user_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (!created) return;

  const idMap = new Map<string, string>();
  for (const n of (nodes ?? []) as any[]) idMap.set(n.id, randomUUID());
  const rows = ((nodes ?? []) as any[]).map((n) => ({
    id: idMap.get(n.id),
    tenant_id: ctx.tenantId,
    mindmap_id: created.id,
    parent_id: n.parent_id ? idMap.get(n.parent_id) ?? null : null,
    title: n.title,
    note: n.note,
    sort_order: n.sort_order,
    collapsed: n.collapsed,
    color: n.color,
    marker: n.marker,
    status: n.status,
    due_date: n.due_date,
    ref_type: n.ref_type,
    ref_id: n.ref_id,
    ref_url: n.ref_url,
  }));
  if (rows.length > 0) await sb.from("mindmap_nodes").insert(rows);

  revalidatePath("/app/mindmaps");
  redirect(`/app/mindmaps/${created.id}`);
}

/** マップを削除(論理削除)。 */
export async function deleteMindmapAction(formData: FormData): Promise<void> {
  await requireAdminCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  await sb.from("mindmaps").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/app/mindmaps");
  redirect("/app/mindmaps");
}

/** タイトル・レイアウトなどマップ属性の更新(エディタのヘッダから)。 */
export async function updateMindmapMetaAction(input: {
  mindmapId: string;
  title?: string;
  layout?: MindmapLayout;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdminCtx();
  const patch: Record<string, unknown> = {};
  if (input.title != null) patch.title = input.title.slice(0, MAX_TITLE) || "無題";
  if (input.layout) patch.layout = input.layout === "both" ? "both" : "right";
  if (input.note !== undefined) patch.note = input.note;
  if (Object.keys(patch).length === 0) return { ok: true };

  const sb = getSupabaseServer();
  const { error } = await sb.from("mindmaps").update(patch).eq("id", input.mindmapId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/app/mindmaps/${input.mindmapId}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 保存(スナップショット方式)                                          */
/* ------------------------------------------------------------------ */

export interface SaveSnapshotInput {
  mindmapId: string;
  nodes: MindmapNode[];
  links: { id: string; from_node_id: string; to_node_id: string; label: string | null }[];
}

/**
 * エディタの全ノードを受け取り、差分をDBへ反映する。
 * クライアントを信用せず、件数・ルート数・親参照・循環をサーバーで必ず検証する。
 */
export async function saveMindmapSnapshotAction(
  input: SaveSnapshotInput,
): Promise<{ ok: boolean; error?: string; savedAt?: string }> {
  const ctx = await requireAdminCtx();
  const nodes = (input.nodes ?? []).map(normalizeNode);

  const check = validateNodes(nodes);
  if (!check.ok) return { ok: false, error: check.error };

  const sb = getSupabaseServer();
  const { data: meta } = await sb.from("mindmaps").select("id").eq("id", input.mindmapId).is("deleted_at", null).maybeSingle();
  if (!meta) return { ok: false, error: "マップが見つかりません" };

  const rows: NodeRow[] = nodes.map((n) => ({
    id: n.id,
    tenant_id: ctx.tenantId,
    mindmap_id: input.mindmapId,
    parent_id: n.parent_id,
    title: n.title,
    note: n.note,
    sort_order: n.sort_order,
    collapsed: n.collapsed,
    color: n.color,
    marker: n.marker,
    status: n.status,
    due_date: n.due_date || null,
    ref_type: n.ref_type,
    ref_id: n.ref_id,
    ref_url: n.ref_url,
  }));

  // ① 先に upsert(親子は deferrable FK なので順序不問)
  const { error: upErr } = await sb.from("mindmap_nodes").upsert(rows, { onConflict: "id" });
  if (upErr) return { ok: false, error: upErr.message };

  // ② 送られてこなかったノードを削除。検証済みなので残す側が消える側を参照することはない。
  //    既存IDを引いてJS側で差分を取る(IN句をURLに載せると2,000件でクエリ長が破綻するため)。
  const keep = nodes.map((n) => n.id);
  const keepSet = new Set(keep);
  const { data: existing } = await sb.from("mindmap_nodes").select("id").eq("mindmap_id", input.mindmapId).limit(MAX_NODES + 100);
  const stale = ((existing ?? []) as any[]).map((r) => r.id as string).filter((id) => !keepSet.has(id));
  if (stale.length > 0) {
    const { error: delErr } = await sb.from("mindmap_nodes").delete().in("id", stale);
    if (delErr) return { ok: false, error: delErr.message };
  }

  // ③ 関連線は全入れ替え(件数が少ないため単純化)
  const ids = new Set(keep);
  const links = (input.links ?? [])
    .filter((l) => ids.has(l.from_node_id) && ids.has(l.to_node_id) && l.from_node_id !== l.to_node_id)
    .slice(0, 500);
  await sb.from("mindmap_links").delete().eq("mindmap_id", input.mindmapId);
  if (links.length > 0) {
    await sb.from("mindmap_links").insert(
      links.map((l) => ({
        id: l.id,
        tenant_id: ctx.tenantId,
        mindmap_id: input.mindmapId,
        from_node_id: l.from_node_id,
        to_node_id: l.to_node_id,
        label: l.label ? l.label.slice(0, 100) : null,
      })),
    );
  }

  // 自動保存は1.2秒ごとに走るため revalidatePath は呼ばない。
  // (クライアントが状態の正であり、毎回ページを再取得すると無駄が大きい)
  await sb.from("mindmaps").update({ updated_at: new Date().toISOString() }).eq("id", input.mindmapId);
  return { ok: true, savedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/* 週次予定の自動生成                                                  */
/* ------------------------------------------------------------------ */

/**
 * 今週のカレンダー予定を取得する。
 * ① OAuth連携(user_mail_accounts) ② iCal非公開URL(user_calendar_feeds) の順に試す。
 * どちらも無ければCRMのみで生成する(生成自体は必ず成功させる)。
 */
async function fetchCalendar(
  userId: string,
  weekStart: string,
): Promise<{ events: WeeklyEvent[]; connected: boolean; via?: "oauth" | "ical"; warning?: string }> {
  const days = weekDays(weekStart);
  const from = new Date(`${days[0]}T00:00:00+09:00`);
  const to = new Date(`${addDays(days[6], 1)}T00:00:00+09:00`);
  const warnings: string[] = [];

  // ---- ① OAuth 経路 ----
  const sb = getSupabaseServer();
  const { data: acc } = await sb
    .from("user_mail_accounts")
    .select("auth_method, oauth_refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();

  if (acc && (acc as any).auth_method === "google_oauth" && (acc as any).oauth_refresh_token_enc) {
    try {
      const tok = await refreshAccessToken(decryptSecret((acc as any).oauth_refresh_token_enc as string));
      if (tok.ok) {
        const res = await listCalendarEvents(tok.accessToken, from, to);
        if (res.ok) {
          return {
            connected: true,
            via: "oauth",
            events: res.events.map<WeeklyEvent>((e) => ({
              id: `gcal-${e.id}`,
              title: e.title,
              date: e.date,
              startAt: e.startAt,
              endAt: e.endAt,
              source: "calendar",
              accountName: null,
              opportunityId: null,
              opportunityName: null,
              stage: null,
              yomi: null,
              url: e.htmlLink,
            })),
          };
        }
        warnings.push(res.error);
      } else {
        warnings.push(`Googleトークン更新に失敗: ${tok.error}`);
      }
    } catch {
      warnings.push("Google連携の資格情報を復号できませんでした");
    }
  }

  // ---- ② iCal非公開URL 経路 ----
  const feed = await loadFeedEventsForUser(userId, from, to);
  if (feed && "events" in feed) {
    return {
      connected: true,
      via: "ical",
      events: feed.events.map<WeeklyEvent>((e) => ({
        id: `ical-${e.uid}-${e.startAt ?? e.date}`,
        title: e.summary,
        date: e.date,
        startAt: e.startAt,
        endAt: e.endAt,
        source: "calendar",
        accountName: null,
        opportunityId: null,
        opportunityName: null,
        stage: null,
        yomi: null,
        url: null,
      })),
    };
  }
  if (feed && "error" in feed) warnings.push(feed.error);

  return { events: [], connected: false, warning: warnings[0] };
}

/** カレンダー予定にCRMの顧客名/案件を突き合わせる(件名に顧客名が含まれる場合)。 */
function matchCalendarToCrm(calEvents: WeeklyEvent[], crmEvents: WeeklyEvent[]): WeeklyEvent[] {
  const accounts = new Map<string, WeeklyEvent>();
  for (const e of crmEvents) if (e.accountName) accounts.set(e.accountName, e);

  return calEvents.map((e) => {
    for (const [name, crm] of accounts) {
      if (name.length >= 2 && e.title.includes(name)) {
        return {
          ...e,
          accountName: name,
          opportunityId: crm.opportunityId,
          opportunityName: crm.opportunityName,
          stage: crm.stage,
          yomi: crm.yomi,
        };
      }
    }
    return e;
  });
}

/** カレンダーとCRMで同じ予定(同日・同案件)が二重に出ないよう間引く。 */
function dedupeEvents(events: WeeklyEvent[]): WeeklyEvent[] {
  const out: WeeklyEvent[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const key = e.opportunityId ? `${e.date}:${e.opportunityId}:${(e.startAt ?? "").slice(11, 16)}` : `${e.date}:${e.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => (a.date + (a.startAt ?? "99")).localeCompare(b.date + (b.startAt ?? "99")));
}

/**
 * 今週/来週の予定マインドマップを自動生成する。
 * カレンダー未接続・APIキー無しでも CRM だけで必ず生成できる(ルールベース)。
 */
export async function generateWeeklyMindmapAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const which = String(formData.get("week") ?? "this");
  const useAi = String(formData.get("use_ai") ?? "") === "1";
  const base = mondayJst(new Date());
  const weekStart = which === "next" ? addDays(base, 7) : which === "prev" ? addDays(base, -7) : base;

  const crm = await collectWeeklyCrmSource(weekStart, ctx.userId);
  const cal = await fetchCalendar(ctx.userId, weekStart);
  const calMatched = matchCalendarToCrm(cal.events, crm.events);

  const source = {
    weekStart,
    events: dedupeEvents([...crm.events, ...calMatched]),
    deals: crm.deals,
    tasks: crm.tasks,
    repPlan: crm.repPlan,
    calendarConnected: cal.connected,
  };

  const spec = buildWeeklyMindmap(source);

  if (useAi) {
    const extra = await aiPrepSuggestions(source);
    if (extra.length > 0) {
      const prep = spec.children?.[0];
      if (prep) prep.children = [...(prep.children ?? []), { title: "AIからの段取り提案", children: extra }];
    }
  }

  const note = [
    cal.connected ? "Googleカレンダー連携あり" : "Googleカレンダー未連携",
    cal.warning ?? "",
    `予定${source.events.length}件 / クロージング${source.deals.length}件 / タスク${source.tasks.length}件`,
  ]
    .filter(Boolean)
    .join(" / ");

  const res = await insertMap(
    ctx,
    { title: spec.title, kind: "weekly_plan", source: "auto", periodStart: weekStart, layout: "right", note },
    spec,
  );
  if (!res.ok) redirect(`/app/mindmaps?error=${encodeURIComponent(res.error)}`);
  revalidatePath("/app/mindmaps");
  redirect(`/app/mindmaps/${res.id}`);
}

/* ------------------------------------------------------------------ */
/* AI 補助                                                             */
/* ------------------------------------------------------------------ */

/** 週次データを要約してClaudeに渡し、追加の準備項目を提案してもらう(失敗しても空配列)。 */
async function aiPrepSuggestions(src: {
  weekStart: string;
  events: WeeklyEvent[];
  deals: { name: string; accountName: string | null; amount: number; stage: string | null; expectedCloseDate: string | null; nextAction: string | null }[];
}): Promise<NodeSpec[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const eventLines = src.events
    .slice(0, 60)
    .map((e) => `- ${e.date} ${e.startAt ? e.startAt.slice(11, 16) : "終日"} ${e.accountName ?? ""} ${e.title}`)
    .join("\n");
  const dealLines = src.deals
    .slice(0, 40)
    .map(
      (d) =>
        `- ${d.accountName ?? ""}｜${d.name} 金額${Math.round(d.amount / 10000)}万 ステージ${d.stage ?? "-"} 着地${
          d.expectedCloseDate ?? "-"
        } 次アクション:${d.nextAction ?? "未設定"}`,
    )
    .join("\n");

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system:
        "あなたはB2B営業の段取りを支援するアシスタントです。与えられた1週間の予定とクロージング予定から、" +
        "『事前にやっておかないと当日困ること』『前後関係で漏れやすい準備』だけを挙げます。" +
        "一般論ではなく、与えられた予定・案件名に紐づけて具体的に書いてください。JSON以外は出力しないでください。",
      messages: [
        {
          role: "user",
          content:
            `対象週: ${src.weekStart}\n\n【今週の予定】\n${eventLines || "(なし)"}\n\n【今月・来月のクロージング予定】\n${
              dealLines || "(なし)"
            }\n\n` +
            '次のJSON形式のみで、最大8件出力してください: {"items":[{"title":"準備項目(40字以内)","detail":"なぜ必要か(60字以内)"}]}',
        },
      ],
    });
    if (res.stop_reason === "refusal") return [];
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { items?: { title?: string; detail?: string }[] };
    return (parsed.items ?? [])
      .filter((i) => i.title)
      .slice(0, 8)
      .map<NodeSpec>((i) => ({ title: String(i.title).slice(0, MAX_TITLE), note: i.detail ?? null, marker: "p2" }));
  } catch {
    return [];
  }
}

/**
 * 選択中ノードの子案をAIに出してもらう(研修・セミナー構成の検討用)。
 * 返すだけでDBには書かない(クライアント側で挿入 → Undo可能に保つ)。
 */
export async function suggestChildNodesAction(input: {
  mindmapId: string;
  path: string[];
  count?: number;
}): Promise<{ ok: boolean; titles?: string[]; error?: string }> {
  await requireAdminCtx();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY が未設定です。設定するとAI提案が使えます。" };
  }
  const path = (input.path ?? []).filter(Boolean).slice(-6);
  if (path.length === 0) return { ok: false, error: "対象ノードがありません" };
  const count = Math.min(8, Math.max(3, input.count ?? 5));

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1200,
      system:
        "あなたはマインドマップで思考を整理する編集者です。与えられた枝の文脈に沿って、" +
        "重複のない具体的な子ノード案を日本語で出します。JSON以外は出力しないでください。",
      messages: [
        {
          role: "user",
          content:
            `マインドマップの枝: ${path.join(" > ")}\n\n` +
            `末尾のノード「${path[path.length - 1]}」の子ノード案を${count}件、` +
            '次のJSON形式のみで出力してください: {"titles":["...","..."]}（各30字以内・体言止め）',
        },
      ],
    });
    if (res.stop_reason === "refusal") return { ok: false, error: "AIが提案を生成できませんでした" };
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { titles?: string[] };
    const titles = (parsed.titles ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, count);
    if (titles.length === 0) return { ok: false, error: "提案が空でした" };
    return { ok: true, titles: titles.map((t) => t.slice(0, MAX_TITLE)) };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "APIキーが無効です" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "APIのレート制限中です。少し待って再試行してください" };
    return { ok: false, error: "AI提案に失敗しました" };
  }
}
