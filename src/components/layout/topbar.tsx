import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { signOut } from "@/server/actions";
import { getWorkspace } from "@/lib/data/workspace";
import { getUser } from "@/lib/data/select";
import { ROLE_MAP } from "@/lib/constants";

export async function Topbar() {
  const ws = await getWorkspace();
  const user = getUser(ws, ws.ctx.userId);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-black/[0.05] bg-white/80 backdrop-blur px-6 py-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink">株式会社カトルセ</span>
        <span className="pill bg-teal-light text-teal-deep">{ROLE_MAP[ws.ctx.role]?.label ?? ws.ctx.role}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Avatar user={user} />
          <span className="text-sm font-medium text-ink/80 hidden md:inline">{user?.name}</span>
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
