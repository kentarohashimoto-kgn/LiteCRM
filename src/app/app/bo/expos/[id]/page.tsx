import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { confirmExpoAction, rescheduleExpoAction, updateExpoTaskAction, updateExpoStaffingAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { lead_gen: "リード獲得要員", field_sales: "フィールドセールス", manager: "管理者" };
const CATEGORIES = ["出展手続", "人員", "制作物", "物流", "当日運営", "その他"];

interface TaskRow { id: string; name: string; category: string; due_date: string; status: string; assignee_user_id: string | null; }
interface StaffRow { id: string; date: string; role: string; user_id: string | null; member_name: string | null; }

/** BO-4 展示会WBS詳細: タスク消込・人員アサイン・会期変更(期日再計算)。 */
export default async function ExpoDetailPage({ params }: { params: { id: string } }) {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: project }, tasksR, staffR, profilesR] = await Promise.all([
    sb.from("expo_projects").select("id, name, starts_on, ends_on, venue, status").eq("id", params.id).maybeSingle(),
    sb.from("expo_tasks").select("id, name, category, due_date, status, assignee_user_id").eq("project_id", params.id).order("due_date"),
    sb.from("expo_staffing").select("id, date, role, user_id, member_name").eq("project_id", params.id).order("date"),
    sb.from("profiles").select("id, display_name, email"),
  ]);
  if (!project) notFound();
  const tasks = (tasksR.data ?? []) as TaskRow[];
  const staff = (staffR.data ?? []) as StaffRow[];
  const members = (profilesR.data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) || (p.email as string) || "—" }));
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const openTasks = tasks.filter((t) => t.status === "todo" || t.status === "doing");

  return (
    <div className="max-w-4xl">
      <Link href="/app/bo/expos" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 展示会一覧
      </Link>
      <PageHeader
        title={project.name as string}
        subtitle={`${project.starts_on} 〜 ${project.ends_on ?? ""}${project.venue ? ` ・ ${project.venue}` : ""}`}
        action={
          project.status !== "confirmed" ? (
            <form action={confirmExpoAction}>
              <input type="hidden" name="id" value={params.id} />
              <SubmitButton className="btn-accent" pendingLabel="保存中…">出展を確定（WBS自動生成）</SubmitButton>
            </form>
          ) : (
            <span className="pill bg-teal-light text-teal-deep">確定</span>
          )
        }
      />

      {/* 会期変更 */}
      <details className="mb-5">
        <summary className="cursor-pointer text-xs text-ink/45 hover:text-ink">会期を変更する（未完了タスクの期日を自動再計算）</summary>
        <form action={rescheduleExpoAction} className="mt-2 flex items-end gap-2.5 flex-wrap">
          <input type="hidden" name="id" value={params.id} />
          <div><label className="label">会期(初日)</label><input name="starts_on" type="date" defaultValue={project.starts_on as string} className="input" /></div>
          <div><label className="label">会期(最終日)</label><input name="ends_on" type="date" defaultValue={(project.ends_on as string) ?? ""} className="input" /></div>
          <SubmitButton className="rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/[0.03]" pendingLabel="保存中…">変更を反映</SubmitButton>
        </form>
      </details>

      <Section title={`準備タスク（残り ${openTasks.length} / 全 ${tasks.length}）`} className="mb-5">
        {tasks.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">「出展を確定」するとプリセットからタスクが生成されます</p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((t) => {
              const isOverdue = (t.status === "todo" || t.status === "doing") && t.due_date < today;
              return (
                <li key={t.id} className="flex items-center gap-2.5 text-sm">
                  <form action={updateExpoTaskAction}>
                    <input type="hidden" name="project_id" value={params.id} />
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="op" value={t.status === "done" ? "todo" : "done"} />
                    <button type="submit" className={`h-[18px] w-[18px] rounded border flex items-center justify-center text-[11px] ${t.status === "done" ? "bg-teal-primary border-teal-primary text-white" : "border-black/20 bg-white"}`} aria-label={`${t.name} を切替`}>
                      {t.status === "done" ? "✓" : ""}
                    </button>
                  </form>
                  <span className="pill bg-black/[0.04] text-ink/50 shrink-0">{t.category}</span>
                  <span className={`min-w-0 flex-1 truncate ${t.status === "done" ? "line-through text-ink/40" : "text-ink/80"}`}>{t.name}</span>
                  <form action={updateExpoTaskAction} className="shrink-0">
                    <input type="hidden" name="project_id" value={params.id} />
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="op" value="assign" />
                    <select name="assignee" defaultValue={t.assignee_user_id ?? ""} className="rounded-lg border border-black/10 bg-white px-1.5 py-0.5 text-xs" onChange={undefined}>
                      <option value="">担当なし</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <SubmitButton className="text-[11px] text-teal-deep hover:underline ml-1" pendingLabel="保存中…">設定</SubmitButton>
                  </form>
                  <span className={`text-xs tabular-nums shrink-0 ${isOverdue ? "text-rose-600 font-semibold" : "text-ink/45"}`}>{t.due_date}{isOverdue && " 超過"}</span>
                  <form action={updateExpoTaskAction} className="shrink-0">
                    <input type="hidden" name="project_id" value={params.id} />
                    <input type="hidden" name="id" value={t.id} />
                    <button name="op" value="delete" className="text-ink/25 hover:text-rose-500 text-xs">×</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        {/* タスク追加 */}
        <form action={updateExpoTaskAction} className="mt-3 flex items-end gap-2 flex-wrap border-t border-black/[0.04] pt-3">
          <input type="hidden" name="project_id" value={params.id} />
          <input type="hidden" name="op" value="add" />
          <input name="name" required className="input max-w-xs" placeholder="タスクを追加" />
          <select name="category" className="input w-auto">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input name="due_date" type="date" required className="input w-auto" />
          <SubmitButton className="rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/[0.03]" pendingLabel="追加中…">追加</SubmitButton>
        </form>
      </Section>

      <Section title="当日運営の人員アサイン">
        {staff.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 text-sm">
                <span className="text-xs tabular-nums text-ink/50 shrink-0">{s.date}</span>
                <span className="pill bg-teal-light text-teal-deep shrink-0">{ROLE_LABEL[s.role] ?? s.role}</span>
                <span className="text-ink/80 min-w-0 truncate">{s.user_id ? nameOf.get(s.user_id) ?? "—" : s.member_name}</span>
                <form action={updateExpoStaffingAction} className="ml-auto shrink-0">
                  <input type="hidden" name="project_id" value={params.id} />
                  <input type="hidden" name="id" value={s.id} />
                  <button name="op" value="delete" className="text-ink/25 hover:text-rose-500 text-xs">×</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={updateExpoStaffingAction} className="flex items-end gap-2 flex-wrap">
          <input type="hidden" name="project_id" value={params.id} />
          <input type="hidden" name="op" value="add" />
          <div><label className="label">日付</label><input name="date" type="date" required defaultValue={project.starts_on as string} className="input w-auto" /></div>
          <div>
            <label className="label">役割</label>
            <select name="role" className="input w-auto">
              <option value="lead_gen">リード獲得要員</option>
              <option value="field_sales">フィールドセールス</option>
              <option value="manager">管理者</option>
            </select>
          </div>
          <div>
            <label className="label">メンバー</label>
            <select name="user_id" className="input w-auto">
              <option value="">（社外・下の氏名欄）</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <input name="member_name" className="input max-w-[160px]" placeholder="社外メンバー名" />
          <SubmitButton className="btn-accent" pendingLabel="保存中…">アサイン</SubmitButton>
        </form>
        <p className="text-[11px] text-ink/35 mt-2">社内メンバーをアサインすると本人へ通知(ベル)が届きます。</p>
      </Section>
    </div>
  );
}
