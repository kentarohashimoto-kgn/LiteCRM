import { signIn } from "@/server/actions";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return (
    <div className="min-h-screen flex items-center justify-center bg-mist-soft p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-teal-deep font-bold text-2xl tracking-tight">CATORCE</div>
          <div className="text-sm font-semibold text-ink mt-1">{APP_NAME}</div>
          <div className="text-xs text-ink/50 mt-1">{APP_TAGLINE}</div>
        </div>

        <form action={signIn} className="card card-pad space-y-4">
          <p className="text-sm font-semibold text-ink">ログイン</p>
          {searchParams.error && (
            <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{searchParams.error}</p>
          )}
          <div>
            <label className="label">メールアドレス</label>
            <input name="email" type="email" required autoComplete="email" className="input" placeholder="you@catorce.jp" />
          </div>
          <div>
            <label className="label">パスワード</label>
            <input name="password" type="password" required autoComplete="current-password" className="input" placeholder="••••••••" />
          </div>
          {captchaSiteKey && <TurnstileWidget siteKey={captchaSiteKey} />}
          <button type="submit" className="btn-primary w-full">ログイン</button>
        </form>

        <p className="text-center text-[11px] text-ink/35 mt-4">
          アカウントは管理者が発行します。お困りの場合は管理者にお問い合わせください。
        </p>
      </div>
    </div>
  );
}
