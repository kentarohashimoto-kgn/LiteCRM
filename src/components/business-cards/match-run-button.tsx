"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { runCardMatchingAction } from "@/server/actions/business-cards";

/** CRMマッチングを実行して結果件数をその場に表示するボタン。 */
export function MatchRunButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      const r = await runCardMatchingAction();
      if (!r.ok) {
        setMsg(r.error ?? "マッチングに失敗しました");
        return;
      }
      const totalHit = r.email + r.companyContact + r.company;
      setMsg(
        totalHit === 0
          ? "新たにマッチした名刺はありませんでした"
          : `${totalHit}枚を連携（メール${r.email} / 会社+氏名${r.companyContact} / 会社名${r.company}）`,
      );
      router.refresh();
    });

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink/50 max-w-64">{msg}</span>}
      <button type="button" onClick={run} disabled={pending} className="btn-primary disabled:opacity-50">
        <Link2 size={15} className="mr-1 inline" />
        {pending ? "マッチング中…" : "CRMマッチング実行"}
      </button>
    </div>
  );
}
