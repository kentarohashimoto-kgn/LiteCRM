import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { googleOAuthConfigured } from "@/lib/google-oauth";
import { MailAccountForm } from "@/components/email/mail-account-form";
import { SignatureForm } from "@/components/email/signature-form";

export const dynamic = "force-dynamic";

export interface MailAccountView {
  provider: string;
  from_email: string;
  from_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
  bcc_self: boolean;
  verified_at: string | null;
  imap_host: string | null;
  imap_port: number;
  inbound_enabled: boolean;
  inbound_last_run_at: string | null;
  inbound_last_error: string | null;
  auth_method: string;
  oauth_email: string | null;
  signature: string | null;
}

/**
 * WO-22 メール送信アカウント接続(F-101)。本人のSMTP(GWS/Zoho)をアプリパスワードで接続。
 * 接続すると、アプリから本人アカウント経由でメール送信+開封/クリック計測ができる。
 */
export default async function MailAccountPage({ searchParams }: { searchParams: { saved?: string; error?: string; detail?: string } }) {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("user_mail_accounts")
    .select("provider, from_email, from_name, smtp_host, smtp_port, smtp_secure, smtp_username, bcc_self, verified_at, imap_host, imap_port, inbound_enabled, inbound_last_run_at, inbound_last_error, auth_method, oauth_email, signature")
    .maybeSingle();
  const account = (data as MailAccountView | null) ?? null;
  const secretReady = mailCredSecretConfigured();
  const googleReady = googleOAuthConfigured();

  return (
    <div>
      <PageHeader
        title="メール送信アカウント"
        subtitle="ご自身のメール(Google Workspace / Zoho)をSMTPで接続すると、アプリから本人アカウント経由で送信でき、開封・クリックが計測できます。送信控えはご自身の[送信済み]にも残ります。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          connected: "接続テストに成功し、保存しました。メール作成画面から送信できます。",
          verified: "接続テストに成功しました。",
          disconnected: "接続を解除しました。",
          google_connected: "Googleアカウントに接続しました。送受信（開封/クリック計測・返信自動停止）が有効です。",
          signature: "署名を保存しました。テンプレの {signature} に差し込まれます。",
        }}
        errorMessages={{
          forbidden: "メール送信の権限がありません。",
          invalid: "必須項目(送信元メール・SMTPホスト・ポート)を入力してください。",
          need_password: "アプリパスワードを入力してください。",
          no_secret: "サーバーに MAIL_CRED_SECRET が未設定です。管理者に設定を依頼してください。",
          no_google: "サーバーに GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です。管理者に依頼してください。",
          no_account: "接続済みアカウントがありません。",
          save_failed: "保存に失敗しました。",
          google_state: "接続の検証に失敗しました（時間をおいて再度お試しください）。",
          google_denied: "Google側で接続が許可されませんでした。",
          google_exchange: `Google認証に失敗しました${searchParams.detail ? `: ${decodeURIComponent(searchParams.detail)}` : ""}。`,
          google_profile: "Googleアカウントのメールアドレスを取得できなかったため、接続を保存しませんでした。時間をおいて再接続してください。",
          gmail_api_disabled: "接続は保存しましたが、Gmail API が有効でないためこのままでは送信できません。管理者にGoogle CloudプロジェクトでのGmail API（およびCalendar API）の有効化を依頼し、数分後に再接続してください。",
          unverified: `保存しましたが接続テストに失敗しました${searchParams.detail ? `: ${decodeURIComponent(searchParams.detail)}` : ""}。ホスト/ポート/アプリパスワードをご確認ください。`,
        }}
      />

      {!secretReady && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          サーバーに <code>MAIL_CRED_SECRET</code>（資格情報の暗号鍵）が未設定のため、接続を保存できません。管理者にデプロイ環境変数の設定を依頼してください。
        </div>
      )}

      {/* GWS向け: Googleワンクリック接続(OAuth) */}
      {googleReady && account?.auth_method !== "google_oauth" && (
        <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <p className="text-sm font-semibold text-ink/90 mb-1">Google Workspace の方（推奨）</p>
          <p className="text-xs text-ink/55 mb-3">
            Googleでワンクリック接続すると、アプリパスワード不要で送受信・開封/クリック計測・返信自動停止まで有効になります（社内アプリのためGoogleの外部審査は不要）。
          </p>
          <a href="/api/oauth/google/start" className="btn-accent inline-flex items-center gap-1 text-sm">Googleアカウントで接続</a>
        </div>
      )}

      {account?.auth_method === "google_oauth" && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Google接続中: <b>{account.oauth_email}</b>（送受信・計測・返信自動停止が有効）。切り替える場合は下のフォームで別方式を保存するか、
          <a href="/api/oauth/google/start" className="underline ml-1">再接続</a>してください。
        </div>
      )}

      {account && (
        <Section title="署名（メール末尾のブロック）">
          <SignatureForm signature={account.signature} />
        </Section>
      )}

      <Section title={account?.auth_method === "google_oauth" ? "SMTP接続に切り替える場合（任意）" : "SMTP接続（Zoho / その他）"}>
        <MailAccountForm account={account} disabled={!secretReady} />
      </Section>
    </div>
  );
}
