"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Option { id: string; name: string; }

/**
 * タスク/商談の担当別フィルタ。選択で ?assignee=<id|all> に遷移(サーバ側で絞り込み)。
 * view 等の既存クエリは保持する。
 */
export function AssigneeFilter({ owners, value }: { owners: Option[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        const p = new URLSearchParams(params.toString());
        p.set("assignee", v);
        router.push(`${pathname}?${p.toString()}`);
      }}
      className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary"
      aria-label="担当で絞り込み"
    >
      <option value="all">担当：すべて</option>
      {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
