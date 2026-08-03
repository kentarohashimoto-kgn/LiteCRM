import Link from "next/link";
import { Building2, Plus, Sparkles } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ActionNotice } from "@/components/ui/action-notice";
import { EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { LAB_MODELS, isModelAvailable } from "@/lib/ai-lab/models";
import { budgetRatio, monthRange } from "@/lib/ai-lab/limits";
import { createLabCompanyAction } from "@/server/actions/ai-lab-admin";

export const dynamic = "force-dynamic";

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  monthly_token_budget: number | null;
  allowed_models: string[];
}

/**
 * AI Lab（生成AI体験環境）の管理トップ。
 * 契約済み顧客ごとに「会社別URL + Basic認証 + 個別ログイン」の環境を作る。
 */
export default async function AiLabPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  await requireAdminCtx();
  const sb = getSupabaseServer();
  const { from, to } = monthRange();

  const [companiesR, usersR, usageR, accountsR] = await Promise.all([
    sb.from("ai_lab_companies").select("id, name, slug, is_active, monthly_token_budget, allowed_models").order("created_at", { ascending: false }),
    sb.from("ai_lab_users").select("company_id, is_preview"),
    sb.from("ai_lab_usage_daily").select("company_id, input_tokens, output_tokens").gte("date", from).lte("date", to),
    sb.from("accounts").select("id, name").order("name").limit(500),
  ]);

  const companies = (companiesR.data ?? []) as CompanyRow[];
  const userCount = new Map<string, number>();
  for (const u of (usersR.data ?? []) as { company_id: string; is_preview: boolean }[]) {
    if (u.is_preview) continue; // プレビュー用の仮想ユーザーは人数に数えない
    userCount.set(u.company_id, (userCount.get(u.company_id) ?? 0) + 1);
  }
  const tokenCount = new Map<string, number>();
  for (const u of (usageR.data ?? []) as { company_id: string; input_tokens: number; output_tokens: number }[]) {
    tokenCount.set(u.company_id, (tokenCount.get(u.company_id) ?? 0) + Number(u.input_tokens) + Number(u.output_tokens));
  }
  const accounts = (accountsR.data ?? []) as { id: string; name: string }[];
  const usableModels = LAB_MODELS.filter((m) => isModelAvailable(m.key));

  return (
    <div>
      <PageHeader
        title="AI体験環境"
        subtitle="契約済み顧客のAI研修で使う生成AI体験環境です。会社ごとに個別URL・Basic認証・受講者アカウントを発行します。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ created: "会社を作成しました。受講者アカウントを発行してください。" }}
      />

      <Section title="会社一覧" icon={<Building2 size={14} />} className="mb-6">
        {companies.length === 0 ? (
          <EmptyState message="まだ会社がありません。下のフォームから作成してください。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">会社名</th>
                  <th className="th">URL識別子</th>
                  <th className="th">状態</th>
                  <th className="th">受講者</th>
                  <th className="th">当月トークン</th>
                  <th className="th">予算消化</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const used = tokenCount.get(c.id) ?? 0;
                  const ratio = budgetRatio(used, c.monthly_token_budget);
                  return (
                    <tr key={c.id} className="row-hover border-t border-black/[0.04]">
                      <td className="td">
                        <Link href={`/app/ai-lab/${c.id}`} className="font-semibold text-teal-deep hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="td font-mono text-xs text-ink/60">/lab/{c.slug}</td>
                      <td className="td">
                        <span className={`pill ${c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-ink/10 text-ink/55"}`}>
                          {c.is_active ? "有効" : "停止中"}
                        </span>
                      </td>
                      <td className="td tabular-nums">{userCount.get(c.id) ?? 0}名</td>
                      <td className="td tabular-nums">{used.toLocaleString()}</td>
                      <td className="td">
                        {ratio == null ? (
                          <span className="text-xs text-ink/40">無制限</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[0.06]">
                              <div
                                className={`h-full ${ratio >= 0.8 ? "bg-accent-orange" : "bg-teal-primary"}`}
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
      </Section>

      <Section title="会社を追加" icon={<Plus size={14} />}>
        {usableModels.length === 0 && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            利用できるモデルがありません。ANTHROPIC_API_KEY / OPENAI_API_KEY を設定してください。
          </p>
        )}
        <form action={createLabCompanyAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">会社名</label>
            <input name="name" required className="input" placeholder="株式会社サンプル" />
          </div>
          <div>
            <label className="label">URL識別子（/lab/◯◯）</label>
            <input name="slug" required className="input font-mono" placeholder="sample-corp" />
            <p className="mt-1 text-[11px] text-ink/45">英小文字・数字・ハイフン。あとから変更できません。</p>
          </div>
          <div>
            <label className="label">Basic認証 ID</label>
            <input name="basicUser" required className="input" placeholder="sample" autoComplete="off" />
          </div>
          <div>
            <label className="label">Basic認証 パスワード</label>
            <input name="basicPassword" required className="input" autoComplete="new-password" />
            <p className="mt-1 text-[11px] text-ink/45">受講者全員に共有する一次ゲートです。本人確認は個別ログインで行います。</p>
          </div>

          <div className="md:col-span-2">
            <label className="label">利用可能なモデル</label>
            <div className="flex flex-wrap gap-3">
              {LAB_MODELS.map((m) => {
                const available = isModelAvailable(m.key);
                return (
                  <label
                    key={m.key}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                      available ? "border-black/10" : "border-black/5 text-ink/35"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="models"
                      value={m.key}
                      disabled={!available}
                      defaultChecked={m.key === "claude-sonnet" && available}
                    />
                    {m.label}
                    {!available && <span className="text-[10px]">（キー未設定）</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label">既定モデル</label>
            <select name="defaultModel" className="input" defaultValue="claude-sonnet">
              {usableModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">月間トークン予算（空欄で無制限）</label>
            <input name="budget" className="input" inputMode="numeric" placeholder="1000000" />
          </div>
          <div>
            <label className="label">利用開始日（任意）</label>
            <input name="startsOn" type="date" className="input" />
          </div>
          <div>
            <label className="label">利用終了日（任意）</label>
            <input name="endsOn" type="date" className="input" />
          </div>
          <div className="md:col-span-2">
            <label className="label">CRMの顧客に紐付ける（任意）</label>
            <select name="accountId" className="input" defaultValue="">
              <option value="">紐付けない</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink/45">紐付けると、顧客詳細画面から体験環境へ移動できます。</p>
          </div>

          <div className="md:col-span-2">
            <SubmitButton className="btn-primary inline-flex items-center gap-1.5" pendingLabel="作成中…">
              <Sparkles size={14} />
              作成する
            </SubmitButton>
          </div>
        </form>
      </Section>
    </div>
  );
}
