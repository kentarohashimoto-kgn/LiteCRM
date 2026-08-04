import Link from "next/link";
import { ArrowLeft, CalendarRange, Coins } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { budgetRatio } from "@/lib/ai-lab/limits";
import { modelLabel } from "@/lib/ai-lab/models";
import {
  byCompanyMonth,
  byModel,
  formatUsd,
  momChange,
  monthBounds,
  monthLabel,
  recentMonths,
  totalsFor,
  type UsageDailyRow,
} from "@/lib/ai-lab/usage-report";

export const dynamic = "force-dynamic";

const TREND_MONTHS = 12;

interface Company {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  monthly_token_budget: number | null;
}

/**
 * 会社横断の月別レポート。
 * 「どの会社が・どの月に・いくら使ったか」を1枚で見て、予算の見直し判断につなげる画面。
 */
export default async function AiLabReportsPage(props: { searchParams: Promise<{ month?: string }> }) {
  const searchParams = await props.searchParams;
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const months = recentMonths(TREND_MONTHS);
  const focusMonth = months.includes(searchParams.month ?? "") ? searchParams.month! : months[months.length - 1];
  const trendFrom = monthBounds(months[0]).from;
  const focus = monthBounds(focusMonth);

  const [companiesR, usageR] = await Promise.all([
    sb
      .from("ai_lab_companies")
      .select("id, name, slug, is_active, monthly_token_budget")
      .order("created_at", { ascending: true }),
    sb
      .from("ai_lab_usage_daily")
      .select("date, company_id, model_key, requests, input_tokens, output_tokens, images")
      .gte("date", trendFrom),
  ]);

  const companies = (companiesR.data ?? []) as Company[];
  const usage = (usageR.data ?? []) as UsageDailyRow[];
  const matrix = byCompanyMonth(usage, months, companies.map((c) => c.id));

  // 選択中の月の全社合計と、その前月との比較。
  const focusRows = usage.filter((r) => r.date >= focus.from && r.date <= focus.to);
  const focusTotals = totalsFor(focusRows);
  const prevMonth = months[months.indexOf(focusMonth) - 1];
  const prevTotals = prevMonth
    ? totalsFor(
        usage.filter((r) => {
          const b = monthBounds(prevMonth);
          return r.date >= b.from && r.date <= b.to;
        }),
      )
    : null;
  const tokenMom = prevTotals ? momChange(focusTotals.totalTokens, prevTotals.totalTokens) : null;
  const models = byModel(focusRows);

  return (
    <div>
      <PageHeader
        title="AI体験環境 月別レポート"
        subtitle="会社ごとの利用量と概算コストの推移。予算の設定・見直しの判断材料に使います。"
        action={
          <Link href="/app/ai-lab" className="btn-ghost inline-flex items-center gap-1.5">
            <ArrowLeft size={14} />
            会社一覧へ戻る
          </Link>
        }
      />

      <form className="card card-pad mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">対象月</label>
          <select name="month" defaultValue={focusMonth} className="input w-auto">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-ghost">
          表示
        </button>
        <p className="ml-auto text-[11px] text-ink/45 text-legible">
          概算コストは定価ベースの目安です。請求額とは一致しません。
        </p>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`${monthLabel(focusMonth)} のトークン`} raw={focusTotals.totalTokens.toLocaleString()} />
        <StatCard label="概算コスト" raw={formatUsd(focusTotals.usd)} accent sub="全社合計" />
        <StatCard label="リクエスト" raw={focusTotals.requests.toLocaleString()} />
        <StatCard
          label="前月比（トークン）"
          raw={tokenMom == null ? "—" : `${tokenMom > 0 ? "+" : ""}${Math.round(tokenMom * 100)}%`}
          sub={prevTotals ? `前月 ${prevTotals.totalTokens.toLocaleString()}` : "比較対象なし"}
        />
      </div>

      <Section title={`会社別（${monthLabel(focusMonth)}）`} icon={<Coins size={14} />} className="mb-6">
        {companies.length === 0 ? (
          <EmptyState message="会社が登録されていません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">会社</th>
                  <th className="th text-right">リクエスト</th>
                  <th className="th text-right">合計トークン</th>
                  <th className="th text-right">画像</th>
                  <th className="th text-right">概算コスト</th>
                  <th className="th">月間予算</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const t = matrix[c.id]?.[focusMonth];
                  const ratio = budgetRatio(t?.totalTokens ?? 0, c.monthly_token_budget);
                  return (
                    <tr key={c.id} className="row-hover border-t border-black/[0.04]">
                      <td className="td">
                        <Link href={`/app/ai-lab/${c.id}/usage`} className="font-semibold text-teal-deep hover:underline">
                          {c.name}
                        </Link>
                        {!c.is_active && <span className="pill ml-2 bg-ink/10 text-ink/55">停止中</span>}
                      </td>
                      <td className="td text-right tabular-nums">{(t?.requests ?? 0).toLocaleString()}</td>
                      <td className="td text-right tabular-nums font-semibold">
                        {(t?.totalTokens ?? 0).toLocaleString()}
                      </td>
                      <td className="td text-right tabular-nums">{(t?.images ?? 0).toLocaleString()}</td>
                      <td className="td text-right tabular-nums">{t && t.usd > 0 ? formatUsd(t.usd) : "—"}</td>
                      <td className="td">
                        {ratio == null ? (
                          <Link href={`/app/ai-lab/${c.id}`} className="text-xs text-ink/45 hover:text-teal-deep hover:underline">
                            無制限（設定する）
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[0.06]">
                              <div
                                className={`h-full ${ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-accent-orange" : "bg-teal-primary"}`}
                                style={{ width: `${Math.min(100, ratio * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-ink/60">{Math.round(ratio * 100)}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {models.length > 0 && (
          <div className="mt-5 border-t border-black/[0.06] pt-4">
            <p className="mb-2 text-xs font-semibold text-ink/60">モデル別の内訳</p>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <span key={m.modelKey} className="pill bg-mist-soft text-ink/70">
                  {modelLabel(m.modelKey)}: {m.totals.totalTokens.toLocaleString()} トークン
                  {m.totals.usd > 0 && ` / ${formatUsd(m.totals.usd)}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title={`月別推移（直近${TREND_MONTHS}か月・合計トークン）`} icon={<CalendarRange size={14} />}>
        {companies.length === 0 ? (
          <EmptyState message="会社が登録されていません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th sticky left-0 bg-white">会社</th>
                  {months.map((m) => (
                    <th key={m} className="th text-right">
                      {monthLabel(m).replace(/^\d{4}年/, "")}
                    </th>
                  ))}
                  <th className="th text-right">概算コスト計</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const row = matrix[c.id] ?? {};
                  const costTotal = months.reduce((acc, m) => acc + (row[m]?.usd ?? 0), 0);
                  return (
                    <tr key={c.id} className="row-hover border-t border-black/[0.04]">
                      <td className="td sticky left-0 bg-white font-medium">
                        <Link href={`/app/ai-lab/${c.id}/usage`} className="text-teal-deep hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      {months.map((m) => {
                        const tokens = row[m]?.totalTokens ?? 0;
                        return (
                          <td
                            key={m}
                            className={`td text-right tabular-nums ${
                              m === focusMonth ? "bg-teal-light/40 font-semibold" : tokens === 0 ? "text-ink/25" : ""
                            }`}
                          >
                            {tokens === 0 ? "—" : tokens.toLocaleString()}
                          </td>
                        );
                      })}
                      <td className="td text-right tabular-nums">{costTotal > 0 ? formatUsd(costTotal) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink/45 text-legible">
          月をクリックする代わりに、上の「対象月」で切り替えると会社別の内訳が入れ替わります。
        </p>
      </Section>
    </div>
  );
}
