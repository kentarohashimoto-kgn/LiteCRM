import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, MessagesSquare, TrendingUp } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { AiLabUsageTrendChart } from "@/components/charts/ai-lab-usage-chart";
import { CompanyTabs } from "@/components/ai-lab/admin/company-tabs";
import { budgetRatio, monthRange } from "@/lib/ai-lab/limits";
import { modelLabel } from "@/lib/ai-lab/models";
import {
  byMonth,
  formatUsd,
  momChange,
  monthBounds,
  recentMonths,
  totalsFor,
  type UsageDailyRow,
} from "@/lib/ai-lab/usage-report";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TREND_MONTHS = 12;

interface UsageRow extends UsageDailyRow {
  user_id: string;
}

export default async function AiLabUsagePage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const defaults = monthRange();
  const from = searchParams.from || defaults.from;
  const to = searchParams.to || defaults.to;

  // 推移は「直近12か月」で固定。上の期間セレクタは明細用で、推移とは別軸にする。
  const months = recentMonths(TREND_MONTHS);
  const trendFrom = monthBounds(months[0]).from;

  const [{ data: company }, usageR, trendR, usersR, convR] = await Promise.all([
    sb.from("ai_lab_companies").select("id, name, monthly_token_budget").eq("id", params.companyId).maybeSingle(),
    sb
      .from("ai_lab_usage_daily")
      .select("date, user_id, model_key, requests, input_tokens, output_tokens, images")
      .eq("company_id", params.companyId)
      .gte("date", from)
      .lte("date", to),
    sb
      .from("ai_lab_usage_daily")
      .select("date, model_key, requests, input_tokens, output_tokens, images")
      .eq("company_id", params.companyId)
      .gte("date", trendFrom),
    sb.from("ai_lab_users").select("id, display_name, login_id").eq("company_id", params.companyId),
    sb
      .from("ai_lab_conversations")
      .select("id, title, user_id, is_archived, updated_at, last_model_key")
      .eq("company_id", params.companyId)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  if (!company) notFound();

  const usage = (usageR.data ?? []) as UsageRow[];
  const trend = byMonth((trendR.data ?? []) as UsageDailyRow[], months);
  const users = (usersR.data ?? []) as { id: string; display_name: string; login_id: string }[];
  const userName = new Map(users.map((u) => [u.id, u.display_name]));
  const conversations = (convR.data ?? []) as {
    id: string;
    title: string;
    user_id: string;
    is_archived: boolean;
    updated_at: string;
    last_model_key: string | null;
  }[];

  const total = totalsFor(usage);
  const budget = company.monthly_token_budget as number | null;
  const ratio = budgetRatio(total.totalTokens, budget);

  const thisMonth = trend[trend.length - 1];
  const lastMonth = trend[trend.length - 2];
  const tokenMom = lastMonth ? momChange(thisMonth.totalTokens, lastMonth.totalTokens) : null;
  const costMom = lastMonth ? momChange(thisMonth.usd, lastMonth.usd) : null;

  // 利用者 × モデルの明細に畳む。
  const byKey = new Map<string, UsageRow>();
  for (const r of usage) {
    const key = `${r.user_id}::${r.model_key}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.requests += Number(r.requests);
      cur.input_tokens += Number(r.input_tokens);
      cur.output_tokens += Number(r.output_tokens);
      cur.images += Number(r.images);
    } else {
      byKey.set(key, {
        ...r,
        requests: Number(r.requests),
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
        images: Number(r.images),
      });
    }
  }
  const rows = Array.from(byKey.values()).sort(
    (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
  );

  return (
    <div>
      <PageHeader
        title={company.name as string}
        subtitle="利用状況と会話ログ（研修の振り返り用）"
        action={
          <Link href="/app/ai-lab/reports" className="btn-ghost text-sm">
            全社の月別推移
          </Link>
        }
      />
      <CompanyTabs companyId={params.companyId} active="usage" />

      {/* ── 月別推移（直近12か月固定） ── */}
      <Section
        title={`月別推移（直近${TREND_MONTHS}か月）`}
        icon={<TrendingUp size={14} />}
        className="mb-6"
        action={
          <span className="text-[11px] text-ink/40 text-legible">
            棒＝トークン（左軸） / 線＝概算コスト（右軸）
          </span>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="今月のトークン" raw={thisMonth.totalTokens.toLocaleString()} sub={<MomBadge value={tokenMom} />} />
          <StatCard
            label="今月の概算コスト"
            raw={formatUsd(thisMonth.usd)}
            accent
            sub={<MomBadge value={costMom} />}
          />
          <StatCard label="今月のリクエスト" raw={thisMonth.requests.toLocaleString()} />
          <StatCard label="今月の生成画像" raw={`${thisMonth.images.toLocaleString()}枚`} />
        </div>

        <AiLabUsageTrendChart
          data={trend.map((p) => ({
            month: p.month,
            label: p.label.replace(/^\d{4}年/, ""), // 軸は「8月」まで。年はテーブル側で見せる
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
            totalTokens: p.totalTokens,
            requests: p.requests,
            usd: Number(p.usd.toFixed(2)),
          }))}
        />

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="th">月</th>
                <th className="th text-right">リクエスト</th>
                <th className="th text-right">入力トークン</th>
                <th className="th text-right">出力トークン</th>
                <th className="th text-right">合計トークン</th>
                <th className="th text-right">画像</th>
                <th className="th text-right">概算コスト</th>
                <th className="th text-right">予算消化</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((p) => {
                const r = budgetRatio(p.totalTokens, budget);
                return (
                  <tr key={p.month} className="row-hover border-t border-black/[0.04]">
                    <td className="td font-medium">{p.label}</td>
                    <td className="td text-right tabular-nums">{p.requests.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{p.inputTokens.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{p.outputTokens.toLocaleString()}</td>
                    <td className="td text-right tabular-nums font-semibold">{p.totalTokens.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{p.images.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{p.usd > 0 ? formatUsd(p.usd) : "—"}</td>
                    <td className="td text-right tabular-nums">
                      {r == null ? (
                        <span className="text-xs text-ink/40">無制限</span>
                      ) : (
                        <span className={r >= 1 ? "text-rose-600" : r >= 0.8 ? "text-accent-orange" : ""}>
                          {Math.round(r * 100)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!trend.every((p) => p.costComplete) && (
          <p className="mt-2 text-[11px] text-ink/45 text-legible">
            画像生成など単価を持たない利用は概算コストに含まれていません。実額はこれより大きくなります。
          </p>
        )}
      </Section>

      {/* ── 指定期間の明細 ── */}
      <form className="card card-pad mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">開始日</label>
          <input name="from" type="date" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="label">終了日</label>
          <input name="to" type="date" defaultValue={to} className="input" />
        </div>
        <button type="submit" className="btn-ghost">
          この期間の明細を見る
        </button>
      </form>

      {ratio != null && (
        <p
          className={`mb-6 rounded-lg px-4 py-2.5 text-sm ${
            ratio >= 0.8 ? "bg-amber-50 text-amber-800" : "bg-mist-soft text-ink/70"
          }`}
        >
          指定期間の消費は {total.totalTokens.toLocaleString()} トークン。月間予算 {budget!.toLocaleString()} に対して{" "}
          {Math.round(ratio * 100)}% です。
          {ratio >= 1 && "上限に達しているため、受講者は送信できません。"}
        </p>
      )}

      <Section title="利用者別・モデル別" icon={<BarChart3 size={14} />} className="mb-6">
        {rows.length === 0 ? (
          <EmptyState message="この期間の利用はありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">受講者</th>
                  <th className="th">モデル</th>
                  <th className="th text-right">リクエスト</th>
                  <th className="th text-right">入力トークン</th>
                  <th className="th text-right">出力トークン</th>
                  <th className="th text-right">画像</th>
                  <th className="th text-right">概算コスト</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cost = totalsFor([r]);
                  return (
                    <tr key={`${r.user_id}-${r.model_key}`} className="row-hover border-t border-black/[0.04]">
                      <td className="td">{userName.get(r.user_id) ?? "（削除済み）"}</td>
                      <td className="td">{modelLabel(r.model_key)}</td>
                      <td className="td text-right tabular-nums">{r.requests.toLocaleString()}</td>
                      <td className="td text-right tabular-nums">{r.input_tokens.toLocaleString()}</td>
                      <td className="td text-right tabular-nums">{r.output_tokens.toLocaleString()}</td>
                      <td className="td text-right tabular-nums">{r.images.toLocaleString()}</td>
                      <td className="td text-right tabular-nums">{cost.usd > 0 ? formatUsd(cost.usd) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="会話ログ" icon={<MessagesSquare size={14} />}>
        {conversations.length === 0 ? (
          <EmptyState message="まだ会話がありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">タイトル</th>
                  <th className="th">受講者</th>
                  <th className="th">モデル</th>
                  <th className="th">最終更新</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id} className="row-hover border-t border-black/[0.04]">
                    <td className="td">
                      <Link
                        href={`/app/ai-lab/${params.companyId}/usage/${c.id}`}
                        className="font-medium text-teal-deep hover:underline"
                      >
                        {c.title}
                      </Link>
                      {c.is_archived && <span className="pill ml-2 bg-ink/10 text-ink/55">受講者側で削除済み</span>}
                    </td>
                    <td className="td">{userName.get(c.user_id) ?? "（削除済み）"}</td>
                    <td className="td">{modelLabel(c.last_model_key)}</td>
                    <td className="td text-xs text-ink/60">{formatDateTimeJst(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/** 前月比。比較できない(前月が0)ときは何も出さない。 */
function MomBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink/40">前月比 —</span>;
  const pct = Math.round(value * 100);
  const up = pct > 0;
  return (
    <span className={up ? "text-accent-orange" : pct < 0 ? "text-emerald-600" : "text-ink/40"}>
      前月比 {up ? "+" : ""}
      {pct}%
    </span>
  );
}
