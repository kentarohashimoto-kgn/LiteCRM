import { notFound, redirect } from "next/navigation";
import { getCompanyBySlug, isCompanyOpen } from "@/lib/ai-lab/db";
import { getLabCtx } from "@/lib/ai-lab/session";
import { labSignIn } from "@/server/actions/ai-lab-auth";

export const dynamic = "force-dynamic";

/**
 * 受講者の個別ログイン。
 * ここに到達している時点で、middleware の Basic 認証(会社ゲート)は通過している。
 */
export default async function LabLoginPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const company = await getCompanyBySlug(params.slug);
  if (!company || !isCompanyOpen(company)) notFound();

  // ログイン済みならフォームを見せずにチャットへ。
  const ctx = await getLabCtx(params.slug);
  if (ctx) redirect(`/lab/${params.slug}/chat`);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-mist-soft p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold tracking-tight text-teal-deep">{company.name}</div>
          <div className="mt-1 text-sm font-semibold text-ink">生成AI体験環境</div>
          <div className="mt-1 text-xs text-ink/50">AI研修用のログイン</div>
        </div>

        <form action={labSignIn} className="card card-pad space-y-4">
          <input type="hidden" name="slug" value={params.slug} />
          <p className="text-sm font-semibold text-ink">ログイン</p>
          {searchParams.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{searchParams.error}</p>
          )}
          <div>
            <label className="label">ログインID</label>
            <input
              name="loginId"
              required
              autoComplete="username"
              autoCapitalize="none"
              className="input"
              placeholder="配布されたID"
            />
          </div>
          <div>
            <label className="label">パスワード</label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn-primary w-full">
            ログイン
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink/35 text-legible">
          IDとパスワードは研修事務局から配布されます。
          <br />
          入力内容は研修の運営者が確認できる場合があります。機密情報は入力しないでください。
        </p>
      </div>
    </div>
  );
}
