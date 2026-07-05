"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

/** /app 配下の実行時エラー画面。白画面ではなく再試行の導線を出す。 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card card-pad max-w-md text-center space-y-4">
        <AlertTriangle size={40} className="mx-auto text-accent-orange" />
        <div>
          <div className="text-lg font-bold text-ink">エラーが発生しました</div>
          <p className="text-sm text-ink/60 mt-1.5">
            一時的な問題の可能性があります。再読み込みで解決しない場合は、時間をおいて再度お試しください。
          </p>
          {error.digest && <p className="text-[11px] text-ink/35 mt-2">エラーID: {error.digest}</p>}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={reset} className="btn-accent inline-flex items-center gap-1.5">
            <RotateCcw size={15} /> 再読み込み
          </button>
          <a href="/app/dashboard" className="btn-ghost">ダッシュボードへ</a>
        </div>
      </div>
    </div>
  );
}
