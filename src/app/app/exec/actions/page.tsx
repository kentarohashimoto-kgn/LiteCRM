import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers, getUser } from "@/lib/data/select";
import { listMtgActions } from "@/lib/data/exec";
import { createMtgActionAction, updateMtgActionAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ACTION_STATUS, STATUS_LABEL, PRIORITY_LABEL, DEPARTMENTS, DEPT_LABEL } from "@/lib/exec-review";
import { formatDateFull } from "@/lib/utils";

export default async function ExecActionsPage() {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => user);
  const actions = await listMtgActions();
  const today = new Date().toISOString().slice(0, 10);
  const open = actions.filter((a) => a.status !== "done");
  const overdue = open.filter((a) => a.due_date && a.due_date < today);

  return (
    <div>
      <PageHeader title="アクション管理" subtitle="MTGで決めた対策アクションの担当・期限・実行状況を管理し、翌週に確認します。" />

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="card card-pad"><div className="text-xs text-ink/50">未完了</div><div className="text-2xl font-bold mt-1">{open.length}</div></div>
        <div className="card card-pad"><div className="text-xs text-ink/50">期限超過</div><div className="text-2xl font-bold mt-1 text-rose-600">{overdue.length}</div></div>
        <div className="card card-pad"><div className="text-xs text-ink/50">総数</div><div className="text-2xl font-bold mt-1">{actions.length}</div></div>
      </div>

      <Section title="アクションを追加" className="mb-5">
        <form action={createMtgActionAction} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input name="title" required placeholder="アクション名 *" className="input" />
          <input name="meeting_date" type="date" className="input" title="MTG日" />
          <textarea name="description" rows={2} placeholder="内容" className="input md:col-span-2" />
          <select name="department" defaultValue="sales" className="input">{DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
          <select name="owner_user_id" className="input"><option value="">担当者</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <input name="due_date" type="date" className="input" title="期限" />
          <select name="priority" defaultValue="middle" className="input"><option value="high">High</option><option value="middle">Middle</option><option value="low">Low</option></select>
          <button type="submit" className="btn-primary md:col-span-2">アクションを作成</button>
        </form>
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr><th className="th">アクション</th><th className="th">部門</th><th className="th">担当</th><th className="th">期限</th><th className="th">優先度</th><th className="th">状態・更新</th></tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {actions.map((a) => {
              const od = a.status !== "done" && a.due_date && a.due_date < today;
              return (
                <tr key={a.id} className="row-hover align-top">
                  <td className="td max-w-[280px]"><div className="font-medium">{a.title}</div>{a.description && <div className="text-xs text-ink/50 mt-0.5 whitespace-pre-wrap">{a.description}</div>}{a.completion_comment && <div className="text-[11px] text-emerald-700 mt-0.5">結果: {a.completion_comment}</div>}</td>
                  <td className="td text-xs">{a.department ? DEPT_LABEL[a.department] ?? a.department : "—"}</td>
                  <td className="td text-xs whitespace-nowrap">{a.owner_user_id ? getUser(ws, a.owner_user_id)?.name ?? "—" : "—"}</td>
                  <td className={`td text-xs whitespace-nowrap ${od ? "text-rose-500 font-medium" : ""}`}>{formatDateFull(a.due_date)}</td>
                  <td className="td text-xs">{PRIORITY_LABEL[a.priority] ?? a.priority}</td>
                  <td className="td">
                    <form action={updateMtgActionAction} className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="id" value={a.id} />
                      <select name="status" defaultValue={a.status} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs">{ACTION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                      <input name="completion_comment" defaultValue={a.completion_comment ?? ""} placeholder="完了コメント" className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs w-40" />
                      <button type="submit" className="btn-ghost text-xs py-1">更新</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {actions.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-8">アクションはまだありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/40 mt-3">※ 状態: {ACTION_STATUS.map((s) => `${STATUS_LABEL[s.key]}`).join(" / ")}。期限超過は赤字で表示します。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
