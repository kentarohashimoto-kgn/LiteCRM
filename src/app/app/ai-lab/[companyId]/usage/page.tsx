import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, MessagesSquare } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { CompanyTabs } from "@/components/ai-lab/admin/company-tabs";
import { budgetRatio, monthRange, sumUsage } from "@/lib/ai-lab/limits";
import { estimateCostUsd, modelLabel } from "@/lib/ai-lab/models";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface UsageRow {
  user_id: string;
  model_key: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
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

  const [{ data: company }, usageR, usersR, convR] = await Promise.all([
    sb.from("ai_lab_companies").select("id, name, monthly_token_budget").eq("id", params.companyId).maybeSingle(),
    sb
      .from("ai_lab_usage_daily")
      .select("user_id, model_key, requests, input_tokens, output_tokens, images")
      .eq("company_id", params.companyId)
      .gte("date", from)
      .lte("date", to),
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

  const total = sumUsage(usage);
  const totalTokens = total.inputTokens + total.outputTokens;
  const ratio = budgetRatio(totalTokens, company.monthly_token_budget as number | null);
  const cost = estimateCostUsd(usage);

  // 利用者 × モデルの明細に畳む。
  const byKey = new Map<string, UsageRow>();
  for (const r of usage) {
    const key = `${r.user_id}::${r.model_key}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.requests += r.requests;
      cur.input_tokens += Number(r.input_tokens);
      cur.output_tokens += Number(r.output_tokens);
      cur.images += r.images;
    } else {
      byKey.set(key, { ...r, input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens) });
    }
  }
  const rows = Array.from(byKey.values()).sort(
    (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
  );

  return (
    <div>
      <PageHeader title={company.name as string} subtitle="利用状況と会話ログ（研修の振り返り用）" />
      <CompanyTabs companyId={params.companyId} active="usage" />

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
          表示
        </button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="リクエスト" raw={total.requests.toLocaleString()} />
        <StatCard label="トークン（入出力計）" raw={totalTokens.toLocaleString()} accent={Boolean(ratio && ratio >= 0.8)} />
        <StatCard label="生成画像" raw={`${total.images.toLocaleString()}枚`} />
        <StatCard
          label="概算コスト"
          raw={cost.priced ? `$${cost.usd.toFixed(2)}` : "—"}
          sub={cost.priced ? "参考値（請求根拠ではありません）" : "単価未設定（AILAB_PRICES）"}
        />
      </div>

      {ratio != null && (
        <p className={`mb-6 rounded-lg px-4 py-2.5 text-sm ${ratio >= 0.8 ? "bg-amber-50 text-amber-800" : "bg-mist-soft text-ink/70"}`}>
          月間予算 {(company.monthly_token_budget as number).toLocaleString()} トークンのうち {Math.round(ratio * 100)}% を消化しています。
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.user_id}-${r.model_key}`} className="row-hover border-t border-black/[0.04]">
                    <td className="td">{userName.get(r.user_id) ?? "（削除済み）"}</td>
                    <td className="td">{modelLabel(r.model_key)}</td>
                    <td className="td text-right tabular-nums">{r.requests.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{r.input_tokens.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{r.output_tokens.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{r.images.toLocaleString()}</td>
                  </tr>
                ))}
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
