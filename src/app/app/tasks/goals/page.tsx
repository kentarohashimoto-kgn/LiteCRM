import { Plus, Target } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub } from "@/lib/data/tasks";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { GoalMeter } from "@/components/tasks/goal-meter";
import { GOAL_STATUSES } from "@/lib/constants";
import { createGoalAction } from "@/server/actions/tasks";
import { formatDateFull, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const members = listMembers(ws).map(({ user }) => user);

  const roots = hub.goals.filter((g) => !g.parent_goal_id);
  const childrenOf = (id: string) => hub.goals.filter((g) => g.parent_goal_id === id);

  // ステータス別サマリ
  const counts = new Map<string, number>();
  for (const g of hub.goals) counts.set(g.status, (counts.get(g.status) ?? 0) + 1);

  return (
    <div>
      <PageHeader title="ゴール" subtitle="数値目標と進捗を可視化。プロジェクト/ポートフォリオに紐づけ、達成に向けて動きます。" action={<NewGoalButton members={members} portfolios={hub.portfolios} projects={hub.projects} goals={hub.goals} />} />

      {hub.goals.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {GOAL_STATUSES.map((s) => (
            <div key={s.key} className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5", s.bg)}>
              <span className={cn("h-2 w-2 rounded-full", s.dot)} />
              <span className={cn("text-xs font-semibold", s.text)}>{s.label}</span>
              <span className="text-xs font-bold tabular-nums text-ink/60">{counts.get(s.key) ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {hub.goals.length === 0 ? (
        <EmptyState message="ゴールはまだありません。右上から目標を作成しましょう。" />
      ) : (
        <div className="space-y-4">
          {roots.map((g) => {
            const owner = members.find((m) => m.id === g.owner_user_id);
            const kids = childrenOf(g.id);
            return (
              <div key={g.id} className="card card-pad">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-teal-light text-teal-deep shrink-0">
                    <Target size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-ink">{g.name}</div>
                    {g.description && <p className="text-xs text-ink/50 mt-0.5">{g.description}</p>}
                    <div className="mt-1 text-[11px] text-ink/40">
                      {owner?.name ?? "—"}
                      {g.period_end && <span className="ml-2">期限 {formatDateFull(g.period_end)}</span>}
                    </div>
                  </div>
                  <div className="w-64 shrink-0">
                    <GoalMeter goal={{ id: g.id, current: g.current_value, target: g.target_value ?? null, unit: g.unit ?? null, kind: g.metric_kind, status: g.status }} />
                  </div>
                </div>
                {kids.length > 0 && (
                  <div className="mt-3 ml-12 space-y-2 border-l-2 border-black/[0.05] pl-4">
                    {kids.map((k) => (
                      <div key={k.id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1 text-sm text-ink/80 truncate">{k.name}</div>
                        <div className="w-56 shrink-0">
                          <GoalMeter goal={{ id: k.id, current: k.current_value, target: k.target_value ?? null, unit: k.unit ?? null, kind: k.metric_kind, status: k.status }} compact />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewGoalButton({
  members,
  portfolios,
  projects,
  goals,
}: {
  members: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  goals: { id: string; name: string }[];
}) {
  return (
    <details className="relative">
      <summary className="btn-primary cursor-pointer list-none">
        <Plus size={16} /> 新規ゴール
      </summary>
      <form action={createGoalAction} className="absolute right-0 z-20 mt-2 w-96 rounded-2xl border border-black/10 bg-white p-4 shadow-xl space-y-3">
        <div>
          <label className="label">ゴール名 *</label>
          <input name="name" required className="input" placeholder="例：Q3 新規受注 30件" />
        </div>
        <div>
          <label className="label">説明</label>
          <textarea name="description" rows={2} className="input resize-none" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">種別</label>
            <select name="metric_kind" className="input" defaultValue="number">
              <option value="number">数値</option>
              <option value="percent">%</option>
              <option value="currency">金額</option>
            </select>
          </div>
          <div>
            <label className="label">現在</label>
            <input name="current_value" type="number" step="any" className="input" defaultValue={0} />
          </div>
          <div>
            <label className="label">目標</label>
            <input name="target_value" type="number" step="any" className="input" placeholder="30" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">単位</label>
            <input name="unit" className="input" placeholder="件 / 社 など" />
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">開始</label>
            <input name="period_start" type="date" className="input" />
          </div>
          <div>
            <label className="label">期限</label>
            <input name="period_end" type="date" className="input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">ポートフォリオ</label>
            <select name="portfolio_id" className="input" defaultValue="">
              <option value="">なし</option>
              {portfolios.map((pf) => (
                <option key={pf.id} value={pf.id}>{pf.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">プロジェクト</label>
            <select name="project_id" className="input" defaultValue="">
              <option value="">なし</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">親ゴール（任意）</label>
          <select name="parent_goal_id" className="input" defaultValue="">
            <option value="">トップレベル</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary w-full">作成する</button>
      </form>
    </details>
  );
}
