import { switchUser } from "@/server/actions";
import { getUsers, getMemberships } from "@/lib/data/store";
import { ROLE_MAP, APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { TENANT_ID } from "@/lib/data/seed";
import { Avatar } from "@/components/ui/primitives";

export default function LoginPage() {
  const users = getUsers();
  const memberships = getMemberships({ userId: "", role: "owner", tenantId: TENANT_ID });
  const roleByUser = Object.fromEntries(memberships.map((m) => [m.user_id, m.role]));

  return (
    <div className="min-h-screen flex items-center justify-center bg-mist-soft p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-teal-deep font-bold text-2xl tracking-tight">CATORCE</div>
          <div className="text-sm font-semibold text-ink mt-1">{APP_NAME}</div>
          <div className="text-xs text-ink/50 mt-1">{APP_TAGLINE}</div>
        </div>

        <div className="card card-pad">
          <p className="text-sm text-ink/70 mb-1 font-semibold">ログイン</p>
          <p className="text-xs text-ink/45 mb-4">
            デモモードです。メンバーを選択してログインしてください。ロールごとに見える範囲（RLS相当）が変わります。
          </p>
          <div className="space-y-2">
            {users.map((u) => (
              <form action={switchUser} key={u.id}>
                <input type="hidden" name="userId" value={u.id} />
                <button className="w-full flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5 text-left hover:border-teal-primary hover:bg-teal-light/40 transition-colors">
                  <Avatar user={u} size={34} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{u.name}</span>
                    <span className="block text-xs text-ink/50">
                      {ROLE_MAP[roleByUser[u.id]]?.label ?? roleByUser[u.id]} ・ {u.email}
                    </span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        </div>

        <p className="text-center text-[11px] text-ink/35 mt-4">
          本番では Supabase Auth（メール+パスワード / Google）に置き換わります。
        </p>
      </div>
    </div>
  );
}
