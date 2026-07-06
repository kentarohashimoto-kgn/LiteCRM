"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * フォーム送信ボタン。送信中は「保存中…」に変わり二重送信を防ぐ。
 * サーバアクションのform配下で使うと、押下時に即座に反応が返るので
 * 「保存されたか分からない」問題を解消する。
 */
export function SubmitButton({
  children = "保存する",
  pendingLabel = "保存中…",
  className = "btn-primary",
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(className, pending && "opacity-70 cursor-wait")} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
