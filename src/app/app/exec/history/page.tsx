import { getWorkspaceLite } from "@/lib/data/workspace";
import { getUser } from "@/lib/data/select";
import { listWeeklyReviews } from "@/lib/data/exec";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { EVALUATION_META, KPI_LABEL, STATUS_LABEL } from "@/lib/exec-review";
import { formatDateFull } from "@/lib/utils";
import type { WeeklyKpiTarget } from "@/lib/types";

export default async function ExecHistoryPage() {
  const ws = await getWorkspaceLite();
  const reviews = await listWeeklyReviews();
  const sb = getSupabaseServer();
  const { data: tData } = await sb.from("weekly_kpi_targets").select("id,kpi_type,target_month,target_week");
  const targetMap = new Map((tData ?? []).map((t) => [(t as WeeklyKpiTarget).id, t as WeeklyKpiTarget]));

  return (
    <div>
      <PageHeader title="振り返り履歴" subtitle="週次の判定・所感・真因・対策・実行結果の履歴。改善活動の蓄積を確認します。" />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr><th className="th">対象</th><th className="th">判定</th><th className="th">所感 / 真因</th><th className="th">対策</th><th className="th">担当・期限</th><th className="th">状態 / 結果</th><th className="th">更新</th></tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {reviews.map((r) => {
              const t = r.target_id ? targetMap.get(r.target_id) : undefined;
              const m = r.evaluation ? EVALUATION_META[r.evaluation as keyof typeof EVALUATION_META] : null;
              return (
                <tr key={r.id} className="row-hover align-top">
                  <td className="td text-xs whitespace-nowrap">{t ? `${(t.target_month ?? "").slice(0, 7)} 第${t.target_week}週` : "—"}<div className="font-medium text-ink">{t ? KPI_LABEL[t.kpi_type] ?? t.kpi_type : "—"}</div></td>
                  <td className="td">{m ? <span className={`pill text-[10px] font-bold ${m.color}`}>{m.label}</span> : "—"}</td>
                  <td className="td text-xs max-w-[240px]">{r.human_comment && <div className="text-ink/70">{r.human_comment}</div>}{r.root_cause && <div className="text-ink/45 mt-0.5">真因: {r.root_cause}</div>}</td>
                  <td className="td text-xs max-w-[200px] text-ink/70">{r.countermeasure || "—"}</td>
                  <td className="td text-xs whitespace-nowrap">{r.owner_user_id ? getUser(ws, r.owner_user_id)?.name ?? "—" : "—"}<div className="text-ink/45">{formatDateFull(r.due_date)}</div></td>
                  <td className="td text-xs">{STATUS_LABEL[r.status] ?? r.status}{r.result_comment && <div className="text-emerald-700 mt-0.5">{r.result_comment}</div>}</td>
                  <td className="td text-xs text-ink/40 whitespace-nowrap">{formatDateFull(r.updated_at)}</td>
                </tr>
              );
            })}
            {reviews.length === 0 && <tr><td colSpan={7} className="td text-center text-ink/40 py-8">振り返り履歴はまだありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
