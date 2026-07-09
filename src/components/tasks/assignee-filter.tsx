"use client";

import { useRouter, usePathname } from "next/navigation";

interface Option { id: string; name: string; }

/** タスクの担当別フィルタ。選択で ?assignee=<id> に遷移(サーバ側で絞り込み)。 */
export function AssigneeFilter({ owners, value }: { owners: Option[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={value}
      onChange={(e) => { const v = e.target.value; router.push(v ? `${pathname}?assignee=${v}` : pathname); }}
      className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary"
      aria-label="担当で絞り込み"
    >
      <option value="">担当：すべて</option>
      {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
