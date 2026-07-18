import Link from "next/link";
import { PenSquare, MailOpen, MousePointerClick, Reply, Send } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, StatCard, EmptyState, ProgressBar } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 1000) / 10}%`;
}

/**
 * ① メール成果ダッシュボード(F-101)。送信/開封/クリック/返信の成果と、
 * シーケンスの状況、よくクリックされた資料を可視化する。
 * 開封は近似値(Gmailプロキシ/Appleプリフェッチで誤差)である旨を明記。
 */
export default async function EmailAnalyticsPage() {
  await requireCtx();
  const sb = getSupabaseServer();

  // 計測対象の送信(アプリ経由=smtp/gmail_api)。手動記録(logged)は計測外。
  const trackedBase = () => sb.from("email_messages").select("id", { count: "exact", head: true }).eq("direction", "out").in("sent_via", ["smtp", "gmail_api"]).eq("status", "sent");

  const [sentR, openedR, clickedR, repliesR, seqAgg, linksR, byDayR] = await Promise.all([
    trackedBase(),
    trackedBase().gt("open_count", 0),
    trackedBase().gt("click_count", 0),
    sb.from("email_messages").select("id", { count: "exact", head: true }).eq("direction", "in").not("in_reply_to", "is", null),
    sb.from("sequence_enrollments").select("status"),
    sb.from("email_links").select("url, label, click_count").gt("click_count", 0).order("click_count", { ascending: false }).limit(10),
    sb.from("email_messages").select("sent_at, open_count, click_count").eq("direction", "out").in("sent_via", ["smtp", "gmail_api"]).eq("status", "sent").order("sent_at", { ascending: false }).limit(500),
  ]);

  const sent = sentR.count ?? 0;
  const opened = openedR.count ?? 0;
  const clicked = clickedR.count ?? 0;
  const replies = repliesR.count ?? 0;

  const enr = (seqAgg.data ?? []) as { status: string }[];
  const seqActive = enr.filter((e) => e.status === "active").length;
  const seqCompleted = enr.filter((e) => e.status === "completed").length;
  const seqStopped = enr.filter((e) => e.status === "stopped").length;

  const links = (linksR.data ?? []) as { url: string; label: string | null; click_count: number }[];

  // 直近30日の日別送信数
  const byDay = new Map<string, number>();
  for (const m of (byDayR.data ?? []) as { sent_at: string | null }[]) {
    if (!m.sent_at) continue;
    const d = new Date(new Date(m.sent_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const recentDays = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
  const maxDay = Math.max(1, ...recentDays.map(([, n]) => n));

  return (
    <div>
      <PageHeader title="メール成果" subtitle="アプリ経由で送信したメールの開封・クリック・返信の成果。開封は近似値（Gmailのプロキシやメールプライバシー保護で誤差が出ます）。" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/app/email/compose" className="btn-accent inline-flex items-center gap-1 text-sm"><PenSquare size={14} /> メールを作成</Link>
        <Link href="/app/email/history" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">送信履歴</Link>
        <Link href="/app/email/sequences" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">シーケンス</Link>
      </div>

      <Section title="成果サマリー" className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="送信（計測対象）" raw={String(sent)} accent />
          <StatCard label="開封率" raw={pct(opened, sent)} sub={<span>{opened}件が開封（近似）</span>} />
          <StatCard label="クリック率" raw={pct(clicked, sent)} sub={<span>{clicked}件がクリック</span>} />
          <StatCard label="返信率" raw={pct(replies, sent)} sub={<span>{replies}件の返信</span>} />
        </div>
      </Section>

      <Section title="ファネル" className="mb-6">
        <div className="space-y-3 max-w-lg">
          <FunnelRow icon={<Send size={14} />} label="送信" value={sent} max={sent} />
          <FunnelRow icon={<MailOpen size={14} />} label="開封（近似）" value={opened} max={sent} />
          <FunnelRow icon={<MousePointerClick size={14} />} label="クリック" value={clicked} max={sent} />
          <FunnelRow icon={<Reply size={14} />} label="返信" value={replies} max={sent} />
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="シーケンス状況">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="進行中" raw={String(seqActive)} />
            <StatCard label="完了" raw={String(seqCompleted)} />
            <StatCard label="停止" raw={String(seqStopped)} />
          </div>
          <p className="text-xs text-ink/40 mt-2">停止には受注/失注/アポ化・返信による自動停止と手動停止が含まれます。</p>
        </Section>

        <Section title="よくクリックされた資料/リンク（上位10）">
          {links.length === 0 ? (
            <EmptyState message="まだクリックの記録がありません。" />
          ) : (
            <ul className="space-y-1.5">
              {links.map((l, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="pill text-[10px] bg-accent/10 text-accent font-bold shrink-0">{l.click_count}</span>
                  <span className="truncate text-ink/75">{l.label || l.url}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="直近の送信数（日別）" className="mt-4">
        {recentDays.length === 0 ? (
          <EmptyState message="送信の記録がまだありません。" />
        ) : (
          <div className="space-y-1.5 max-w-xl">
            {recentDays.map(([d, n]) => (
              <div key={d} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-ink/50 shrink-0">{d.slice(5)}</span>
                <div className="flex-1 h-4 bg-mist-soft/40 rounded overflow-hidden">
                  <div className="h-full bg-teal-500/70" style={{ width: `${(n / maxDay) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-ink/60">{n}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function FunnelRow({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ink/60 mb-1">
        <span className="inline-flex items-center gap-1">{icon} {label}</span>
        <span className="text-ink/80 font-medium">{value}{max ? `（${Math.round((value / Math.max(1, max)) * 100)}%）` : ""}</span>
      </div>
      <ProgressBar value={value} max={Math.max(1, max)} tone="teal" />
    </div>
  );
}
