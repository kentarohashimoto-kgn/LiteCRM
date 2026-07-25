import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShieldAlert, ShieldCheck, UserMinus, FileSignature } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCtxOrNull } from "@/lib/session";
import {
  fetchDriveAudit,
  resolveFindingAction,
  saveAgreementAction,
  terminateAgreementAction,
  toggleOffboardingItemAction,
} from "@/server/actions/drive-audit";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  deleted_account: "削除済みアカウントの残存権限",
  unknown_member: "在籍記録のないメンバー",
  no_nda: "NDA未締結・期限切れ",
  bo_intrusion: "機微ドライブへの権限侵入",
  direct_grant: "個人への直接付与",
  new_external: "新規の外部付与",
  offboarding: "退任処理の未完了",
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-rose-50 text-rose-600",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-black/[0.05] text-ink/55",
};

function fmt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * P2 ドライブ権限監査ダッシュボード(管理者)。
 * 夜間バッチ(/api/cron/drive-audit)の検出結果・NDA台帳・退任チェックリストを1画面に集約し、
 * 四半期棚卸しを「ゼロから調べる作業」から「レポートを承認する作業」に変える。
 */
export default async function DriveAuditPage() {
  const ctx = await getCtxOrNull();
  if (!ctx || !["owner", "admin"].includes(ctx.role)) notFound();
  const { findings, agreements, checklists, lastScan } = await fetchDriveAudit();
  const high = findings.filter((f) => f.severity === "high");

  return (
    <div>
      <Link href="/app/settings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 設定
      </Link>
      <PageHeader
        title="ドライブ権限監査"
        subtitle={`共有ドライブと案件フォルダの権限を毎晩点検し、在籍情報・NDA台帳と突合した結果です。最終スキャン: ${lastScan ?? "未実行"}`}
      />

      <Section
        title={`要対応（${findings.length}）`}
        className="mb-5"
        action={
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${high.length > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>
            {high.length > 0 ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
            重大 {high.length} 件
          </span>
        }
      >
        {findings.length === 0 ? (
          <p className="text-sm text-ink/45 py-2">
            {lastScan ? "検出事項はありません。権限は設計通りの状態です。" : "まだスキャンが実行されていません（夜間バッチで自動実行されます）。"}
          </p>
        ) : (
          <ul className="divide-y divide-black/[0.05]">
            {findings.map((f) => (
              <li key={f.id} className="flex items-start gap-3 py-2.5">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info}`}>
                  {KIND_LABEL[f.kind] ?? f.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{f.detail}</div>
                  <div className="text-xs text-ink/45 mt-0.5">
                    {f.email || "—"} ・ {f.scope_name ?? "—"} ・ 初検出 {fmt(f.first_seen_at)}
                  </div>
                </div>
                <form action={resolveFindingAction} className="shrink-0">
                  <input type="hidden" name="id" value={f.id} />
                  <SubmitButton className="btn-ghost text-xs" pendingLabel="処理中…">対応済みにする</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {checklists.length > 0 && (
        <Section title={`退任処理チェックリスト（${checklists.length}）`} className="mb-5" action={<UserMinus size={15} className="text-ink/35" />}>
          <div className="space-y-4">
            {checklists.map((c) => (
              <div key={c.id} className="rounded-xl border border-black/[0.06] p-3">
                <div className="text-sm font-medium mb-2">
                  {c.target_name ?? c.target_email ?? "メンバー"}
                  <span className="text-xs text-ink/40 ml-2">{c.target_email} ・ 退任 {fmt(c.created_at)}</span>
                </div>
                <ul className="space-y-1.5">
                  {c.items.map((i) => (
                    <li key={i.key}>
                      <form action={toggleOffboardingItemAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="key" value={i.key} />
                        <button type="submit" className="flex items-center gap-2 text-sm text-left hover:text-teal-deep">
                          <span className={`inline-block w-4 h-4 rounded border ${i.done ? "bg-teal-deep border-teal-deep" : "border-black/20"}`} />
                          <span className={i.done ? "line-through text-ink/40" : ""}>{i.label}</span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="NDA台帳（外部委託・パートナー）" action={<FileSignature size={15} className="text-ink/35" />}>
        <p className="text-xs text-ink/50 mb-3">
          外部アドレスにドライブ権限がある場合、この台帳に有効な記録がないと「NDA未締結」として毎晩検出されます。
        </p>
        <form action={saveAgreementAction} className="grid grid-cols-1 md:grid-cols-5 gap-2.5 mb-4 items-end">
          <div className="md:col-span-2"><label className="label">メールアドレス *</label><input name="email" type="email" required className="input" placeholder="user@example.co.jp" /></div>
          <div><label className="label">氏名</label><input name="display_name" className="input" /></div>
          <div><label className="label">締結日</label><input name="signed_on" type="date" className="input" /></div>
          <div><label className="label">有効期限</label><input name="expires_on" type="date" className="input" /></div>
          <div className="md:col-span-5"><SubmitButton className="btn-primary" pendingLabel="保存中…">台帳に登録する</SubmitButton></div>
        </form>
        {agreements.length === 0 ? (
          <p className="text-sm text-ink/40">登録はまだありません</p>
        ) : (
          <ul className="divide-y divide-black/[0.05]">
            {agreements.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {a.display_name ? `${a.display_name} ` : ""}
                  <span className="text-ink/55">{a.email}</span>
                </span>
                <span className="text-xs text-ink/45 shrink-0">
                  {a.kind} ・ {fmt(a.signed_on)} 〜 {a.expires_on ? fmt(a.expires_on) : "無期限"}
                </span>
                {a.status === "active" ? (
                  <form action={terminateAgreementAction} className="shrink-0">
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="text-xs text-ink/40 hover:text-rose-500">終了</button>
                  </form>
                ) : (
                  <span className="text-xs text-ink/35 shrink-0">終了済み</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
