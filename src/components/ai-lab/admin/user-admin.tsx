"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, KeyRound, UserPlus } from "lucide-react";
import { issueLabUsersAction, resetLabUserPasswordAction } from "@/server/actions/ai-lab-admin";
import type { IssuedLabUser } from "@/lib/ai-lab/ui-types";

/**
 * 受講者の一括発行。
 * 初期パスワードは発行直後のこの画面にしか出ない(DBにはハッシュのみ)。
 * 研修事務局がそのまま配れるよう、コピーしやすい形で表示する。
 */
export function IssueUsersForm({ companyId, slug }: { companyId: string; slug: string }) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [issued, setIssued] = useState<IssuedLabUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await issueLabUsersAction({ companyId, raw });
      if (!res.ok || !res.issued) {
        setError(res.error ?? "発行に失敗しました");
        return;
      }
      setIssued(res.issued);
      setRaw("");
      router.refresh();
    });
  }

  async function copyAll() {
    if (!issued) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const lines = [
      `URL: ${origin}/lab/${slug}`,
      "",
      "表示名\tログインID\t初期パスワード",
      ...issued.map((u) => `${u.displayName}\t${u.loginId}\t${u.password}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("コピーできませんでした。手動で選択してください。");
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">発行する受講者（1行1名 / 「ログインID,表示名」）</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={5}
          className="input font-mono text-sm"
          placeholder={"tanaka,田中太郎\nsuzuki,鈴木花子"}
        />
        <p className="mt-1 text-[11px] text-ink/45">表示名を省略するとログインIDが表示名になります。一度に200名まで。</p>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !raw.trim()}
        className="btn-primary inline-flex items-center gap-1.5"
      >
        <UserPlus size={14} />
        {pending ? "発行中…" : "発行する"}
      </button>

      {issued && issued.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-emerald-900">
              {issued.length}名を発行しました。初期パスワードはこの画面でのみ確認できます。
            </p>
            <button type="button" onClick={copyAll} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
              <ClipboardCopy size={13} />
              {copied ? "コピーしました" : "接続情報をコピー"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="th">表示名</th>
                  <th className="th">ログインID</th>
                  <th className="th">初期パスワード</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((u) => (
                  <tr key={u.loginId} className="border-t border-black/[0.04]">
                    <td className="td">{u.displayName}</td>
                    <td className="td font-mono">{u.loginId}</td>
                    <td className="td font-mono font-semibold">{u.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResetPasswordButton({ userId, companyId }: { userId: string; companyId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    if (!window.confirm("パスワードを再発行します。現在のパスワードは使えなくなります。")) return;
    setError(null);
    startTransition(async () => {
      const res = await resetLabUserPasswordAction({ userId, companyId });
      if (!res.ok || !res.password) setError(res.error ?? "再発行に失敗しました");
      else setPassword(res.password);
    });
  }

  if (password) {
    return <span className="font-mono text-xs font-semibold text-emerald-700">{password}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={reset}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-semibold text-ink/50 hover:text-teal-deep"
      >
        <KeyRound size={12} />
        {pending ? "再発行中…" : "PW再発行"}
      </button>
      {error && <span className="ml-2 text-xs text-rose-600">{error}</span>}
    </>
  );
}
