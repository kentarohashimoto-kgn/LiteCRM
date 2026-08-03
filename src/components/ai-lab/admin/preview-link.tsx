"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { createPreviewLinkAction } from "@/server/actions/ai-lab-admin";

/**
 * 受講者と同じ画面を管理者が確認するためのワンタイムリンク(60秒・1回限り)。
 * Basic認証は通常どおり要求されるので、会社のBasic ID/パスワードも手元に必要。
 */
export function PreviewLinkButton({ companyId }: { companyId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function issue() {
    setError(null);
    startTransition(async () => {
      const res = await createPreviewLinkAction({ companyId });
      if (!res.ok || !res.path) {
        setError(res.error ?? "発行に失敗しました");
        return;
      }
      window.open(res.path, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div>
      <button type="button" onClick={issue} disabled={pending} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
        <ExternalLink size={14} />
        {pending ? "発行中…" : "プレビューを開く"}
      </button>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <p className="mt-1 text-[11px] text-ink/45">
        60秒間・1回だけ有効なリンクを新しいタブで開きます。Basic認証の入力は必要です。
      </p>
    </div>
  );
}
