import { FolderKanban } from "lucide-react";
import { requireProjectCtx } from "@/lib/session";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getUser } from "@/lib/data/select";
import { listManagedProjects } from "@/lib/data/projects";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ProjectsTable, type ProjectRow } from "@/components/projects/projects-table";

export const dynamic = "force-dynamic";

export default async function ProjectsListPage() {
  await requireProjectCtx();
  const [rows, ws] = await Promise.all([listManagedProjects(), getWorkspaceLite()]);

  const viewRows: ProjectRow[] = rows.map((r) => {
    const t = r.computed?.roll.totals;
    return {
      opportunityId: r.opportunityId,
      oppName: r.oppName,
      accountName: r.accountName,
      ownerName: r.ownerUserId ? getUser(ws, r.ownerUserId)?.name ?? "—" : "—",
      priority: r.priority,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      isActive: r.isActive,
      isFuture: r.isFuture,
      isPast: r.isPast,
      hasPlan: !!r.computed,
      revenue: t?.revenue ?? 0,
      cost: t?.cost ?? 0,
      gross: t?.gross ?? 0,
      grossRate: t?.grossRate ?? 0,
      verdict: r.computed?.verdict ?? null,
      latestStatus: r.latestStatus,
      latestPeriodType: r.latestPeriodType,
      finalActualCost: r.finalActualCost,
      finalProfit: r.finalProfit,
      finalVariance: r.finalVariance,
      finalComment: r.finalComment,
    };
  });

  return (
    <div>
      <PageHeader
        title="原価管理（デリバリー原価・粗利）"
        subtitle="原価管理が必要な案件を、計画（月別の販売・原価・粗利）から受注後の進捗・完了実績まで管理します。重要度と進行中を上位に表示します。"
        action={<span className="text-xs text-ink/45">{rows.length} 件</span>}
      />

      <Section title="">
        {viewRows.length === 0 ? (
          <div className="py-12 text-center">
            <FolderKanban size={28} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">案件管理対象の案件がまだありません。</p>
            <p className="text-xs text-ink/40 mt-1">案件詳細の「案件管理」から対象化すると、ここに表示されます。</p>
          </div>
        ) : (
          <ProjectsTable rows={viewRows} />
        )}
      </Section>
    </div>
  );
}
