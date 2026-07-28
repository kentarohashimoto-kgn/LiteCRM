import { FolderKanban } from "lucide-react";
import { Card, EmptyState, LinkButton, Section } from "@/components/ui/primitives";
import { listManagedProjects } from "@/lib/data/projects";
import { formatYen, formatPercent, cn } from "@/lib/utils";

/**
 * 原価管理ガジェット: 進行中プロジェクトの売上・原価・粗利のミニ一覧。
 * 利用可否は PROJECT_ROLES(マイページ側の gadgetsFor)で制御される。
 */
export async function ProjectsGadget() {
  let rows: Awaited<ReturnType<typeof listManagedProjects>> = [];
  try {
    rows = await listManagedProjects();
  } catch {
    return (
      <Section title="原価管理" icon={<FolderKanban size={16} />}>
        <Card className="p-4"><EmptyState message="原価管理データを取得できませんでした" /></Card>
      </Section>
    );
  }

  const active = rows.filter((r) => r.isActive);
  const shown = (active.length > 0 ? active : rows)
    .map((r) => ({
      id: r.opportunityId,
      name: r.oppName,
      account: r.accountName,
      totals: r.computed?.roll.totals ?? null,
    }))
    .sort((a, b) => (b.totals?.revenue ?? 0) - (a.totals?.revenue ?? 0))
    .slice(0, 6);

  return (
    <Section
      title="原価管理"
      icon={<FolderKanban size={16} />}
      action={<LinkButton href="/app/projects" variant="ghost">原価管理へ</LinkButton>}
    >
      <Card className="p-0 overflow-x-auto">
        {shown.length === 0 ? (
          <div className="p-4"><EmptyState message="管理対象のプロジェクトがありません" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
                <th className="px-3 py-2 font-medium">案件</th>
                <th className="px-3 py-2 font-medium text-right">売上</th>
                <th className="px-3 py-2 font-medium text-right">原価</th>
                <th className="px-3 py-2 font-medium text-right">粗利</th>
                <th className="px-3 py-2 font-medium text-right">粗利率</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 min-w-0">
                    <a href={`/app/projects/${p.id}`} className="block">
                      <span className="block font-medium text-slate-700 truncate max-w-[220px]">{p.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate max-w-[220px]">{p.account}</span>
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{p.totals ? formatYen(p.totals.revenue) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{p.totals ? formatYen(p.totals.cost) : "—"}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium", (p.totals?.gross ?? 0) < 0 ? "text-rose-600" : "text-teal-700")}>
                    {p.totals ? formatYen(p.totals.gross) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">
                    {p.totals ? formatPercent(p.totals.grossRate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}
