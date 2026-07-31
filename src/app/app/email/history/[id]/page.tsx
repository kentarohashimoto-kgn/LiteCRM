import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MailOpen, MousePointerClick, AlertTriangle, ExternalLink } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { resolveMailRecipients } from "@/lib/data/mail-recipients";
import { getPersonEngagement, getPersonTouchpoints } from "@/lib/data/leads";
import { MAIL_TOUCH_WEIGHTS, MAIL_TOUCH_LABEL, GRADE_DEFS, type PriorityGrade } from "@/lib/engagement";
import { UnifiedTimeline, type TimelineEvent } from "@/components/history/unified-timeline";
import { MAIL_VIA_LABEL } from "@/lib/mail-export";
import { formatDateTimeSecJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * メール送信履歴の詳細。1通のメールについて
 *  ・誰に送ったか(会社名・担当者名・リードへの導線)とエンゲージメント状況
 *  ・送信状態・開封・クリックの実績
 *  ・その宛先との送信前後のアクション(送受信・開封/クリック・接点)を時系列1本で表示する。
 */

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  sent: { label: "送信済み", cls: "bg-emerald-100 text-emerald-700" },
  queued: { label: "送信中", cls: "bg-ink/10 text-ink/55" },
  failed: { label: "失敗", cls: "bg-rose-100 text-rose-700" },
  logged: { label: "記録のみ", cls: "bg-ink/[0.06] text-ink/55" },
};
const ENG_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-amber-100 text-amber-700", B: "bg-teal-light text-teal-deep",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/40",
};
/** メール由来以外の接点ラベル(リード詳細と同じ表記)。 */
const TP_LABEL: Record<string, string> = {
  exhibition: "展示会で名刺交換", call: "架電ログ", seminar: "セミナー参加", survey: "アンケート回答",
  doc_request: "資料請求", meeting: "商談実施", meeting_repeat: "再商談", visit: "訪問", proposal: "見積・提案提出",
};

interface MsgRow {
  id: string;
  direction: string;
  subject: string | null;
  snippet: string | null;
  to_addrs: string[];
  from_addr: string | null;
  status: string;
  sent_via: string | null;
  sent_at: string | null;
  created_at: string | null;
  open_count: number;
  last_opened_at: string | null;
  click_count: number;
  last_clicked_at: string | null;
  error_text: string | null;
  lead_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  logged_by: string | null;
  smtp_message_id: string | null;
}

const MSG_COLS = "id, direction, subject, snippet, to_addrs, from_addr, status, sent_via, sent_at, created_at, open_count, last_opened_at, click_count, last_clicked_at, error_text, lead_id, contact_id, account_id, opportunity_id, logged_by, smtp_message_id";

export default async function EmailHistoryDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) notFound();

  const { data: msg } = await sb
    .from("email_messages")
    .select(MSG_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", params.id)
    .maybeSingle();
  if (!msg) notFound();
  const m = msg as MsgRow;

  const email = String((m.to_addrs ?? [])[0] ?? "").trim();
  const emailLc = email.toLowerCase();
  const rec = (await resolveMailRecipients([m])).get(m.id);

  // 宛先リード: lead_id 優先。無ければメールアドレスから逆引き(古い送信ログの救済)
  let lead: { id: string; company_name: string | null; contact_name: string | null; rank: string | null; priority_score: number | null; priority_grade: string | null } | null = null;
  if (m.lead_id) {
    const { data } = await sb.from("leads").select("id, company_name, contact_name, rank, priority_score, priority_grade").eq("id", m.lead_id).maybeSingle();
    lead = data ?? null;
  } else if (emailLc) {
    const { data } = await sb.from("leads").select("id, company_name, contact_name, rank, priority_score, priority_grade").ilike("email", emailLc).order("created_at", { ascending: false }).limit(1);
    lead = data?.[0] ?? null;
  }

  const [eng, touchpoints, senderR, linksR] = await Promise.all([
    getPersonEngagement(email),
    getPersonTouchpoints(email),
    m.logged_by ? sb.from("profiles").select("display_name, email").eq("id", m.logged_by).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("email_links").select("url, label, click_count").eq("email_message_id", m.id),
  ]);
  const senderName = senderR.data ? ((senderR.data.display_name as string) || (senderR.data.email as string) || "") : "";
  const links = (linksR.data ?? []) as { url: string; label: string | null; click_count: number }[];

  // ---- 前後のアクション(タイムライン)の材料 ----
  // 同じ宛先への送信メール(lead_id と 宛先アドレスの両方で拾い、idで名寄せ)
  const related = new Map<string, MsgRow>();
  related.set(m.id, m);
  if (m.lead_id) {
    const { data } = await sb.from("email_messages").select(MSG_COLS).eq("direction", "out").eq("lead_id", m.lead_id).order("sent_at", { ascending: false, nullsFirst: false }).limit(100);
    for (const r of (data ?? []) as MsgRow[]) related.set(r.id, r);
  }
  if (email) {
    const { data } = await sb.from("email_messages").select(MSG_COLS).eq("direction", "out").contains("to_addrs", [email]).order("sent_at", { ascending: false, nullsFirst: false }).limit(100);
    for (const r of (data ?? []) as MsgRow[]) related.set(r.id, r);
  }

  // その宛先からの受信(返信)
  let inbound: MsgRow[] = [];
  if (email) {
    const { data } = await sb.from("email_messages").select(MSG_COLS).eq("direction", "in").ilike("from_addr", `%${email}%`).order("sent_at", { ascending: false, nullsFirst: false }).limit(50);
    inbound = (data ?? []) as MsgRow[];
  }

  // 開封・クリックイベント(関連する送信メール全体。ボット/重複判定済みの kind は除外)
  const relatedIds = [...related.keys()];
  const { data: eventsR } = await sb
    .from("email_events")
    .select("id, email_message_id, kind, url, occurred_at")
    .in("email_message_id", relatedIds)
    .in("kind", ["open", "click"])
    .order("occurred_at", { ascending: false })
    .limit(300);
  const reactions = (eventsR ?? []) as { id: string; email_message_id: string; kind: string; url: string | null; occurred_at: string }[];

  const events: TimelineEvent[] = [];
  for (const r of related.values()) {
    events.push({
      id: r.id, at: r.sent_at ?? r.created_at ?? "", kind: "mail",
      label: r.id === m.id ? "このメール" : "メール送信",
      title: r.subject || "(件名なし)",
      body: r.id === m.id ? null : r.snippet,
      who: r.id === m.id ? senderName || null : null,
      href: r.id === m.id ? undefined : `/app/email/history/${r.id}`,
    });
  }
  for (const r of inbound) {
    events.push({
      id: r.id, at: r.sent_at ?? r.created_at ?? "", kind: "mail",
      label: "返信受信", title: r.subject || "(件名なし)", body: r.snippet,
    });
  }
  for (const e of reactions) {
    const src = related.get(e.email_message_id);
    events.push({
      id: e.id, at: e.occurred_at, kind: "reaction",
      label: e.kind === "open" ? "開封" : "クリック",
      title: src?.subject || "(件名なし)",
      body: e.kind === "click" ? e.url : null,
    });
  }
  // メール以外の接点(展示会・架電・セミナー等)。メール反応分は上のイベントで精密に出すため除外
  for (const [i, t] of touchpoints.entries()) {
    if (t.type in MAIL_TOUCH_WEIGHTS) continue;
    if (!t.occurred_at) continue;
    events.push({
      id: `tp-${i}`, at: t.occurred_at, kind: "activity",
      label: "接点", title: (TP_LABEL[t.type] ?? MAIL_TOUCH_LABEL[t.type] ?? t.type) + `（+${t.weight}pt）`,
    });
  }

  const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.logged;
  const grade = (lead?.priority_grade ?? null) as PriorityGrade | null;

  return (
    <div className="max-w-3xl">
      <Link href="/app/email/history" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 送信履歴一覧
      </Link>
      <PageHeader
        title={m.subject || "(件名なし)"}
        subtitle={`宛先: ${email || "—"}${m.sent_at ? `｜送信 ${formatDateTimeSecJst(m.sent_at)}` : ""}`}
        action={<span className={`pill text-xs font-bold ${st.cls}`}>{st.label}</span>}
      />

      {/* 誰に送ったか + エンゲージメント状況 */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-sm font-semibold text-ink">宛先</span>
          <div className="flex items-center gap-2">
            {lead && (
              <Link href={`/app/leads/${lead.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-teal-deep hover:underline">
                リード詳細を開く <ExternalLink size={12} />
              </Link>
            )}
            {rec?.accountId && (
              <Link href={`/app/accounts/${rec.accountId}`} className="inline-flex items-center gap-1 text-xs font-medium text-teal-deep hover:underline">
                顧客を開く <ExternalLink size={12} />
              </Link>
            )}
            {m.opportunity_id && (
              <Link href={`/app/opportunities/${m.opportunity_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-teal-deep hover:underline">
                案件を開く <ExternalLink size={12} />
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold text-ink">{rec?.company || lead?.company_name || "—"}</span>
          <span className="text-sm text-ink/70">{rec?.contact || lead?.contact_name || "—"}</span>
          <span className="text-xs text-ink/45">{email || "—"}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-3">
          <span className="text-xs text-ink/50">エンゲージメント</span>
          <span className={`pill text-xs font-bold ${ENG_COLOR[eng?.rank ?? "D"]}`}>{eng?.rank ?? "D"}</span>
          <span className="text-xs text-ink/60 tabular-nums">{eng?.score ?? 0} pt・接点 {eng?.touch_count ?? 0} 件</span>
          {grade && GRADE_DEFS[grade] && (
            <span className="pill text-xs font-bold bg-rose-100 text-rose-700" title="Fit(属性)×Engagement(反応)の優先グレード">
              {GRADE_DEFS[grade].label} — {GRADE_DEFS[grade].action}
            </span>
          )}
        </div>
      </Card>

      {/* 送信情報・反応 */}
      <Card className="mb-5">
        <span className="text-sm font-semibold text-ink block mb-2">送信情報と反応</span>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs mb-3">
          {[
            ["送信日時", m.sent_at ? formatDateTimeSecJst(m.sent_at) : "—"],
            ["送信者", senderName || "—"],
            ["送信方法", m.sent_via ? (MAIL_VIA_LABEL[m.sent_via] ?? m.sent_via) : "—"],
            ["宛先数", String((m.to_addrs ?? []).length)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-ink/40">{label}</dt>
              <dd className="text-ink/80 mt-0.5 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-4 text-xs text-ink/60">
          <span className="inline-flex items-center gap-1">
            <MailOpen size={13} className={m.open_count > 0 ? "text-teal-600" : "text-ink/30"} />
            開封 {m.open_count}回{m.last_opened_at && `（最終 ${formatDateTimeSecJst(m.last_opened_at)}）`}
          </span>
          <span className="inline-flex items-center gap-1">
            <MousePointerClick size={13} className={m.click_count > 0 ? "text-accent" : "text-ink/30"} />
            クリック {m.click_count}回{m.last_clicked_at && `（最終 ${formatDateTimeSecJst(m.last_clicked_at)}）`}
          </span>
        </div>
        {links.length > 0 && (
          <div className="mt-2 text-xs text-ink/60">
            <span className="text-ink/40">本文内のリンク:</span>
            <ul className="mt-1 space-y-0.5">
              {links.map((l, i) => (
                <li key={i} className="truncate">・{l.label || l.url}（クリック {l.click_count}回）</li>
              ))}
            </ul>
          </div>
        )}
        {m.snippet && <p className="mt-3 text-xs text-ink/55 whitespace-pre-line line-clamp-6 border-t border-black/[0.06] pt-2">{m.snippet}</p>}
        {m.status === "failed" && m.error_text && (
          <p className="mt-2 text-xs text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> {m.error_text}</p>
        )}
      </Card>

      <Section title="この宛先とのアクション（送信前後のタイムライン）">
        <p className="text-xs text-ink/45 mb-3">この宛先へのメール送受信・開封/クリック・展示会などの接点を、時系列で新しい順に表示します。</p>
        <UnifiedTimeline events={events} limit={80} />
      </Section>
    </div>
  );
}
