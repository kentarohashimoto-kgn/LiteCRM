import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { requireProjectCtx } from "@/lib/session";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getUser } from "@/lib/data/select";
import { listManagedProjects } from "@/lib/data/projects";
import { PageHeader, Section } from "@/components/ui/primitives";
import { formatYen, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

const VERDICT = {
  go: { label: "GO", cls: "bg-emerald-50 text-emerald-700" },
  conditional: { label: "条件付き", cls: "bg-amber-50 text-amber-700" },
  review: { label: "要協議", cls: "bg-rose-50 text-rose-600" },
} as const;
const rateCls = (r: number) => (r >= 0.4 ? "text-emerald-600" : r >= 0.25 ? "text-amber-600" : "text-rose-600");

export default async function ProjectsListPage() {
  await requireProjectCtx();
  const [rows, ws] = await Promise.all([listManagedProjects(), getWorkspaceLite()]);
  // 粗利率の低い順(危険な案件を上に)。計画未整備は末尾。
  const sorted = [...rows].sort((a, b) => {
    const ra = a.computed?.roll.totals.grossRate ?? 99;
    const rb = b.computed?.roll.totals.grossRate ?? 99;
    return ra - rb;
  });

  return (
    <div>
      <PageHeader
        title="案件管理（デリバリー原価・粗利）"
        subtitle="コンサル型・伴走・カスタム開発など、原価管理が必要な案件だけを月別の販売・原価・粗利で管理します。"
        action={<span className="text-xs text-ink/45">{rows.length} 件</span>}
      />

      <Section title="">
        {sorted.length === 0 ? (
          <div className="py-12 text-center">
            <FolderKanban size={28} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">案件管理対象の案件がまだありません。</p>
            <p className="text-xs text-ink/40 mt-1">案件詳細の「案件管理」から対象化すると、ここに表示されます。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 720 }}>
              <thead className="text-ink/40 text-xs bg-mist-soft/30">
                <tr>
                  <th className="th">顧客 / 案件</th>
                  <th className="th text-right">販売</th>
                  <th className="th text-right">原価</th>
                  <th className="th text-right">粗利</th>
                  <th className="th text-right">粗利率</th>
                  <th className="th">提案可否</th>
                  <th className="th">担当</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {sorted.map((r) => {
                  const t = r.computed?.roll.totals;
                  const v = r.computed ? VERDICT[r.computed.verdict] : null;
                  return (
                    <tr key={r.opportunityId} className="row-hover">
                      <td className="td">
                        <Link href={`/app/projects/${r.opportunityId}`} className="block">
                          <div className="font-medium text-ink/90">{r.accountName}</div>
                          <div className="text-xs text-teal-deep">{r.oppName}</div>
                        </Link>
                      </td>
                      <td className="td text-right text-ink/70">{t ? formatYen(t.revenue) : "—"}</td>
                      <td className="td text-right text-ink/70">{t ? formatYen(t.cost) : "—"}</td>
                      <td className={`td text-right font-medium ${t && t.gross < 0 ? "text-rose-600" : ""}`}>{t ? formatYen(t.gross) : "—"}</td>
                      <td className={`td text-right font-bold ${t ? rateCls(t.grossRate) : ""}`}>{t ? formatPercent(t.grossRate, 1) : "—"}</td>
                      <td className="td">{v ? <span className={`pill ${v.cls} text-[10px] font-bold`}>{v.label}</span> : <span className="text-ink/30 text-xs">未整備</span>}</td>
                      <td className="td text-ink/60 text-xs">{r.ownerUserId ? getUser(ws, r.ownerUserId)?.name ?? "—" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
