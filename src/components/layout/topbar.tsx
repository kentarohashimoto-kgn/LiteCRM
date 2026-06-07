import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { UserSwitcher } from "./user-switcher";
import { logout } from "@/server/actions";
import { getUsers, getMemberships } from "@/lib/data/store";
import { getCtx, getCurrentUser } from "@/lib/session";
import { ROLE_MAP } from "@/lib/constants";
import type { Role } from "@/lib/types";

export function Topbar() {
  const ctx = getCtx();
  const user = getCurrentUser();
  const users = getUsers();
  const memberships = getMemberships(ctx);
  const roleByUser = Object.fromEntries(memberships.map((m) => [m.user_id, m.role])) as Record<string, Role>;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-black/[0.05] bg-white/80 backdrop-blur px-6 py-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">株式会社カトルセ</span>
        <span className="pill bg-teal-light text-teal-deep">{ROLE_MAP[ctx.role]?.label ?? ctx.role}</span>
      </div>
      <div className="flex items-center gap-4">
        <UserSwitcher users={users} roleByUser={roleByUser} currentId={ctx.userId} />
        <div className="flex items-center gap-2">
          <Avatar user={user} />
          <span className="text-sm font-medium text-ink/80 hidden md:inline">{user?.name}</span>
        </div>
        <form action={logout}>
          <button className="text-ink/40 hover:text-ink/70" title="ログアウト">
            <LogOut size={18} />
          </button>
        </form>
      </div>
    </header>
  );
}
