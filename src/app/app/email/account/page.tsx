import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { MailAccountForm } from "@/components/email/mail-account-form";

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
    .select("provider, from_email, from_name, smtp_host, smtp_port, smtp_secure, smtp_username, bcc_self, verified_at, imap_host, imap_port, inbound_enabled, inbound_last_run_at, inbound_last_error")
    .maybeSingle();
  const account = (data as MailAccountView | null) ?? null;
  const secretReady = mailCredSecretConfigured();

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
        }}
        errorMessages={{
          forbidden: "メール送信の権限がありません。",
          invalid: "必須項目(送信元メール・SMTPホスト・ポート)を入力してください。",
          need_password: "アプリパスワードを入力してください。",
          no_secret: "サーバーに MAIL_CRED_SECRET が未設定です。管理者に設定を依頼してください。",
          no_account: "接続済みアカウントがありません。",
          save_failed: "保存に失敗しました。",
          unverified: `保存しましたが接続テストに失敗しました${searchParams.detail ? `: ${decodeURIComponent(searchParams.detail)}` : ""}。ホスト/ポート/アプリパスワードをご確認ください。`,
        }}
      />

      {!secretReady && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          サーバーに <code>MAIL_CRED_SECRET</code>（資格情報の暗号鍵）が未設定のため、接続を保存できません。管理者にデプロイ環境変数の設定を依頼してください。
        </div>
      )}

      <Section title="接続設定">
        <MailAccountForm account={account} disabled={!secretReady} />
      </Section>
    </div>
  );
}
