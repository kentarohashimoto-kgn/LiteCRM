import Link from "next/link";
import { PenSquare, BarChart3, Send } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * 一括メールのセグメント履歴・反応分析（F-206）。
 * ・セグメント（一括送信1回）ごとの 送信数 / 開封 / クリック / 返信
 * ・流入(raw_event)ごとの リード数 × メール反応 × 架電・アポ状況
 * 集計はSQL RPC（0173）で行を転送しない。
 */

interface BatchRow {
  id: string; title: string; createdAt: string; templateId: string | null; sentBy: string | null;
  sent: number; failed: number; opened: number; clicked: number; replied: number;
}
interface EventRow {
  event: string; leads: number; withEmail: number; mailed: number;
  opened: number; clicked: number; replied: number; touched: number; appointments: number; converted: number;
}

function jstLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.toISOString().slice(0, 10).replaceAll("-", "/")} ${d.toISOString().slice(11, 16)}`;
}

function Rate({ n, d }: { n: number; d: number }) {
  if (d <= 0) return <span className="text-ink/30 text-xs">—</span>;
  const pct = Math.round((n / d) * 100);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums text-sm">{pct}%</span>
      <span className="inline-block h-1.5 w-14 rounded bg-mist-soft overflow-hidden">
        <span className="block h-full bg-teal-primary" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="text-[10px] text-ink/40 tabular-nums">{n}/{d}</span>
    </span>
  );
}

export default async function EmailSegmentsPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const [b, e, tplR, profR] = await Promise.all([
    sb.rpc("lead_mail_batch_stats"),
    sb.rpc("lead_event_mail_stats"),
    sb.from("email_templates").select("id, name"),
    sb.from("profiles").select("id, display_name, email"),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const batches = ((b.data ?? []) as any[]) as BatchRow[];
  const events = (((e.data ?? []) as any[]) as EventRow[]).filter((x) => x.leads > 0);
  const tplMap = new Map(((tplR.data ?? []) as any[]).map((t) => [t.id as string, t.name as string]));
  const profMap = new Map(((profR.data ?? []) as any[]).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || ""]));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const mailedEvents = events.filter((x) => x.mailed > 0);
  const otherEvents = events.filter((x) => x.mailed === 0);

  return (
    <div>
      <PageHeader
        title="一括メール セグメント分析"
        subtitle="一括送信の履歴（セグメント）ごとの反応率と、流入別のアクション状況を確認します。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/leads" className="btn-accent inline-flex items-center gap-1 text-sm"><Send size={14} /> リードから一括送信</Link>
            <Link href="/app/email/analytics" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70"><BarChart3 size={14} /> メール分析</Link>
            <Link href="/app/email/history" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70"><PenSquare size={14} /> 送信履歴</Link>
          </div>
        }
      />

      <Section title={`送信セグメント履歴（${batches.length}）`} className="mb-6">
        {batches.length === 0 ? (
          <EmptyState message="まだ一括送信の履歴がありません。リード一覧の「一括メール」から送信すると、ここにセグメントとして記録されます。" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">送信日時</th>
                  <th className="th">セグメント名</th>
                  <th className="th">テンプレ / 実行者</th>
                  <th className="th text-right">送信</th>
                  <th className="th">開封率</th>
                  <th className="th">クリック率</th>
                  <th className="th">返信率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {batches.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td className="td text-xs text-ink/60 tabular-nums whitespace-nowrap">{jstLabel(r.createdAt)}</td>
                    <td className="td font-medium text-ink max-w-[260px] truncate">{r.title}</td>
                    <td className="td text-xs text-ink/55">
                      {r.templateId ? tplMap.get(r.templateId) ?? "(削除済みテンプレ)" : "—"}
                      <span className="block text-ink/40">{r.sentBy ? profMap.get(r.sentBy) : ""}</span>
                    </td>
                    <td className="td text-right tabular-nums">
                      {r.sent}
                      {r.failed > 0 && <span className="block text-[10px] text-rose-600">失敗 {r.failed}</span>}
                    </td>
                    <td className="td"><Rate n={r.opened} d={r.sent} /></td>
                    <td className="td"><Rate n={r.clicked} d={r.sent} /></td>
                    <td className="td"><Rate n={r.replied} d={r.sent} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="流入別の反応・アクション状況">
        <p className="text-xs text-ink/50 mb-2 px-1">
          展示会・セミナーなど流入（取込イベント）ごとに、メール反応と架電・アポの進み具合を横断で見ます。反応率の高い流入ほど優先的にアプローチしてください。
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-black/[0.06]">
              <tr>
                <th className="th">流入</th>
                <th className="th text-right">リード</th>
                <th className="th text-right">メール送信</th>
                <th className="th">開封率</th>
                <th className="th">クリック率</th>
                <th className="th text-right">返信</th>
                <th className="th">架電着手率</th>
                <th className="th text-right">アポ</th>
                <th className="th text-right">商談化</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {[...mailedEvents, ...otherEvents].map((r) => (
                <tr key={r.event} className="row-hover">
                  <td className="td font-medium text-ink max-w-[220px] truncate">{r.event}</td>
                  <td className="td text-right tabular-nums">{r.leads.toLocaleString()}<span className="block text-[10px] text-ink/40">メールあり {r.withEmail.toLocaleString()}</span></td>
                  <td className="td text-right tabular-nums">{r.mailed.toLocaleString()}</td>
                  <td className="td"><Rate n={r.opened} d={r.mailed} /></td>
                  <td className="td"><Rate n={r.clicked} d={r.mailed} /></td>
                  <td className="td text-right tabular-nums">{r.replied}</td>
                  <td className="td"><Rate n={r.touched} d={r.leads} /></td>
                  <td className="td text-right tabular-nums">{r.appointments}</td>
                  <td className="td text-right tabular-nums">{r.converted}</td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={9} className="td text-center text-ink/40 py-8">リードがまだありません</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
