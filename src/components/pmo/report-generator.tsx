"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PMO_MODES, type PmoMode } from "@/lib/pmo";
import { generatePmoReportAction } from "@/server/actions/pmo";

/**
 * AI-PMOレポート生成UI: 4モード(振り返り/段取り/PJ管理/経営俯瞰)から選び、
 * 補足メモを添えてベテランPMアドバイザーのレポートを生成する。
 */
export function PmoReportGenerator({
  hasApiKey,
  onGenerated,
}: {
  hasApiKey: boolean;
  onGenerated?: (reportId: string) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PmoMode>("retrospective");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError("");
    startTransition(async () => {
      const res = await generatePmoReportAction({ mode, memo });
      if (!res.ok) {
        setError(res.error ?? "失敗しました");
        return;
      }
      // サーバーコンポーネントを再取得して新レポートを一覧へ反映。
      router.refresh();
      // 呼び出し側(ワークスペース)があれば選択を委譲(ページ遷移しない)。
      if (res.reportId && onGenerated) onGenerated(res.reportId);
      else if (res.reportId) router.replace(`/app/pmo?report=${res.reportId}`);
    });
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {PMO_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            disabled={pending}
            className={cn(
              "text-left rounded-xl border p-3 transition-colors",
              mode === m.key
                ? "border-teal-primary bg-teal-light/60 ring-1 ring-teal-primary/40"
                : "border-black/[0.08] bg-white hover:border-teal-primary/40",
            )}
          >
            <div className="text-sm font-semibold text-ink">
              {m.emoji} {m.label}
            </div>
            <div className="text-xs text-ink/50 mt-1 leading-relaxed">{m.desc}</div>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={pending}
          rows={2}
          placeholder="補足・関心事(任意)。例: 明日のA社商談を重点的に / 今月の着地が心配 / ○○さんの案件を見てほしい"
          className="w-full rounded-xl border border-black/[0.08] px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
        />
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={run}
          disabled={pending || !hasApiKey}
          title={hasApiKey ? "CRMデータを集めてベテランPMが分析します" : "ANTHROPIC_API_KEY が未設定です"}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-deep text-white px-4 py-2 text-sm font-semibold hover:bg-teal-deep/90 disabled:opacity-50"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {pending ? "ベテランPMが分析中…(最大2分)" : "AI-PMOレポートを生成"}
        </button>
        {!hasApiKey && <span className="text-xs text-ink/40">ANTHROPIC_API_KEY を設定すると生成できます</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
