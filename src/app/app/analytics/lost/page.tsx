import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { LOST_REASONS, LOST_REASON_MAP } from "@/lib/constants";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface LostRow {
  id: string;
  name: string;
  amount: number;
  lost_reason: string | null;
  lost_reason_code: string | null;
  lost_competitor: string | null;
  expected_close_date: string | null;
  owner_user_id: string | null;
  updated_at: string;
  accounts: { name: string } | null;
}

function monthOf(r: LostRow): string {
  const d = r.expected_close_date ?? r.updated_at;
  return d ? d.slice(0, 7) : "—";
}

/** C-4 失注分析: 理由別・競合別・月別に「なぜ負けたか」を可視化する。 */
export default async function LostAnalysisPage() {
  const ws = await getWorkspaceLite();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select("id,name,amount,lost_reason,lost_reason_code,lost_competitor,expected_close_date,owner_user_id,updated_at,accounts(name)")
    .eq("status", "lost")
    .order("updated_at", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as unknown as LostRow[];

  const totalAmount = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  const coded = rows.filter((r) => r.lost_reason_code);

  // 理由別
  const byReason = new Map<string, { n: number; amount: number }>();
  for (const r of rows) {
    const key = r.lost_reason_code ?? "__uncoded";
    const cur = byReason.get(key) ?? { n: 0, amount: 0 };
    cur.n += 1;
    cur.amount += r.amount ?? 0;
    byReason.set(key, cur);
  }
  const reasonRows = [
    ...LOST_REASONS.map((r) => ({ key: r.key, label: r.label, ...(byReason.get(r.key) ?? { n: 0, amount: 0 }) })),
    { key: "__uncoded", label: "（理由未分類）", ...(byReason.get("__uncoded") ?? { n: 0, amount: 0 }) },
  ].filter((r) => r.n > 0);
  const maxReasonN = Math.max(1, ...reasonRows.map((r) => r.n));

  // 競合別
  const byCompetitor = new Map<string, { n: number; amount: number }>();
  for (const r of rows) {
    const c = (r.lost_competitor ?? "").trim();
    if (!c) continue;
    const cur = byCompetitor.get(c) ?? { n: 0, amount: 0 };
    cur.n += 1;
    cur.amount += r.amount ?? 0;
    byCompetitor.set(c, cur);
  }
  const competitorRows = Array.from(byCompetitor.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 15);

  // 月別(直近12ヶ月)
  const byMonth = new Map<string, { n: number; amount: number }>();
  for (const r of rows) {
    const m = monthOf(r);
    const cur = byMonth.get(m) ?? { n: 0, amount: 0 };
    cur.n += 1;
    cur.amount += r.amount ?? 0;
    byMonth.set(m, cur);
  }
  const monthRows = Array.from(byMonth.entries())
    .filter(([m]) => m !== "—")
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12);

  return (
    <div>
      <PageHeader
        title="失注分析"
        subtitle="理由別・競合別・月別に失注を集計します。理由コードは案件詳細の「案件を更新」で入力できます。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">失注案件数</div><div className="stat-value mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">失注総額</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(totalAmount)}</div></Card>
        <Card><div className="text-xs text-ink/50">理由コード入力率</div><div className="stat-value mt-1">{rows.length ? Math.round((coded.length / rows.length) * 100) : 0}<span className="stat-unit">%</span></div></Card>
        <Card><div className="text-xs text-ink/50">競合起因</div><div className="stat-value mt-1">{rows.filter((r) => r.lost_reason_code === "competitor").length}<span className="stat-unit">件</span></div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="理由別">
          {reasonRows.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">失注データがありません</p>
          ) : (
            <ul className="space-y-2">
              {reasonRows.sort((a, b) => b.n - a.n).map((r) => (
                <li key={r.key} className="text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className={r.key === "__uncoded" ? "text-ink/40" : "text-ink/80"}>{r.label}</span>
                    <span className="text-xs text-ink/50 tabular-nums shrink-0">{r.n}件 ・ {formatYen(r.amount)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/[0.05] mt-1">
                    <div className="h-1.5 rounded-full bg-rose-300" style={{ width: `${Math.round((r.n / maxReasonN) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="競合別（負けた相手）">
          {competitorRows.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">競合名の入力がまだありません。「案件を更新」の「負けた競合」に入力すると集計されます。</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink/40 text-left"><th className="pb-1.5">競合</th><th className="pb-1.5 text-right">件数</th><th className="pb-1.5 text-right">金額</th></tr></thead>
              <tbody>
                {competitorRows.map((c) => (
                  <tr key={c.name} className="border-t border-black/[0.04]">
                    <td className="py-1.5">{c.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.n}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatYen(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="月別（受注予定月ベース・直近12ヶ月）">
          {monthRows.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">データがありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink/40 text-left"><th className="pb-1.5">月</th><th className="pb-1.5 text-right">件数</th><th className="pb-1.5 text-right">金額</th></tr></thead>
              <tbody>
                {monthRows.map(([m, v]) => (
                  <tr key={m} className="border-t border-black/[0.04]">
                    <td className="py-1.5">{m.replace("-", "年")}月</td>
                    <td className="py-1.5 text-right tabular-nums">{v.n}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatYen(v.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="最近の失注（50件）">
          <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {rows.slice(0, 50).map((r) => (
              <li key={r.id} className="text-sm border-b border-black/[0.04] pb-2">
                <div className="flex items-center gap-2">
                  <Link href={`/app/opportunities/${r.id}`} className="font-medium text-ink hover:text-teal-deep hover:underline truncate">
                    {r.accounts?.name ? `${r.accounts.name}｜` : ""}{r.name}
                  </Link>
                  <span className="text-xs text-ink/45 tabular-nums shrink-0 ml-auto">{formatYen(r.amount)}</span>
                </div>
                <div className="text-xs text-ink/45 mt-0.5">
                  {r.lost_reason_code ? LOST_REASON_MAP[r.lost_reason_code] ?? r.lost_reason_code : "理由未分類"}
                  {r.lost_competitor ? ` ・ 競合: ${r.lost_competitor}` : ""}
                  {r.lost_reason ? ` ・ ${r.lost_reason.slice(0, 40)}` : ""}
                  {` ・ ${ws.usersById.get(r.owner_user_id ?? "")?.name ?? "—"}`}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
