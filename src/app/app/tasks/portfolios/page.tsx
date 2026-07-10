import Link from "next/link";
import { Plus, LayoutList } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub, projectsOf } from "@/lib/data/tasks";
import { PageHeader, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { colorOf, COLOR_KEYS } from "@/lib/constants";
import { createPortfolioAction } from "@/server/actions/tasks";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PortfoliosPage() {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const members = listMembers(ws).map(({ user }) => user);

  // プロジェクト別のタスク進捗
  const stat = new Map<string, { open: number; done: number }>();
  for (const t of ws.tasks) {
    if (!t.project_id) continue;
    const s = stat.get(t.project_id) ?? { open: 0, done: 0 };
    if (t.status === "done") s.done += 1;
    else s.open += 1;
    stat.set(t.project_id, s);
  }

  return (
    <div>
      <PageHeader title="ポートフォリオ" subtitle="複数プロジェクトを束ねて、全体の進捗と健全性をまとめて把握します。" action={<NewPortfolioButton members={members} />} />

      {hub.portfolios.length === 0 ? (
        <EmptyState message="ポートフォリオはまだありません。右上から作成し、プロジェクトを束ねましょう。" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hub.portfolios.map((pf) => {
            const c = colorOf(pf.color);
            const projs = projectsOf(hub, pf.id);
            let done = 0;
            let total = 0;
            for (const p of projs) {
              const s = stat.get(p.id) ?? { open: 0, done: 0 };
              done += s.done;
              total += s.open + s.done;
            }
            const goals = hub.goals.filter((g) => g.portfolio_id === pf.id);
            return (
              <Link key={pf.id} href={`/app/tasks/portfolios/${pf.id}`} className="card card-pad hover:shadow-md transition-shadow group">
                <div className="flex items-center gap-2.5">
                  <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl text-white", c.bg)}>
                    <LayoutList size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-ink truncate group-hover:text-teal-deep">{pf.name}</div>
                    <div className="text-[11px] text-ink/40">{projs.length} プロジェクト・{goals.length} ゴール</div>
                  </div>
                  <span className="ml-auto text-sm font-bold tabular-nums text-ink/70">{total > 0 ? Math.round((done / total) * 100) : 0}%</span>
                </div>
                {pf.description && <p className="mt-2.5 text-xs text-ink/50 line-clamp-2">{pf.description}</p>}
                <div className="mt-3">
                  <ProgressBar value={done} max={Math.max(total, 1)} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {projs.slice(0, 5).map((p) => (
                    <span key={p.id} className="pill bg-mist-soft text-ink/50 text-[10px]">
                      <span className={cn("h-1.5 w-1.5 rounded-full", colorOf(p.color).dot)} /> {p.name}
                    </span>
                  ))}
                  {projs.length === 0 && <span className="text-[11px] text-ink/35">プロジェクト未割り当て</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewPortfolioButton({ members }: { members: { id: string; name: string }[] }) {
  return (
    <details className="relative">
      <summary className="btn-primary cursor-pointer list-none">
        <Plus size={16} /> 新規ポートフォリオ
      </summary>
      <form action={createPortfolioAction} className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-black/10 bg-white p-4 shadow-xl space-y-3">
        <div>
          <label className="label">名称 *</label>
          <input name="name" required className="input" placeholder="例：営業部門 全社施策" />
        </div>
        <div>
          <label className="label">説明</label>
          <textarea name="description" rows={2} className="input resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">色</label>
            <select name="color" className="input" defaultValue="violet">
              {COLOR_KEYS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">オーナー</label>
            <select name="owner_user_id" className="input">
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" className="btn-primary w-full">作成する</button>
      </form>
    </details>
  );
}
