import { notFound } from "next/navigation";
import { ExternalLink, Link2, Settings2 } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ActionNotice } from "@/components/ui/action-notice";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyTabs } from "@/components/ai-lab/admin/company-tabs";
import { PreviewLinkButton } from "@/components/ai-lab/admin/preview-link";
import { LAB_MODELS, isModelAvailable } from "@/lib/ai-lab/models";
import { setLabCompanyActiveAction, updateLabCompanyAction } from "@/server/actions/ai-lab-admin";

export const dynamic = "force-dynamic";

interface Company {
  id: string;
  name: string;
  slug: string;
  account_id: string | null;
  basic_user: string;
  allowed_models: string[];
  default_model: string;
  monthly_token_budget: number | null;
  is_active: boolean;
  file_tools_enabled: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

export default async function AiLabCompanyPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { saved?: string; error?: string };
}) {
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const [{ data }, accountsR] = await Promise.all([
    sb
      .from("ai_lab_companies")
      .select("id, name, slug, account_id, basic_user, allowed_models, default_model, monthly_token_budget, is_active, file_tools_enabled, starts_on, ends_on")
      .eq("id", params.companyId)
      .maybeSingle(),
    sb.from("accounts").select("id, name").order("name").limit(500),
  ]);
  if (!data) notFound();
  const company = data as Company;
  const accounts = (accountsR.data ?? []) as { id: string; name: string }[];
  const usableModels = LAB_MODELS.filter((m) => isModelAvailable(m.key));

  return (
    <div>
      <PageHeader
        title={company.name}
        subtitle={`生成AI体験環境の設定 / URL識別子: ${company.slug}`}
        action={
          <form action={setLabCompanyActiveAction}>
            <input type="hidden" name="id" value={company.id} />
            <input type="hidden" name="active" value={company.is_active ? "0" : "1"} />
            <SubmitButton
              className={company.is_active ? "btn-ghost text-rose-600" : "btn-accent"}
              pendingLabel="変更中…"
            >
              {company.is_active ? "環境を停止する" : "環境を有効にする"}
            </SubmitButton>
          </form>
        }
      />

      <CompanyTabs companyId={company.id} active="settings" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          created: "会社を作成しました。「受講者」タブでアカウントを発行してください。",
          saved: "設定を保存しました。Basic認証の変更は最大1分ほどで反映されます。",
          activated: "環境を有効にしました。",
          deactivated: "環境を停止しました。受講者はログインできなくなります。",
        }}
      />

      {!company.is_active && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          この環境は停止中です。受講者はURLにアクセスできません（404になります）。
        </p>
      )}

      <Section title="接続情報" icon={<Link2 size={14} />} className="mb-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="label">受講者用URL</dt>
            <dd className="font-mono text-sm break-all text-ink/80">/lab/{company.slug}</dd>
          </div>
          <div>
            <dt className="label">Basic認証 ID</dt>
            <dd className="font-mono text-sm text-ink/80">{company.basic_user}</dd>
          </div>
          <div>
            <dt className="label">Basic認証 パスワード</dt>
            <dd className="text-sm text-ink/50">保存されていません（変更は下の設定から）</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <a
            href={`/lab/${company.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex items-center gap-1.5 text-sm"
          >
            <ExternalLink size={14} />
            体験環境を開く
          </a>
          <PreviewLinkButton companyId={company.id} />
        </div>
      </Section>

      <Section title="設定" icon={<Settings2 size={14} />}>
        <form action={updateLabCompanyAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={company.id} />
          <div>
            <label className="label">会社名</label>
            <input name="name" required defaultValue={company.name} className="input" />
          </div>
          <div>
            <label className="label">URL識別子</label>
            <input value={company.slug} disabled className="input font-mono bg-mist-soft text-ink/50" />
          </div>
          <div>
            <label className="label">Basic認証 ID</label>
            <input name="basicUser" defaultValue={company.basic_user} className="input" autoComplete="off" />
          </div>
          <div>
            <label className="label">Basic認証 パスワード（変更する場合のみ）</label>
            <input name="basicPassword" className="input" autoComplete="new-password" placeholder="変更しない場合は空欄" />
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
                      defaultChecked={company.allowed_models.includes(m.key)}
                    />
                    {m.label}
                    {!available && (
                      <span className="text-[10px]">
                        {company.allowed_models.includes(m.key)
                          ? "（許可済み・キー未設定）"
                          : "（キー未設定）"}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {usableModels.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">利用できるモデルがありません。APIキーの設定を確認してください。</p>
            )}
          </div>

          <div>
            <label className="label">既定モデル</label>
            <select name="defaultModel" className="input" defaultValue={company.default_model}>
              {LAB_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">月間トークン予算（空欄で無制限）</label>
            <input
              name="budget"
              className="input"
              inputMode="numeric"
              defaultValue={company.monthly_token_budget ?? ""}
            />
          </div>
          <div>
            <label className="label">利用開始日</label>
            <input name="startsOn" type="date" className="input" defaultValue={company.starts_on ?? ""} />
          </div>
          <div>
            <label className="label">利用終了日</label>
            <input name="endsOn" type="date" className="input" defaultValue={company.ends_on ?? ""} />
          </div>
          <div className="md:col-span-2">
            <label className="flex items-start gap-2 rounded-xl border border-black/10 px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                name="fileTools"
                value="1"
                defaultChecked={company.file_tools_enabled}
                className="mt-0.5"
              />
              <span>
                ファイル作成を許可する（Excel / Word / PowerPoint / PDF）
                <span className="mt-0.5 block text-[11px] text-ink/45 text-legible">
                  受講者が「表にして」と頼むとファイルを作って返せます。裏側でコード実行を使うため、
                  無効にするとその分の課金が発生しません。
                </span>
              </span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="label">CRMの顧客に紐付ける</label>
            <select name="accountId" className="input" defaultValue={company.account_id ?? ""}>
              <option value="">紐付けない</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="保存中…">保存する</SubmitButton>
          </div>
        </form>
      </Section>
    </div>
  );
}
