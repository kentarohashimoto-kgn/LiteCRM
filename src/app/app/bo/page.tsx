import Link from "next/link";
import { BadgeCheck, BookOpen, ClipboardList, Presentation } from "lucide-react";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const MODULES = [
  { href: "/app/bo/subsidies", label: "助成金トラッカー", desc: "事前説明会・事前申請・実績報告の納期管理", icon: BadgeCheck },
  { href: "/app/bo/expos", label: "展示会準備WBS", desc: "確定でタスク自動生成・人員アサイン・納期リマインド", icon: Presentation },
  { href: "/app/bo/cases", label: "事例・インタビュー", desc: "研修受講会社の事例化パイプライン", icon: BookOpen },
  { href: "/app/bo/surveys", label: "講師アンケート", desc: "講師別・研修種類別・受講者層別の分析", icon: ClipboardList },
];

interface DueItem { label: string; sub: string; due: string; href: string; }

/** BOダッシュボード: 全モジュール横断の期日と入口。 */
export default async function BoHomePage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const [msR, taskR] = await Promise.all([
    sb
      .from("subsidy_milestones")
      .select("id, label, due_date, subsidy_cases(account_name, training_name)")
      .eq("status", "todo")
      .lte("due_date", in14)
      .order("due_date")
      .limit(20),
    sb
      .from("expo_tasks")
      .select("id, name, due_date, project_id, expo_projects(name)")
      .in("status", ["todo", "doing"])
      .lte("due_date", in14)
      .order("due_date")
      .limit(20),
  ]);

  const items: DueItem[] = [
    ...((msR.data ?? []) as unknown as { id: string; label: string; due_date: string; subsidy_cases: { account_name: string; training_name: string } | null }[]).map((m) => ({
      label: `助成金: ${m.label}`,
      sub: `${m.subsidy_cases?.account_name ?? ""}｜${m.subsidy_cases?.training_name ?? ""}`,
      due: m.due_date,
      href: "/app/bo/subsidies",
    })),
    ...((taskR.data ?? []) as unknown as { id: string; name: string; due_date: string; project_id: string; expo_projects: { name: string } | null }[]).map((t) => ({
      label: `展示会: ${t.name}`,
      sub: t.expo_projects?.name ?? "",
      due: t.due_date,
      href: `/app/bo/expos/${t.project_id}`,
    })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const overdue = items.filter((i) => i.due < today);

  return (
    <div>
      <PageHeader title="バックオフィス" subtitle="納期のある事務作業を横断で見張る場所。この領域は事務・人事・管理者のみ表示されます。" />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card><div className="text-xs text-ink/50">14日以内の期日</div><div className="stat-value mt-1">{items.length}</div></Card>
        <Card><div className="text-xs text-ink/50">期限超過</div><div className={`stat-value mt-1 ${overdue.length ? "text-rose-600" : ""}`}>{overdue.length}</div></Card>
        <Card><div className="text-xs text-ink/50">今日</div><div className="stat-value mt-1">{items.filter((i) => i.due === today).length}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="直近の期日（14日以内・全モジュール横断）">
          {items.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">14日以内の期日はありません 🎉</p>
          ) : (
            <ul className="space-y-2">
              {items.slice(0, 15).map((i, idx) => (
                <li key={idx} className="text-sm flex items-center gap-2">
                  <span className={`pill shrink-0 tabular-nums ${i.due < today ? "bg-rose-50 text-rose-600" : i.due === today ? "bg-amber-50 text-amber-700" : "bg-black/[0.05] text-ink/60"}`}>
                    {i.due}{i.due < today && " 超過"}
                  </span>
                  <Link href={i.href} className="min-w-0 flex-1 hover:text-teal-deep">
                    <span className="font-medium block truncate">{i.label}</span>
                    <span className="text-xs text-ink/45 block truncate">{i.sub}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="モジュール">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <Link key={m.href} href={m.href} className="card card-pad hover:border-teal-primary/40 flex items-start gap-3">
                  <span className="rounded-lg bg-teal-light p-2 text-teal-deep shrink-0"><Icon size={18} /></span>
                  <span className="min-w-0">
                    <span className="block font-medium text-ink text-sm">{m.label}</span>
                    <span className="block text-xs text-ink/50 mt-0.5">{m.desc}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
