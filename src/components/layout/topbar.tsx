import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { QuickAdd } from "@/components/layout/quick-add";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationBell } from "@/components/layout/notification-bell";
import { signOut } from "@/server/actions";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ROLE_MAP } from "@/lib/constants";

export async function Topbar() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [{ data }, { count: unread }] = await Promise.all([
    sb.from("profiles").select("display_name,email,avatar_color").eq("id", ctx.userId).maybeSingle(),
    sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  const user = {
    id: ctx.userId,
    name: data?.display_name ?? data?.email ?? "—",
    email: data?.email ?? "",
    avatarColor: data?.avatar_color ?? "#008C8C",
  };

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-black/[0.05] bg-white/80 backdrop-blur px-6 py-3">
      <div className="flex items-center gap-3 text-sm flex-1 min-w-0">
        <span className="font-semibold text-ink shrink-0 hidden lg:inline">株式会社カトルセ</span>
        <span className="pill bg-teal-light text-teal-deep shrink-0 hidden lg:inline">{ROLE_MAP[ctx.role]?.label ?? ctx.role}</span>
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-4">
        <QuickAdd />
        <NotificationBell initialUnread={unread ?? 0} />
        <div className="flex items-center gap-2">
          <Avatar user={user} />
          <span className="text-sm font-medium text-ink/80 hidden md:inline">{user.name}</span>
        </div>
        <form action={signOut}>
          <button className="text-ink/40 hover:text-ink/70" title="ログアウト">
            <LogOut size={18} />
          </button>
        </form>
      </div>
    </header>
  );
}
