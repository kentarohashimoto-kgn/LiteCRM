"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2 } from "lucide-react";
import { convertCardsToLeadsAction } from "@/server/actions/business-cards";

/**
 * 名刺→リード化(D1: 展示会MVP)。現在のタグ・交換日(from)絞り込みに一致する
 * 未リード化の名刺をリードへ一括変換する。同一メールの既存リードには紐付けのみ。
 */
export function ConvertToLeadsButton({ tag, from }: { tag?: string; from?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    const scope = tag ? `タグ「${tag}」` : from ? `交換日 ${from} 以降` : "すべて";
    if (!confirm(`未リード化の名刺(対象: ${scope})をリードに変換します。\n変換後は自動でFitスコアが付き、リード一覧から一括お礼メールを送れます。よろしいですか？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await convertCardsToLeadsAction({ tag, from });
      if (!r.ok) setMsg(r.error ?? "変換に失敗しました");
      else {
        setMsg(`リード化 ${r.created}件 / 既存リードへ紐付け ${r.linkedExisting}件`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-teal-deep">{msg}</span>}
      <button onClick={run} disabled={busy} className="btn-ghost inline-flex items-center gap-1.5 text-sm" title="絞り込み中の未リード化名刺をリードへ一括変換">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} リード化
      </button>
    </div>
  );
}
