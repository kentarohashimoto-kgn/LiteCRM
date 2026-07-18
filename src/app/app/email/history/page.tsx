import Link from "next/link";
import { MailOpen, MousePointerClick, AlertTriangle, PenSquare } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";

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
}
interface LinkRow { email_message_id: string; url: string; label: string | null; click_count: number }

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  sent: { label: "送信済み", cls: "bg-emerald-100 text-emerald-700" },
  queued: { label: "送信中", cls: "bg-ink/10 text-ink/55" },
  failed: { label: "失敗", cls: "bg-rose-100 text-rose-700" },
  logged: { label: "記録のみ", cls: "bg-ink/[0.06] text-ink/55" },
};

/**
 * WO-22 メール送信履歴(F-101c)。送信状態・開封回数・クリック(どの資料か)を可視化。
 */
export default async function EmailHistoryPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data: msgs } = await sb
    .from("email_messages")
    .select("id, subject, to_addrs, status, sent_via, sent_at, open_count, last_opened_at, click_count, error_text, opportunity_id")
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(50);
  const messages = (msgs ?? []) as Msg[];

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

  return (
    <div>
      <PageHeader title="メール送信履歴" subtitle="送信状態・開封（近似）・リンククリック（どの資料か）の実績。" />
      <div className="mb-4">
        <Link href="/app/email/compose" className="btn-accent inline-flex items-center gap-1 text-sm">
          <PenSquare size={14} /> メールを作成する
        </Link>
      </div>

      <Section title="最近の送信（直近50件）">
        {messages.length === 0 ? (
          <EmptyState message="まだ送信・記録がありません。" />
        ) : (
          <div className="space-y-2">
            {messages.map((m) => {
              const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.logged;
              const links = (linksByMsg.get(m.id) ?? []).filter((l) => l.click_count > 0);
              return (
                <div key={m.id} className="rounded-xl border border-black/[0.06] p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`pill text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                    <span className="font-medium text-sm text-ink/90 truncate">{m.subject || "(件名なし)"}</span>
                    <span className="text-xs text-ink/40">→ {(m.to_addrs ?? []).join(", ")}</span>
                    {m.sent_at && <span className="ml-auto text-xs text-ink/40">{new Date(m.sent_at).toLocaleString("ja-JP")}</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-ink/60">
                    <span className="inline-flex items-center gap-1">
                      <MailOpen size={13} className={m.open_count > 0 ? "text-teal-600" : "text-ink/30"} />
                      開封 {m.open_count}回{m.last_opened_at && `（最終 ${new Date(m.last_opened_at).toLocaleString("ja-JP")}）`}
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
