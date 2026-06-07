"use client";

import { useRef } from "react";
import { switchUser } from "@/server/actions";
import type { Role, User } from "@/lib/types";
import { ROLE_MAP } from "@/lib/constants";

/**
 * デモ用ユーザー切替。ロールごとの見え方(RLS相当のスコープ)を
 * その場で検証できるようにする。Supabase化時は不要。
 */
export function UserSwitcher({
  users,
  roleByUser,
  currentId,
}: {
  users: User[];
  roleByUser: Record<string, Role>;
  currentId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form action={switchUser} ref={formRef} className="flex items-center gap-2">
      <span className="text-[11px] text-ink/40 hidden sm:inline">表示ユーザー</span>
      <select
        name="userId"
        defaultValue={currentId}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-teal-primary"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}（{ROLE_MAP[roleByUser[u.id]]?.label ?? roleByUser[u.id]}）
          </option>
        ))}
      </select>
    </form>
  );
}
