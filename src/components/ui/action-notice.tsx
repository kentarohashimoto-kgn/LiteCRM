import { CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Server Action の結果通知バナー。アクションは成功/失敗を ?saved= / ?error= で
 * リダイレクトし、ページがこのバナーで明示する(「保存されたか分からない」問題の解消)。
 */
export function ActionNotice({
  saved,
  error,
  savedMessages,
  errorMessages,
}: {
  saved?: string;
  error?: string;
  savedMessages: Record<string, string>;
  errorMessages?: Record<string, string>;
}) {
  if (saved && savedMessages[saved]) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
        <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
        {savedMessages[saved]}
      </div>
    );
  }
  if (error) {
    const msg = errorMessages?.[error] ?? "処理に失敗しました。入力内容を確認してください。";
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm text-rose-800">
        <AlertTriangle size={16} className="shrink-0 text-rose-600" />
        {msg}
      </div>
    );
  }
  return null;
}
