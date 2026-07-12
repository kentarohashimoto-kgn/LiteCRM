import Link from "next/link";
import { Plus, FolderKanban, Archive } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub } from "@/lib/data/tasks";
import { PageHeader, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { colorOf, COLOR_KEYS } from "@/lib/constants";
import { createProjectAction } from "@/server/actions/tasks";
import { cn } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const members = listMembers(ws).map(({ user }) => user);

  const statByProject = new Map<string, { open: number; done: number }>();
  for (const t of ws.tasks) {
    if (!t.project_id) continue;
    const s = statByProject.get(t.project_id) ?? { open: 0, done: 0 };
    if (t.status === "done") s.done += 1;
    else s.open += 1;
    statByProject.set(t.project_id, s);
  }

  const active = hub.projects.filter((p) => p.status !== "archived");
  const archived = hub.projects.filter((p) => p.status === "archived");

  return (
    <div>
      <PageHeader title="プロジェクト" subtitle="タスクの上位に置く器。案件・施策・チームの単位で束ね、ボード/リスト/カレンダーで進めます。" action={<NewProjectButton members={members} portfolios={hub.portfolios} />} />

      {active.length === 0 ? (
        <EmptyState message="プロジェクトはまだありません。右上の「新規プロジェクト」から作成できます。" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((p) => {
            const c = colorOf(p.color);
            const st = statByProject.get(p.id) ?? { open: 0, done: 0 };
            const total = st.open + st.done;
            const owner = members.find((m) => m.id === p.owner_user_id);
            const portfolio = hub.portfolios.find((pf) => pf.id === p.portfolio_id);
            return (
              <Link key={p.id} href={`/app/tasks/projects/${p.id}`} className="card card-pad hover:shadow-md transition-shadow group">
                <div className="flex items-center gap-2.5">
                  <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl text-white", c.bg)}>
                    <FolderKanban size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-ink truncate group-hover:text-teal-deep">{p.name}</div>
                    {portfolio && <div className="text-[11px] text-ink/40 truncate">{portfolio.name}</div>}
                  </div>
                </div>
                {p.description && <p className="mt-2.5 text-xs text-ink/50 line-clamp-2">{p.description}</p>}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-ink/45 mb-1">
                    <span>進捗</span>
                    <span className="tabular-nums">{total > 0 ? Math.round((st.done / total) * 100) : 0}%（{st.done}/{total}）</span>
                  </div>
                  <ProgressBar value={st.done} max={Math.max(total, 1)} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-ink/45">未完了 {st.open} 件</span>
                  {owner && (
                    <span className="inline-flex items-center justify-center rounded-full text-white text-[10px] font-bold" style={{ width: 22, height: 22, backgroundColor: owner.avatarColor ?? "#008C8C" }} title={owner.name}>
                      {owner.name.slice(0, 1)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 text-xs font-bold text-ink/40 mb-2">
            <Archive size={14} /> アーカイブ済み（{archived.length}）
          </div>
          <div className="flex flex-wrap gap-2">
            {archived.map((p) => (
              <Link key={p.id} href={`/app/tasks/projects/${p.id}`} className="pill bg-mist-soft text-ink/50 hover:text-ink/80">
                <span className={cn("h-1.5 w-1.5 rounded-full", colorOf(p.color).dot)} /> {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewProjectButton({ members, portfolios }: { members: { id: string; name: string }[]; portfolios: { id: string; name: string }[] }) {
  return (
    <details className="relative">
      <summary className="btn-primary cursor-pointer list-none">
        <Plus size={16} /> 新規プロジェクト
      </summary>
      <form action={createProjectAction} className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-black/10 bg-white p-4 shadow-xl space-y-3">
        <div>
          <label className="label">プロジェクト名 *</label>
          <input name="name" required className="input" placeholder="例：2026 Q3 リード獲得キャンペーン" />
        </div>
        <div>
          <label className="label">説明</label>
          <textarea name="description" rows={2} className="input resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">色</label>
            <select name="color" className="input" defaultValue="teal">
              {COLOR_KEYS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">既定ビュー</label>
            <select name="default_view" className="input" defaultValue="board">
              <option value="board">ボード</option>
              <option value="list">リスト</option>
              <option value="calendar">カレンダー</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">オーナー</label>
            <select name="owner_user_id" className="input">
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ポートフォリオ</label>
            <select name="portfolio_id" className="input" defaultValue="">
              <option value="">なし</option>
              {portfolios.map((pf) => (
                <option key={pf.id} value={pf.id}>{pf.name}</option>
              ))}
            </select>
          </div>
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="作成中…">作成する</SubmitButton>
      </form>
    </details>
  );
}
