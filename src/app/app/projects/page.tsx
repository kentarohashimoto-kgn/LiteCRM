import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { requireProjectCtx } from "@/lib/session";
import { getMembersLite } from "@/lib/data/workspace";
import { listManagedProjects, listProjectCandidates } from "@/lib/data/projects";
import { listDeliveryForecasts } from "@/lib/data/forecasts";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ProjectsTable, type ProjectRow } from "@/components/projects/projects-table";
import { CandidatesTable, type CandidateView } from "@/components/projects/candidates-table";
import { UnifiedTimeline, type ConfirmedRow } from "@/components/projects/unified-timeline";
import { ProjectsViewTabs, type ProjectView } from "@/components/projects/projects-view-tabs";

export const dynamic = "force-dynamic";

export default async function ProjectsListPage({ searchParams }: { searchParams: { view?: string } }) {
  await requireProjectCtx();
  // 旧 ?view=forecast はカレンダー(統合ビュー)に集約
  const view: ProjectView =
    searchParams.view === "calendar" || searchParams.view === "forecast" ? "calendar"
    : searchParams.view === "candidates" ? "candidates"
    : "list";
  const nowMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 7);

  // 一覧に必要なのは担当者名だけなので、重いworkspace RPCではなく軽量なメンバー一覧を使う
  const [rows, candidates, forecast, members] = await Promise.all([listManagedProjects(), listProjectCandidates(), listDeliveryForecasts(), getMembersLite()]);
  const nameById = new Map(members.map((m) => [m.user.id, m.user.name]));
  const ownerName = (id: string | null) => (id ? nameById.get(id) ?? "—" : "—");

  const viewRows: ProjectRow[] = rows.map((r) => {
    const t = r.computed?.roll.totals;
    return {
      opportunityId: r.opportunityId,
      oppName: r.oppName,
      accountName: r.accountName,
      ownerName: ownerName(r.ownerUserId),
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
      approvedHours: r.approvedHours,
      approvedCost: r.approvedCost,
      leadAssignmentId: r.leadAssignmentId,
      assignees: r.assignees,
    };
  });

  const confirmedRows: ConfirmedRow[] = rows.map((r) => ({
    opportunityId: r.opportunityId,
    accountName: r.accountName,
    oppName: r.oppName,
    priority: r.priority,
    startMonth: r.startMonth,
    endMonth: r.endMonth,
    isActive: r.isActive,
    isFuture: r.isFuture,
    isPast: r.isPast,
    revenue: r.computed?.roll.totals.revenue ?? 0,
    grossRate: r.computed?.roll.totals.grossRate ?? 0,
    monthly: (r.computed?.roll.months ?? []).map((m) => ({ month: m.month, revenue: m.revenue })),
  }));
  // 見込みフォームの「紐づけ案件」選択肢(原価管理対象の案件)
  const linkOptions = rows.map((r) => ({ id: r.opportunityId, label: `${r.accountName} / ${r.oppName}` }));

  const candidateViews: CandidateView[] = candidates.map((c) => ({
    opportunityId: c.opportunityId,
    oppName: c.oppName,
    accountName: c.accountName,
    ownerName: ownerName(c.ownerUserId),
    status: c.status,
    stage: c.stage,
    amount: c.amount,
    startMonth: c.startMonth,
    endMonth: c.endMonth,
    hasPlan: c.hasPlan,
    tier: c.tier,
    reason: c.reason,
  }));
  const wonCandidates = candidates.filter((c) => c.tier === "won").length;

  return (
    <div>
      <PageHeader
        title="原価管理（デリバリー原価・粗利）"
        subtitle="原価管理が必要な案件を、計画（月別の販売・原価・粗利）から受注後の進捗・完了実績まで管理します。重要度と進行中を上位に表示します。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/projects/approvals" className="btn-ghost text-xs">稼働承認</Link>
            <span className="text-xs text-ink/45">{rows.length} 件</span>
          </div>
        }
      />

      <ProjectsViewTabs view={view} candidateCount={wonCandidates} forecastAlertCount={forecast.alerts.actionItems.length} />

      {view === "calendar" ? (
        <Section title="">
          <UnifiedTimeline
            confirmed={confirmedRows}
            forecasts={forecast.rows}
            alerts={forecast.alerts}
            nowMonth={nowMonth}
            linkOptions={linkOptions}
          />
        </Section>
      ) : view === "candidates" ? (
        <Section title="">
          <CandidatesTable rows={candidateViews} />
        </Section>
      ) : (
        <Section title="">
          {viewRows.length === 0 ? (
            <div className="py-12 text-center">
              <FolderKanban size={28} className="mx-auto text-ink/25 mb-2" />
              <p className="text-sm text-ink/50">案件管理対象の案件がまだありません。</p>
              <p className="text-xs text-ink/40 mt-1">
                「対象候補」タブ、または案件詳細の「案件管理」から対象化すると、ここに表示されます。
              </p>
            </div>
          ) : (
            <ProjectsTable rows={viewRows} />
          )}
        </Section>
      )}
    </div>
  );
}
