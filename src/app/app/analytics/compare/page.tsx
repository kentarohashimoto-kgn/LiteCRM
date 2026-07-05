import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MonthRow {
  month: string; // YYYY-MM
  leads: number;
  appts: number;
  won_count: number;
  won_amount: number;
}

type MetricKey = "leads" | "appts" | "won_count" | "won_amount";

const METRICS: { key: MetricKey; label: string; isYen?: boolean }[] = [
  { key: "leads", label: "リード獲得" },
  { key: "appts", label: "アポ（初回商談）" },
  { key: "won_count", label: "受注件数" },
  { key: "won_amount", label: "受注額", isYen: true },
];

function ratio(cur: number, base: number): number | null {
  if (base === 0) return null;
  return (cur - base) / base;
}

function Delta({ cur, base }: { cur: number; base: number }) {
  const r = ratio(cur, base);
  if (r === null) return <span className="text-xs text-ink/30">—</span>;
  const pct = `${r >= 0 ? "+" : ""}${Math.round(r * 100)}%`;
  if (Math.abs(r) < 0.005) return <span className="inline-flex items-center gap-0.5 text-xs text-ink/40"><Minus size={11} />{pct}</span>;
  return r > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600"><ArrowUpRight size={11} />{pct}</span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-600"><ArrowDownRight size={11} />{pct}</span>
  );
}

function label(m: string): string {
  return `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
}

/** C-6 期間比較レポート: 主要指標の前月比・前年同月比を自動表示。 */
export default async function ComparePage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("period_compare");
  const rows = ((data ?? []) as MonthRow[]).slice();
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  const cur = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const lastYear = cur ? byMonth.get(`${Number(cur.month.slice(0, 4)) - 1}${cur.month.slice(4)}`) : undefined;
  const recent = rows.slice(-13).reverse(); // 当月含む直近13ヶ月(前年同月比較用に13)

  return (
    <div>
      <PageHeader
        title="期間比較レポート"
        subtitle="リード・アポ・受注の前月比／前年同月比を自動集計します。毎月の振り返り資料にそのまま使えます。"
      />

      {cur && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {METRICS.map((m) => {
            const v = cur[m.key];
            return (
              <Card key={m.key}>
                <div className="text-xs text-ink/50">{m.label}（{label(cur.month)}）</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{m.isYen ? formatYen(v) : v.toLocaleString()}</div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[11px] text-ink/40">前月比 {prev ? <Delta cur={v} base={prev[m.key]} /> : "—"}</span>
                  <span className="text-[11px] text-ink/40">前年比 {lastYear ? <Delta cur={v} base={lastYear[m.key]} /> : "—"}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Section title="月次推移（直近13ヶ月）">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-ink/40 text-left">
                <th className="pb-1.5">月</th>
                {METRICS.map((m) => <th key={m.key} className="pb-1.5 text-right">{m.label}</th>)}
                <th className="pb-1.5 text-right">受注額 前月比</th>
                <th className="pb-1.5 text-right">受注額 前年比</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const idx = rows.findIndex((x) => x.month === r.month);
                const p = idx > 0 ? rows[idx - 1] : undefined;
                const y = byMonth.get(`${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`);
                return (
                  <tr key={r.month} className="border-t border-black/[0.04]">
                    <td className="py-1.5">{label(r.month)}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.leads.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.appts.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.won_count.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatYen(r.won_amount)}</td>
                    <td className="py-1.5 text-right">{p ? <Delta cur={r.won_amount} base={p.won_amount} /> : "—"}</td>
                    <td className="py-1.5 text-right">{y ? <Delta cur={r.won_amount} base={y.won_amount} /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink/35 mt-2">
          リード=獲得日ベース ・ アポ=初回商談日ベース ・ 受注=受注予定日ベース。ゴミ箱内のデータは含みません。
        </p>
      </Section>
    </div>
  );
}
