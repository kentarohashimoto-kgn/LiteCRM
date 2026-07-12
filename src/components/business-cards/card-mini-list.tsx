import type { BusinessCard, User } from "@/lib/types";

/** 顧客詳細ページ用: 連携済み名刺のコンパクト表示。 */
export function CardMiniList({ cards, usersById }: { cards: BusinessCard[]; usersById: Map<string, User> }) {
  if (cards.length === 0) return <p className="text-sm text-ink/40 py-2">連携された名刺はありません</p>;
  return (
    <ul className="space-y-3">
      {cards.map((c) => (
        <li key={c.id} className="text-sm">
          <div className="font-medium">
            {c.full_name}
            {c.title && <span className="ml-1.5 text-xs text-ink/50">{c.title}</span>}
            {c.rank && <span className="ml-1.5 pill text-[10px]">{c.rank}</span>}
          </div>
          <div className="text-xs text-ink/50">
            {[c.department, c.email].filter(Boolean).join(" ・ ")}
          </div>
          <div className="text-xs text-ink/40">
            {c.exchanged_on ?? ""} 交換
            {usersById.get(c.owner_user_id)?.name ? `（${usersById.get(c.owner_user_id)?.name}）` : ""}
            {c.memo ? ` — ${c.memo.slice(0, 60)}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
