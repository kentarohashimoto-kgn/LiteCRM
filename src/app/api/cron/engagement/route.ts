import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { MAIL_TOUCH_WEIGHTS, MAIL_TOUCH_LABEL, clickTouchType, computeGrade, resolveFitScore, HOT_NOTIFY_ROLES } from "@/lib/engagement";
import { sendChatMessage, textMessage } from "@/lib/chat/send";

export const dynamic = "force-dynamic";

/**
 * F-204/F-205 メール反応 → エンゲージメント反映 → ホット通知（15分間隔）。
 *  1) email_events(開封/クリック) と受信メール(返信) を touchpoints へ転記（meta.ref で冪等）
 *  2) 影響のあったメールアドレスの person_engagement を再集計
 *  3) 影響のあったリードの priority_grade / last_engaged_at / hot_since を更新
 *  4) クリック・資料閲覧・返信・P1昇格を、IS/管理ロールへアプリ内通知 + Google Chat DM
 * 認可: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='engagement')。
 */

const WINDOW_MS = 2 * 60 * 60 * 1000; // 走査窓: 直近2時間(15分cronの再実行に冪等)

function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

interface Candidate {
  tenantId: string;
  ref: string;            // 冪等キー(meta.ref)
  type: string;           // email_open|email_click|doc_view|email_reply
  email: string;          // 反応した人(小文字)
  leadId: string | null;
  occurredAt: string;     // ISO
  url?: string | null;
  notify: boolean;        // 通知対象イベントか(開封は初回のみ相当=refで日次dedupe済み)
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: jobRows } = await admin.from("batch_job_settings").select("tenant_id, enabled").eq("job_kind", "engagement");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) return NextResponse.json({ ok: true, skipped: "job disabled" });

  // ---- 1) 反応イベントの収集 ----
  const { data: events } = await admin
    .from("email_events")
    .select("id, tenant_id, email_message_id, kind, url, occurred_at")
    .gte("occurred_at", sinceIso)
    .order("occurred_at")
    .limit(3000);
  const evs = (events ?? []).filter((e) => enabledTenants.has(e.tenant_id as string));

  const msgIds = [...new Set(evs.map((e) => e.email_message_id as string))];
  const msgMap = new Map<string, { lead_id: string | null; to: string | null; tenant_id: string }>();
  for (let i = 0; i < msgIds.length; i += 200) {
    const { data: msgs } = await admin
      .from("email_messages")
      .select("id, tenant_id, lead_id, to_addrs")
      .in("id", msgIds.slice(i, i + 200));
    for (const m of msgs ?? []) {
      msgMap.set(m.id as string, {
        lead_id: (m.lead_id as string) ?? null,
        to: ((m.to_addrs as string[] | null)?.[0] ?? "").trim().toLowerCase() || null,
        tenant_id: m.tenant_id as string,
      });
    }
  }

  const candidates: Candidate[] = [];
  for (const e of evs) {
    const m = msgMap.get(e.email_message_id as string);
    if (!m || !m.to) continue;
    const occurredAt = e.occurred_at as string;
    if (e.kind === "open") {
      // 開封は 同一メール×同一JST日 で1回だけ計上(Gmailプロキシの多重取得を吸収)
      candidates.push({
        tenantId: e.tenant_id as string, ref: `open:${e.email_message_id}:${jstDate(occurredAt)}`,
        type: "email_open", email: m.to, leadId: m.lead_id, occurredAt, notify: true,
      });
    } else if (e.kind === "click") {
      candidates.push({
        tenantId: e.tenant_id as string, ref: `ee:${e.id}`,
        type: clickTouchType(e.url as string | null), email: m.to, leadId: m.lead_id,
        occurredAt, url: (e.url as string) ?? null, notify: true,
      });
    }
  }

  // 返信(受信メール)。in_reply_to があり自社送信に対応するもの → 送信主 from_addr で計上
  const { data: inbound } = await admin
    .from("email_messages")
    .select("id, tenant_id, from_addr, in_reply_to, lead_id, created_at")
    .eq("direction", "in")
    .not("in_reply_to", "is", null)
    .gte("created_at", sinceIso)
    .limit(500);
  for (const m of inbound ?? []) {
    if (!enabledTenants.has(m.tenant_id as string)) continue;
    const from = String(m.from_addr ?? "").trim().toLowerCase();
    if (!from) continue;
    candidates.push({
      tenantId: m.tenant_id as string, ref: `in:${m.id}`, type: "email_reply",
      email: from, leadId: (m.lead_id as string) ?? null, occurredAt: (m.created_at as string) ?? startedAt, notify: true,
    });
  }

  if (candidates.length === 0) return NextResponse.json({ ok: true, events: 0, inserted: 0 });

  // ---- 冪等: 既転記分を除外して挿入 ----
  const refs = [...new Set(candidates.map((c) => c.ref))];
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data: ex } = await admin.from("touchpoints").select("meta->>ref").in("meta->>ref", refs.slice(i, i + 200));
    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const r of (ex ?? []) as any[]) existing.add(String(r.ref));
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
  const seenRef = new Set<string>();
  const fresh = candidates.filter((c) => {
    if (existing.has(c.ref) || seenRef.has(c.ref)) return false;
    seenRef.add(c.ref);
    return true;
  });

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    const { error } = await admin.from("touchpoints").insert(chunk.map((c) => ({
      tenant_id: c.tenantId, email: c.email, lead_id: c.leadId,
      type: c.type, weight: MAIL_TOUCH_WEIGHTS[c.type] ?? 1,
      occurred_at: jstDate(c.occurredAt), source: "email_tracking",
      meta: { ref: c.ref, ...(c.url ? { url: c.url } : {}) },
    })));
    if (!error) inserted += chunk.length;
  }

  // ---- 2) person_engagement 再集計(影響アドレスのみ) ----
  const byTenant = new Map<string, Set<string>>();
  for (const c of fresh) {
    if (!byTenant.has(c.tenantId)) byTenant.set(c.tenantId, new Set());
    byTenant.get(c.tenantId)!.add(c.email);
  }
  const engScore = new Map<string, number>(); // `${tenant}|${email}` -> score
  for (const [tenantId, emailSet] of byTenant) {
    const emails = [...emailSet];
    for (let i = 0; i < emails.length; i += 100) {
      const part = emails.slice(i, i + 100);
      const { data: tps } = await admin
        .from("touchpoints")
        .select("email, weight, type, occurred_at")
        .eq("tenant_id", tenantId)
        .in("email", part)
        .limit(10000);
      const agg = new Map<string, { score: number; count: number; types: Set<string>; last: string | null }>();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      for (const t of (tps ?? []) as any[]) {
        const key = String(t.email ?? "").toLowerCase();
        if (!key) continue;
        const a = agg.get(key) ?? { score: 0, count: 0, types: new Set<string>(), last: null };
        a.score += t.weight ?? 1;
        a.count += 1;
        a.types.add(t.type);
        if (t.occurred_at && (!a.last || t.occurred_at > a.last)) a.last = t.occurred_at;
        agg.set(key, a);
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const rankOf = (s: number) => (s >= 30 ? "S" : s >= 15 ? "A" : s >= 7 ? "B" : s >= 3 ? "C" : "D");
      const rows = [...agg.entries()].map(([email, a]) => ({
        tenant_id: tenantId, email, score: a.score, rank: rankOf(a.score),
        touch_count: a.count, types: [...a.types], last_touch_at: a.last, updated_at: new Date().toISOString(),
      }));
      if (rows.length) await admin.from("person_engagement").upsert(rows, { onConflict: "tenant_id,email" });
      for (const r of rows) engScore.set(`${tenantId}|${r.email}`, r.score);
    }
  }

  // ---- 3) リード更新(グレード/最終反応/ホット昇格) + 4) 通知 ----
  // 対象リード: lead_id 直結 + メール一致(返信等でlead_id不明のもの)
  const leadIds = [...new Set(fresh.map((c) => c.leadId).filter(Boolean) as string[])];
  const emailOnly = fresh.filter((c) => !c.leadId);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const leadRows = new Map<string, any>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await admin
      .from("leads")
      .select("id, tenant_id, email, company_name, contact_name, lead_score, rank, priority_grade, hot_since, owner_user_id")
      .in("id", leadIds.slice(i, i + 200));
    for (const l of data ?? []) leadRows.set(l.id as string, l);
  }
  for (const c of emailOnly) {
    const { data } = await admin
      .from("leads")
      .select("id, tenant_id, email, company_name, contact_name, lead_score, rank, priority_grade, hot_since, owner_user_id")
      .eq("tenant_id", c.tenantId)
      .ilike("email", c.email)
      .limit(1);
    for (const l of data ?? []) leadRows.set(l.id as string, l);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // リードごとの新規イベントまとめ(通知文用)
  const eventsByLead = new Map<string, Candidate[]>();
  for (const c of fresh) {
    let lid = c.leadId;
    if (!lid) {
      for (const l of leadRows.values()) {
        if (l.tenant_id === c.tenantId && String(l.email ?? "").toLowerCase() === c.email) { lid = l.id as string; break; }
      }
    }
    if (!lid) continue;
    if (!eventsByLead.has(lid)) eventsByLead.set(lid, []);
    eventsByLead.get(lid)!.push(c);
  }

  // 通知宛先(テナント別): IS/管理ロール
  const notifyUsers = new Map<string, string[]>();
  for (const tenantId of byTenant.keys()) {
    const { data: mems } = await admin
      .from("memberships")
      .select("user_id, role, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("role", HOT_NOTIFY_ROLES);
    notifyUsers.set(tenantId, (mems ?? []).map((m) => m.user_id as string));
  }

  let leadsUpdated = 0;
  let notified = 0;
  const nowIso = new Date().toISOString();
  for (const [leadId, evList] of eventsByLead) {
    const lead = leadRows.get(leadId);
    if (!lead) continue;
    const tenantId = lead.tenant_id as string;
    const email = String(lead.email ?? evList[0].email).toLowerCase();
    const score = engScore.get(`${tenantId}|${email}`) ?? 0;
    const grade = computeGrade(resolveFitScore(lead.lead_score, lead.rank), score);
    const becameHot = grade === "P1" && lead.priority_grade !== "P1";
    const lastAt = evList.map((e) => e.occurredAt).sort().pop() ?? nowIso;

    await admin.from("leads").update({
      priority_grade: grade,
      last_engaged_at: lastAt,
      ...(becameHot ? { hot_since: nowIso } : {}),
    }).eq("id", leadId);
    leadsUpdated++;

    // 通知: このrunの新規イベント要約(開封のみ×1件なら控えめに、クリック/資料/返信/P1昇格は強調)
    const kinds = [...new Set(evList.map((e) => e.type))];
    const strong = kinds.some((k) => k !== "email_open") || becameHot;
    const kindText = kinds.map((k) => MAIL_TOUCH_LABEL[k] ?? k).join("・");
    const company = (lead.company_name as string) || "(会社名不明)";
    const person = (lead.contact_name as string) || "";
    const title = becameHot
      ? `🔥 ${company} が P1(今すぐ対応) に昇格`
      : `${strong ? "⚡" : "📩"} ${company} ${person} が ${kindText}`;
    const body = `反応: ${kindText} / エンゲージ ${score}pt / Fitランク ${lead.rank ?? "-"} → ${grade}`;
    const href = `/app/leads/${leadId}`;

    const owner = (lead.owner_user_id as string) ?? null;
    const users = owner ? [owner] : (notifyUsers.get(tenantId) ?? []);
    for (const uid of users) {
      const { error } = await admin.from("notifications").insert({
        tenant_id: tenantId, user_id: uid, kind: "hot_lead", title, body, href,
      });
      if (!error) notified++;
      // Chat DM は強シグナル(クリック/資料/返信/P1)のみ。開封だけはアプリ内に留める(通知疲れ防止)
      if (strong) {
        try {
          await sendChatMessage({ type: "dm", tenantId, userId: uid }, textMessage(`${title}\n${body}\n${process.env.NEXT_PUBLIC_APP_URL ?? ""}${href}`));
        } catch { /* DM失敗は無視(アプリ内通知は出ている) */ }
      }
    }
  }

  // ---- 運用ログ ----
  try {
    for (const tenantId of byTenant.keys()) {
      await admin.from("batch_runs").insert({
        tenant_id: tenantId, job_kind: "engagement", run_date: jstDate(startedAt),
        started_at: startedAt, ended_at: new Date().toISOString(), status: "success",
        targets_total: evs.length, items_generated: inserted, items_failed: 0,
        detail: { inserted, leads_updated: leadsUpdated, notified },
      });
    }
  } catch { /* ログ失敗は無視 */ }

  return NextResponse.json({ ok: true, events: evs.length + (inbound?.length ?? 0), inserted, leadsUpdated, notified });
}
