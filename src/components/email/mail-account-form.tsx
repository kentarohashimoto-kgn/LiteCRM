"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, Plug } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { MAIL_PROVIDERS, MAIL_PROVIDER_MAP } from "@/lib/email";
import { saveMailAccountAction, testMailAccountAction, disconnectMailAccountAction } from "@/server/actions/mail-account";
import type { MailAccountView } from "@/app/app/email/account/page";
import { formatDateTimeJst } from "@/lib/utils";

export function MailAccountForm({ account, disabled }: { account: MailAccountView | null; disabled?: boolean }) {
  const [provider, setProvider] = useState(account?.provider ?? "gws");
  const preset = MAIL_PROVIDER_MAP[provider];
  const isConnected = !!account;

  return (
    <div className="max-w-xl space-y-4">
      {isConnected && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${account!.verified_at ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {account!.verified_at ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>
            接続中: <b>{account!.from_email}</b>
            {account!.verified_at ? "（接続テスト済み）" : "（未検証：接続テストを実行してください）"}
          </span>
        </div>
      )}

      <form action={saveMailAccountAction} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">プロバイダ</label>
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={disabled} className="input">
            {MAIL_PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          {preset?.help && <p className="text-[11px] text-ink/50 mt-1">{preset.help}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">送信元メール<span className="text-rose-500">*</span></label>
            <input name="from_email" type="email" defaultValue={account?.from_email ?? ""} placeholder="you@company.co.jp" className="input" required disabled={disabled} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">差出人名</label>
            <input name="from_name" defaultValue={account?.from_name ?? ""} placeholder="橋本 健太郎" className="input" disabled={disabled} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-ink/60 mb-1">SMTPホスト</label>
            <input name="smtp_host" defaultValue={account?.smtp_host ?? preset?.host ?? ""} placeholder={preset?.host || "smtp.example.com"} className="input" disabled={disabled} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">ポート</label>
            <input name="smtp_port" type="number" defaultValue={account?.smtp_port ?? preset?.port ?? 465} className="input" disabled={disabled} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-1.5 text-xs text-ink/70">
              <input type="checkbox" name="smtp_secure" defaultChecked={account?.smtp_secure ?? preset?.secure ?? true} disabled={disabled} /> SSL(465)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">SMTPユーザー名（通常はメールアドレス）</label>
          <input name="smtp_username" defaultValue={account?.smtp_username ?? ""} placeholder="you@company.co.jp" className="input" disabled={disabled} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">
            アプリパスワード{!isConnected && <span className="text-rose-500">*</span>}
          </label>
          <input name="smtp_password" type="password" placeholder={isConnected ? "変更する場合のみ入力" : "アプリ固有パスワード"} className="input" disabled={disabled} autoComplete="off" />
          <p className="text-[11px] text-ink/45 mt-1">通常のログインパスワードではなく「アプリパスワード」を発行して入力してください。暗号化して保存されます。</p>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-ink/70">
          <input type="checkbox" name="bcc_self" defaultChecked={account?.bcc_self ?? false} disabled={disabled} />
          自分にBCC（送信控えを確実に自分のメールに残す）
        </label>

        {/* 受信取込(IMAP) */}
        <div className="rounded-lg border border-black/[0.06] bg-mist-soft/20 p-3 space-y-2 mt-1">
          <label className="flex items-center gap-1.5 text-sm font-medium text-ink/80">
            <input type="checkbox" name="inbound_enabled" defaultChecked={account?.inbound_enabled ?? false} disabled={disabled} />
            受信も取り込む（返信でシーケンス自動停止・返信をタイムラインに記録）
          </label>
          <p className="text-[11px] text-ink/50">
            送信と同じアプリパスワードで受信（IMAP）も動きます。取り込むのは「自分の送信への返信」と「登録済み取引先からのメール」のみ。無関係なメールは保存しません（抜粋＋リンクのみ保持）。
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-ink/60 mb-1">IMAPホスト</label>
              <input name="imap_host" defaultValue={account?.imap_host ?? preset?.imapHost ?? ""} placeholder={preset?.imapHost || "imap.example.com"} className="input text-sm" disabled={disabled} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">ポート</label>
              <input name="imap_port" type="number" defaultValue={account?.imap_port ?? preset?.imapPort ?? 993} className="input text-sm" disabled={disabled} />
            </div>
          </div>
          {account?.inbound_enabled && (
            <p className="text-[11px] text-ink/50">
              最終取得: {account.inbound_last_run_at ? formatDateTimeJst(account.inbound_last_run_at) : "未実行"}
              {account.inbound_last_error && <span className="text-rose-600"> ／ エラー: {account.inbound_last_error}</span>}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <SubmitButton className="btn-accent inline-flex items-center gap-1 text-sm" pendingLabel="接続テスト中…">
            <Plug size={14} /> 保存して接続テスト
          </SubmitButton>
        </div>
      </form>

      {isConnected && (
        <div className="flex items-center gap-2 pt-1 border-t border-black/[0.06] mt-2">
          <form action={testMailAccountAction}>
            <SubmitButton className="btn-ghost text-sm text-teal-700" pendingLabel="テスト中…">接続テストのみ実行</SubmitButton>
          </form>
          <form action={disconnectMailAccountAction}>
            <SubmitButton className="btn-ghost text-sm text-rose-600" pendingLabel="解除中…">接続を解除</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
