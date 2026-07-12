"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  linkCardToAccountAction,
  searchAccountsForCardAction,
  unlinkCardAction,
} from "@/server/actions/business-cards";

const MATCH_LABEL: Record<string, string> = {
  email: "メール一致",
  company_contact: "会社+氏名",
  company: "会社名一致",
  manual: "手動",
};

/**
 * 一覧行のCRM連携セル。連携済みなら顧客リンク＋解除、未連携なら顧客検索→手動連携。
 */
export function CardLinkCell({
  cardId,
  accountId,
  accountName,
  contactName,
  matchType,
}: {
  cardId: string;
  accountId: string | null;
  accountName: string | null;
  contactName: string | null;
  matchType: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);

  if (accountId) {
    return (
      <div className="text-xs">
        <Link href={`/app/accounts/${accountId}`} className="text-teal-deep hover:underline font-medium">
          {accountName ?? "顧客"}
        </Link>
        {contactName && <div className="text-ink/50">担当者: {contactName}</div>}
        <div className="mt-0.5 flex items-center gap-1.5">
          {matchType && <span className="pill text-[10px]">{MATCH_LABEL[matchType] ?? matchType}</span>}
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await unlinkCardAction({ cardId }); router.refresh(); })}
            className="text-ink/40 hover:text-rose-500"
            title="連携を解除"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-teal-deep hover:underline whitespace-nowrap">
        ＋ 顧客に連携
      </button>
    );
  }

  const search = (kw: string) => {
    setQ(kw);
    if (kw.trim().length < 1) { setHits([]); return; }
    start(async () => setHits(await searchAccountsForCardAction(kw)));
  };

  return (
    <div className="text-xs w-48">
      <div className="flex items-center gap-1">
        <Search size={12} className="text-ink/40 shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="顧客名で検索"
          className="w-full rounded-lg border border-black/10 px-2 py-1"
        />
        <button type="button" onClick={() => { setOpen(false); setQ(""); setHits([]); }} className="text-ink/40 hover:text-ink">
          <X size={12} />
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="mt-1 rounded-lg border border-black/10 bg-white shadow-sm divide-y divide-black/[0.04] max-h-40 overflow-y-auto">
          {hits.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await linkCardToAccountAction({ cardId, accountId: a.id });
                    setOpen(false);
                    router.refresh();
                  })
                }
                className="w-full text-left px-2 py-1.5 hover:bg-mist-soft"
              >
                {a.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
