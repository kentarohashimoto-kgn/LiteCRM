import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { cn, toJstDate } from "@/lib/utils";

export type NextActionStatusValue = "open" | "done" | null | undefined;

/**
 * 案件に紐づく次回アクション（case-tasks）の消化状況バッジ。
 *  - done: 完了（緑チェック）
 *  - open: 未完了。期日超過なら赤、それ以外はオレンジ
 *  - null/未設定: 何も表示しない（呼び出し側で「未設定」表現を担う場合がある）
 * 案件一覧・営業マン別週報で共通利用する。
 */
export function NextActionStatus({
  status,
  date,
  className,
}: {
  status: NextActionStatusValue;
  date?: string | null;
  className?: string;
}) {
  if (!status) return null;

  if (status === "done") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600", className)}>
        <CheckCircle2 size={11} /> 完了
      </span>
    );
  }

  const today = toJstDate(new Date().toISOString());
  const overdue = !!date && !!today && date < today;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        overdue ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-accent-orange",
        className,
      )}
    >
      {overdue ? <AlertCircle size={11} /> : <Circle size={11} />}
      {overdue ? "未完了・超過" : "未完了"}
    </span>
  );
}
