import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { STAGE_MAP } from "@/lib/constants";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface StageStat { stage: string; n: number; avg_days: number; med_days: number; }
interface YomiDwell { yomi: string; n: number; avg_days: number; max_days: number; }
interface OpenDwell {
  id: string; name: string; account_name: string | null; yomi: string | null; stage: string;
  amount: number; next_action_date: string | null; owner_name: string; days_in_stage: number;
}
interface DwellStats {
  stages: StageStat[];
  yomi: YomiDwell[];
  open_dwell: OpenDwell[];
  lead_time: { n: number; avg_days: number | null; med_days: number | null } | null;
}

/** C-5 ステージ滞留分析: どのヨミ/ステージで何日滞留しているか、放置案件はどれか。 */
export default async function StageFlowPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("stage_dwell_stats");
  const stats = (data ?? { stages: [], yomi: [], open_dwell: [], lead_time: null }) as unknown as DwellStats;
  const leadTime = stats.lead_time;

  return (
    <div>
      <PageHeader
        title="ステージ滞留分析"
        subtitle="ヨミ・ステージごとの滞留日数からボトルネックと放置案件を特定します（stage_histories 実データ）。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card>
          <div className="text-xs text-ink/50">受注リードタイム(平均)</div>
          <div className="stat-value mt-1">
            {leadTime && leadTime.n > 0 ? leadTime.avg_days : "—"}
            {leadTime && leadTime.n > 0 && <span className="stat-unit">日</span>}
          </div>
          <div className="text-xs text-ink/40 mt-0.5">{leadTime && leadTime.n > 0 ? `中央値 ${leadTime.med_days}日 ・ n=${leadTime.n}` : "案件作成日ベースのデータ蓄積中"}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink/50">進行中で最長の滞留</div>
          <div className="stat-value mt-1">{stats.open_dwell[0]?.days_in_stage ?? "—"}{stats.open_dwell.length > 0 && <span className="stat-unit">日</span>}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink/50">滞留30日以上(上位30内)</div>
          <div className="stat-value mt-1">{stats.open_dwell.filter((d) => d.days_in_stage >= 30).length}<span className="stat-unit">件</span></div>
        </Card>
        <Card>
          <div className="text-xs text-ink/50">ステージ変更の記録</div>
          <div className="stat-value mt-1">{stats.stages.reduce((a, s) => a + s.n, 0)}<span className="stat-unit">区間</span></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="ヨミ別の現在滞留（進行中案件）">
          {stats.yomi.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">進行中の案件がありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink/40 text-left"><th className="pb-1.5">ヨミ</th><th className="pb-1.5 text-right">件数</th><th className="pb-1.5 text-right">平均滞留</th><th className="pb-1.5 text-right">最長</th></tr></thead>
              <tbody>
                {stats.yomi.map((y) => (
                  <tr key={y.yomi} className="border-t border-black/[0.04]">
                    <td className="py-1.5">{y.yomi}</td>
                    <td className="py-1.5 text-right tabular-nums">{y.n}</td>
                    <td className="py-1.5 text-right tabular-nums">{y.avg_days}日</td>
                    <td className="py-1.5 text-right tabular-nums">{y.max_days}日</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-ink/35 mt-2">滞留 = 最後のステージ変更(なければ案件作成)からの経過日数。</p>
        </Section>

        <Section title="ステージ別の平均通過日数（完了した区間）">
          {stats.stages.length === 0 ? (
            <p className="text-sm text-ink/40 py-4 text-center">
              ステージ変更の履歴がまだ少ないため集計できません。運用が進むと「どのステージで詰まるか」が見えるようになります。
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink/40 text-left"><th className="pb-1.5">ステージ</th><th className="pb-1.5 text-right">区間数</th><th className="pb-1.5 text-right">平均</th><th className="pb-1.5 text-right">中央値</th></tr></thead>
              <tbody>
                {stats.stages.sort((a, b) => b.avg_days - a.avg_days).map((s) => (
                  <tr key={s.stage} className="border-t border-black/[0.04]">
                    <td className="py-1.5">{STAGE_MAP[s.stage]?.label ?? s.stage}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.n}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.avg_days}日</td>
                    <td className="py-1.5 text-right tabular-nums">{s.med_days}日</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <Section title="滞留が長い進行中案件（上位30）" className="mt-5">
        {stats.open_dwell.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">進行中の案件がありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink/40 text-left">
                <th className="pb-1.5">案件</th><th className="pb-1.5">ヨミ</th><th className="pb-1.5 text-right">金額</th>
                <th className="pb-1.5">担当</th><th className="pb-1.5">次回AC</th><th className="pb-1.5 text-right">滞留</th>
              </tr>
            </thead>
            <tbody>
              {stats.open_dwell.map((d) => (
                <tr key={d.id} className="border-t border-black/[0.04]">
                  <td className="py-1.5 max-w-[280px]">
                    <Link href={`/app/opportunities/${d.id}`} className="hover:text-teal-deep hover:underline block truncate">
                      {d.account_name ? `${d.account_name}｜` : ""}{d.name}
                    </Link>
                  </td>
                  <td className="py-1.5 text-xs text-ink/60">{d.yomi ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatYen(d.amount)}</td>
                  <td className="py-1.5 text-xs text-ink/60">{d.owner_name}</td>
                  <td className="py-1.5 text-xs">{d.next_action_date ?? <span className="text-rose-500">未設定</span>}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${d.days_in_stage >= 30 ? "text-rose-600" : "text-ink/80"}`}>{d.days_in_stage}日</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
