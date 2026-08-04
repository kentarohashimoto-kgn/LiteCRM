import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LayoutList, FolderKanban, Target } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub, projectsOf } from "@/lib/data/tasks";
import { ProgressBar } from "@/components/ui/primitives";
import { PortfolioProjectPicker } from "@/components/tasks/portfolio-project-picker";
import { GoalMeter } from "@/components/tasks/goal-meter";
import { colorOf, GOAL_STATUS_MAP } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PortfolioDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const pf = hub.portfolios.find((p) => p.id === params.id);
  if (!pf) notFound();

  const members = listMembers(ws).map(({ user }) => user);
  const stat = new Map<string, { open: number; done: number }>();
  for (const t of ws.tasks) {
    if (!t.project_id) continue;
    const s = stat.get(t.project_id) ?? { open: 0, done: 0 };
    if (t.status === "done") s.done += 1;
    else s.open += 1;
    stat.set(t.project_id, s);
  }

  const projs = projectsOf(hub, pf.id);
  const candidates = hub.projects.filter((p) => p.portfolio_id !== pf.id && p.status !== "archived").map((p) => ({ id: p.id, name: p.name }));
  const goals = hub.goals.filter((g) => g.portfolio_id === pf.id);

  let done = 0;
  let total = 0;
  for (const p of projs) {
    const s = stat.get(p.id) ?? { open: 0, done: 0 };
    done += s.done;
    total += s.open + s.done;
  }
  const c = colorOf(pf.color);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/app/tasks/portfolios" className="text-ink/40 hover:text-teal-deep">
          <ArrowLeft size={18} />
        </Link>
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg text-white", c.bg)}>
          <LayoutList size={16} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-ink leading-tight">{pf.name}</h1>
          {pf.description && <p className="text-[11px] text-ink/45">{pf.description}</p>}
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-bold tabular-nums text-teal-deep">{total > 0 ? Math.round((done / total) * 100) : 0}%</div>
          <div className="text-[11px] text-ink/45">全体進捗（{done}/{total}）</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.04]">
            <h2 className="section-title"><FolderKanban size={15} /> プロジェクト（{projs.length}）</h2>
            <PortfolioProjectPicker portfolioId={pf.id} candidates={candidates} />
          </div>
          {projs.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink/40 text-center">まだプロジェクトがありません。上のセレクトから追加できます。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-ink/40 text-xs bg-mist-soft/30">
                <tr>
                  <th className="th">プロジェクト</th>
                  <th className="th">オーナー</th>
                  <th className="th w-48">進捗</th>
                  <th className="th text-right">未完了</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {projs.map((p) => {
                  const s = stat.get(p.id) ?? { open: 0, done: 0 };
                  const tot = s.open + s.done;
                  const owner = members.find((m) => m.id === p.owner_user_id);
                  return (
                    <tr key={p.id} className="row-hover">
                      <td className="td">
                        <Link href={`/app/tasks/projects/${p.id}`} className="inline-flex items-center gap-2 font-medium text-ink hover:text-teal-deep">
                          <span className={cn("h-2 w-2 rounded-full", colorOf(p.color).dot)} /> {p.name}
                        </Link>
                      </td>
                      <td className="td text-ink/60">{owner?.name ?? "—"}</td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="flex-1"><ProgressBar value={s.done} max={Math.max(tot, 1)} /></div>
                          <span className="text-[11px] tabular-nums text-ink/50 w-10 text-right">{tot > 0 ? Math.round((s.done / tot) * 100) : 0}%</span>
                        </div>
                      </td>
                      <td className="td text-right tabular-nums text-ink/70">{s.open}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.04]">
            <h2 className="section-title"><Target size={15} /> ゴール（{goals.length}）</h2>
            <Link href="/app/tasks/goals" className="text-xs text-teal-deep hover:underline">管理</Link>
          </div>
          <div className="p-4 space-y-3">
            {goals.length === 0 ? (
              <p className="text-sm text-ink/40 py-4 text-center">紐づくゴールはありません。</p>
            ) : (
              goals.map((g) => {
                const st = GOAL_STATUS_MAP[g.status];
                return (
                  <div key={g.id} className="rounded-xl border border-black/[0.05] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn("h-2 w-2 rounded-full", st.dot)} />
                      <span className="text-sm font-semibold text-ink truncate">{g.name}</span>
                      <span className={cn("ml-auto pill text-[10px]", st.bg, st.text)}>{st.label}</span>
                    </div>
                    <GoalMeter goal={{ id: g.id, current: g.current_value, target: g.target_value ?? null, unit: g.unit ?? null, kind: g.metric_kind, status: g.status }} compact />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
