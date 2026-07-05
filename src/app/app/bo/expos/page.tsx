import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { createExpoProjectAction } from "@/server/actions/bo";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { planning: "検討中", confirmed: "確定", done: "終了", cancelled: "中止" };

interface ProjectRow {
  id: string; name: string; starts_on: string; ends_on: string | null; venue: string | null; status: string;
  expo_tasks: { status: string; due_date: string }[];
}

/** BO-4 展示会準備WBS: 確定でタスク自動生成、納期前リマインド。 */
export default async function ExposPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("expo_projects")
    .select("id, name, starts_on, ends_on, venue, status, expo_tasks(status, due_date)")
    .order("starts_on", { ascending: false })
    .limit(100);
  const projects = (data ?? []) as unknown as ProjectRow[];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="展示会準備WBS"
        subtitle="展示会を「確定」にするとプリセットからWBSを自動生成し、納期前にリマインドします。"
        action={
          <Link href="/app/bo/expos/templates" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
            <Settings2 size={14} /> タスクプリセット
          </Link>
        }
      />

      <Section title="展示会を登録" className="mb-5">
        <form action={createExpoProjectAction} className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">展示会名 *</label>
              <input name="name" required className="input" placeholder="例: 202610_AI EXPO 秋" />
            </div>
            <div>
              <label className="label">会期(初日) *</label>
              <input name="starts_on" type="date" required className="input" />
            </div>
            <div>
              <label className="label">会期(最終日)</label>
              <input name="ends_on" type="date" className="input" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <input name="venue" className="input max-w-xs" placeholder="会場（例: 東京ビッグサイト）" />
            <label className="inline-flex items-center gap-1.5 text-sm text-ink/70 cursor-pointer">
              <input type="checkbox" name="confirmed" value="1" defaultChecked className="accent-teal-primary" />
              出展確定（WBSを自動生成）
            </label>
            <button type="submit" className="btn-accent">登録</button>
          </div>
        </form>
      </Section>

      <Section title={`展示会（${projects.length}）`}>
        {projects.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">展示会はまだ登録されていません</p>
        ) : (
          <ul className="divide-y divide-black/[0.04]">
            {projects.map((p) => {
              const open = p.expo_tasks.filter((t) => t.status === "todo" || t.status === "doing");
              const overdue = open.filter((t) => t.due_date < today).length;
              const done = p.expo_tasks.length - open.length;
              return (
                <li key={p.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/bo/expos/${p.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{p.name}</Link>
                    <div className="text-xs text-ink/45">{p.starts_on} 〜 {p.ends_on ?? ""}{p.venue ? ` ・ ${p.venue}` : ""}</div>
                  </div>
                  <span className={`pill shrink-0 ${p.status === "confirmed" ? "bg-teal-light text-teal-deep" : "bg-black/[0.05] text-ink/50"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                  {overdue > 0 && <span className="pill bg-rose-50 text-rose-600 shrink-0">超過 {overdue}</span>}
                  <span className="text-xs text-ink/40 shrink-0 tabular-nums">{done}/{p.expo_tasks.length} 完了</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
