import Link from "next/link";
import { MailOpen, MousePointerClick, AlertTriangle, PenSquare } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { HistoryToolbar } from "@/components/email/history-toolbar";
import { jstRangeToUtc } from "@/lib/mail-export";
import type { MailHistoryFilters } from "@/server/actions/mail-export";
import { resolveMailRecipients } from "@/lib/data/mail-recipients";
import { formatDateTimeSecJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Msg {
  id: string;
  subject: string | null;
  to_addrs: string[];
  status: string;
  sent_via: string | null;
  sent_at: string | null;
  open_count: number;
  last_opened_at: string | null;
  click_count: number;
  error_text: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  account_id: string | null;
}
interface LinkRow { email_message_id: string; url: string; label: string | null; click_count: number }

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  sent: { label: "送信済み", cls: "bg-emerald-100 text-emerald-700" },
  queued: { label: "送信中", cls: "bg-ink/10 text-ink/55" },
  failed: { label: "失敗", cls: "bg-rose-100 text-rose-700" },
  logged: { label: "記録のみ", cls: "bg-ink/[0.06] text-ink/55" },
};

/** 一覧の表示件数(全件はCSVダウンロードで取得する)。 */
const LIST_LIMIT = 100;

/**
 * WO-22 メール送信履歴(F-101c)。送信状態・開封回数・クリック(どの資料か)を可視化。
 * 件数が増えるため期間などで絞り込み、同じ条件のままCSVで一括ダウンロードできる。
 */
export default async function EmailHistoryPage({ searchParams }: {
  searchParams: { from?: string; to?: string; status?: string; sender?: string; reaction?: string };
}) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const filters: MailHistoryFilters = {
    from: searchParams.from ?? "", to: searchParams.to ?? "",
    status: searchParams.status ?? "", sender: searchParams.sender ?? "", reaction: searchParams.reaction ?? "",
  };
  const range = jstRangeToUtc(filters.from, filters.to);

  // 一覧とダウンロードで同じ条件を使う(表示=出力)
  let qy = sb
    .from("email_messages")
    .select("id, subject, to_addrs, status, sent_via, sent_at, open_count, last_opened_at, click_count, error_text, opportunity_id, lead_id, contact_id, account_id", { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .eq("direction", "out");
  if (range.gte) qy = qy.gte("sent_at", range.gte);
  if (range.lt) qy = qy.lt("sent_at", range.lt);
  if (filters.status) qy = qy.eq("status", filters.status);
  if (filters.sender) qy = qy.eq("logged_by", filters.sender);
  if (filters.reaction === "opened") qy = qy.gt("open_count", 0);
  if (filters.reaction === "clicked") qy = qy.gt("click_count", 0);

  const [{ data: msgs, count }, profR] = await Promise.all([
    qy.order("sent_at", { ascending: false, nullsFirst: false }).limit(LIST_LIMIT),
    sb.from("profiles").select("id, display_name, email"),
  ]);
  const messages = (msgs ?? []) as Msg[];
  const total = count ?? messages.length;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const senders = ((profR.data ?? []) as any[]).map((p) => ({
    id: p.id as string, name: ((p.display_name as string) || (p.email as string)) ?? "",
  })).filter((p) => p.name);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const ids = messages.map((m) => m.id);
  const linksByMsg = new Map<string, LinkRow[]>();
  if (ids.length) {
    const { data: links } = await sb
      .from("email_links")
      .select("email_message_id, url, label, click_count")
      .in("email_message_id", ids);
    for (const l of (links ?? []) as LinkRow[]) {
      const arr = linksByMsg.get(l.email_message_id) ?? [];
      arr.push(l);
      linksByMsg.set(l.email_message_id, arr);
    }
  }

  // 誰に送ったか(会社名・担当者名)。リード→取引先担当者→顧客の順に解決(CSVと同一ロジック)
  const recipients = await resolveMailRecipients(messages);

  return (
    <div>
      <PageHeader title="メール送信履歴" subtitle="送信状態・開封（近似）・リンククリック（どの資料か）の実績。" />
      <div className="mb-4">
        <Link href="/app/email/compose" className="btn-accent inline-flex items-center gap-1 text-sm">
          <PenSquare size={14} /> メールを作成する
        </Link>
      </div>

      <HistoryToolbar filters={filters} senders={senders} total={total} />

      <Section title={total > LIST_LIMIT ? `送信履歴（新しい順 ${LIST_LIMIT}件を表示 / 全 ${total.toLocaleString()}件。全件はCSVでダウンロードできます）` : `送信履歴（${total.toLocaleString()}件）`}>
        {messages.length === 0 ? (
          <EmptyState message="該当する送信履歴がありません。期間・条件を変えてお試しください。" />
        ) : (
          <div className="space-y-2">
            {messages.map((m) => {
              const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.logged;
              const links = (linksByMsg.get(m.id) ?? []).filter((l) => l.click_count > 0);
              const rec = recipients.get(m.id);
              return (
                <div key={m.id} className="rounded-xl border border-black/[0.06] p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`pill text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                    {(rec?.company || rec?.contact) ? (
                      <span className="text-sm truncate">
                        <span className="font-semibold text-ink">{rec.company || "(会社名未設定)"}</span>
                        {rec.contact && <span className="text-ink/70 ml-1.5">{rec.contact}</span>}
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-ink/60 truncate">{(m.to_addrs ?? []).join(", ") || "宛先不明"}</span>
                    )}
                    <span className="text-xs text-ink/40 truncate">→ {(m.to_addrs ?? []).join(", ")}</span>
                    <span className="ml-auto inline-flex items-center gap-3 whitespace-nowrap">
                      {m.sent_at && <span className="text-xs text-ink/40">{formatDateTimeSecJst(m.sent_at)}</span>}
                      <Link href={`/app/email/history/${m.id}`} className="text-xs font-medium text-teal-700 underline">詳細</Link>
                    </span>
                  </div>
                  <p className="text-sm text-ink/80 truncate mb-1">{m.subject || "(件名なし)"}</p>
                  <div className="flex items-center gap-4 text-xs text-ink/60">
                    <span className="inline-flex items-center gap-1">
                      <MailOpen size={13} className={m.open_count > 0 ? "text-teal-600" : "text-ink/30"} />
                      開封 {m.open_count}回{m.last_opened_at && `（最終 ${formatDateTimeSecJst(m.last_opened_at)}）`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick size={13} className={m.click_count > 0 ? "text-accent" : "text-ink/30"} />
                      クリック {m.click_count}回
                    </span>
                    {m.opportunity_id && (
                      <Link href={`/app/opportunities/${m.opportunity_id}`} className="text-teal-700 underline">案件を開く</Link>
                    )}
                  </div>
                  {links.length > 0 && (
                    <div className="mt-2 text-xs text-ink/60">
                      <span className="text-ink/40">クリックされた資料/リンク:</span>
                      <ul className="mt-1 space-y-0.5">
                        {links.map((l, i) => (
                          <li key={i} className="truncate">・{l.label || l.url}（{l.click_count}回）</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.status === "failed" && m.error_text && (
                    <p className="mt-1 text-xs text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> {m.error_text}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
