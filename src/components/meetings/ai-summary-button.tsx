"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { generateMeetingSummaryAction } from "@/server/actions/ai";

/** D-4: 議事録詳細からAI要約を生成するボタン。 */
export function AiSummaryButton({ meetingId, opportunityId, hasMinutes }: { meetingId: string; opportunityId: string; hasMinutes: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError("");
    startTransition(async () => {
      const res = await generateMeetingSummaryAction({ meetingId, opportunityId });
      if (!res.ok) {
        setError(res.error ?? "失敗しました");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={run}
        disabled={pending || !hasMinutes}
        title={hasMinutes ? "議事録詳細からAIが要約を生成します" : "先に議事録詳細を保存してください"}
        className="inline-flex items-center gap-1.5 rounded-xl border border-teal-primary/40 bg-teal-light text-teal-deep px-3 py-1.5 text-sm hover:bg-teal-light/70 disabled:opacity-50"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {pending ? "AIが要約中…(最大1分)" : "AIで要約"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
