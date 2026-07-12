import { getMembersLite } from "@/lib/data/workspace";
import { getKpiReview, weekRange, weeksInMonth, parsePeriod } from "@/lib/data/exec";
import { saveKpiTargetsAction, saveKpiActualAction, saveWeeklyReviewAction, createMtgActionAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { PeriodSelect } from "@/components/exec/period-select";
import { SALES_KPIS, KPI_LABEL, KPI_UNIT, EVALUATION_META, ACTION_STATUS } from "@/lib/exec-review";
import { formatYen } from "@/lib/utils";

function fv(v: number, unit: "count" | "yen") { return unit === "yen" ? formatYen(v) : `${Math.round(v).toLocaleString("ja-JP")}件`; }
function pct(v: number | null) { return v == null ? "—" : `${Math.round(v * 100)}%`; }

export default async function ExecKpiPage({ searchParams }: { searchParams: { month?: string; week?: string } }) {
  const { month, week } = parsePeriod(searchParams);
  // メンバー名しか使わないため lite(≈800KB) ではなく軽量フェッチャで取得(監査2026-07-12)
  const [membersRaw, rows] = await Promise.all([getMembersLite(), getKpiReview(month, week)]);
  const members = membersRaw.map(({ user }) => user);
  const range = weekRange(month, week);

  return (
    <div>
      <PageHeader
        title="営業KPI振り返り"
        subtitle={`目標と既存DB実績の予実差を自動集計し、Good/Watch/Bad判定・考察・対策まで。対象: ${range.start}〜${range.end}`}
        action={<PeriodSelect month={month} week={week} weeks={weeksInMonth(month)} basePath="/app/exec/kpi" />}
      />

      {/* KPI目標(月間・週次)の登録 */}
      <Section title="KPI目標（月間・週次）" className="mb-5" action={<span className="text-xs text-ink/40">対象週の目標を保存</span>}>
        <form action={saveKpiTargetsAction} className="overflow-x-auto">
          <input type="hidden" name="target_month" value={month} />
          <input type="hidden" name="target_week" value={week} />
          <table className="w-full text-sm">
            <thead className="text-ink/40 text-xs"><tr><th className="th">KPI</th><th className="th">月間目標</th><th className="th">週次目標（第{week}週）</th></tr></thead>
            <tbody className="divide-y divide-black/[0.04]">
              {SALES_KPIS.map((k) => {
                const r = rows.find((x) => x.kpiType === k.key);
                return (
                  <tr key={k.key}>
                    <td className="td font-medium">{k.label}{k.unit === "yen" && <span className="text-[10px] text-ink/40 ml-1">(円)</span>}</td>
                    <td className="td"><input name={`m_${k.key}`} type="number" defaultValue={r?.monthlyTarget || ""} className="input py-1 w-36" /></td>
                    <td className="td"><input name={`w_${k.key}`} type="number" defaultValue={r?.weeklyTarget || ""} className="input py-1 w-36" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="submit" className="btn-primary mt-3">目標を保存</button>
        </form>
      </Section>

      {/* KPIごとの予実・判定・考察・振り返り */}
      <div className="space-y-4">
        {rows.map((r) => {
          const unit = KPI_UNIT[r.kpiType];
          const m = EVALUATION_META[r.judge.evaluation];
          return (
            <div key={r.kpiType} className="card card-pad">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className={`pill text-sm font-bold ${m.color}`}>{m.label}</span>
                  <h3 className="text-base font-semibold">{KPI_LABEL[r.kpiType]}</h3>
                </div>
                <div className="text-xs text-ink/40">実績ソース: {r.actualSource === "manual" ? "手動補正" : "自動集計(既存DB)"}</div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3 text-sm">
                <Stat label="週次目標" v={fv(r.weeklyTarget, unit)} />
                <Stat label="週次実績" v={fv(r.actual, unit)} accent />
                <Stat label="予実差" v={`${r.judge.diff >= 0 ? "+" : ""}${fv(r.judge.diff, unit)}`} />
                <Stat label="達成率" v={pct(r.judge.achieveRate)} />
                <Stat label="月間進捗" v={`${pct(r.judge.monthlyProgress)}`} sub={`累計 ${fv(r.monthlyActual, unit)}`} />
                <Stat label="残ペース/週" v={r.judge.remainingPace != null ? fv(r.judge.remainingPace, unit) : "—"} sub={`残${fv(r.judge.remaining, unit)}・${r.remainingWeeks}週`} />
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-teal-deep">システム考察を見る</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-ink/70 bg-mist-soft/50 rounded-lg p-3 font-sans">{r.systemComment}</pre>
              </details>

              {!r.target ? (
                <p className="mt-3 text-xs text-accent-orange">※ この週のKPI目標が未登録です。上の「KPI目標」を保存すると、振り返り・対策を入力できます。</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 人間の振り返り */}
                  <form action={saveWeeklyReviewAction} className="space-y-2 border-t border-black/[0.05] pt-3">
                    <input type="hidden" name="target_id" value={r.target.id} />
                    <input type="hidden" name="evaluation" value={r.judge.evaluation} />
                    <input type="hidden" name="system_comment" value={r.systemComment} />
                    <div className="text-xs font-semibold text-ink/60">人間の振り返り</div>
                    <textarea name="human_comment" defaultValue={r.review?.human_comment ?? ""} rows={2} placeholder="所感" className="input text-sm" />
                    <textarea name="root_cause" defaultValue={r.review?.root_cause ?? ""} rows={2} placeholder="真因" className="input text-sm" />
                    <textarea name="countermeasure" defaultValue={r.review?.countermeasure ?? ""} rows={2} placeholder="対策" className="input text-sm" />
                    <div className="grid grid-cols-3 gap-2">
                      <select name="owner_user_id" defaultValue={r.review?.owner_user_id ?? ""} className="input text-xs"><option value="">担当者</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                      <input name="due_date" type="date" defaultValue={r.review?.due_date ?? ""} className="input text-xs" />
                      <select name="status" defaultValue={r.review?.status ?? "open"} className="input text-xs">{ACTION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                    </div>
                    <input name="next_check_point" defaultValue={r.review?.next_check_point ?? ""} placeholder="次回MTGで確認すること" className="input text-sm" />
                    <input name="result_comment" defaultValue={r.review?.result_comment ?? ""} placeholder="実行結果（翌週入力）" className="input text-sm" />
                    <button type="submit" className="btn-accent text-sm">振り返りを保存</button>
                  </form>

                  {/* アクション化 */}
                  <form action={createMtgActionAction} className="space-y-2 border-t border-black/[0.05] pt-3">
                    <input type="hidden" name="department" value="sales" />
                    <input type="hidden" name="related_type" value="kpi" />
                    <input type="hidden" name="related_id" value={r.target.id} />
                    <div className="text-xs font-semibold text-ink/60">アクション化（MTGで決定）</div>
                    <input name="title" placeholder="アクション名" className="input text-sm" />
                    <textarea name="description" rows={2} placeholder="内容" className="input text-sm" />
                    <div className="grid grid-cols-3 gap-2">
                      <select name="owner_user_id" className="input text-xs"><option value="">担当者</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                      <input name="due_date" type="date" className="input text-xs" />
                      <select name="priority" defaultValue="high" className="input text-xs"><option value="high">High</option><option value="middle">Middle</option><option value="low">Low</option></select>
                    </div>
                    <button type="submit" className="btn-ghost text-sm">アクションを作成</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink/40 mt-4">※ 実績は既存DB（リード=獲得日・アポ=初回商談日・成約/金額=受注日）から自動集計。手動補正が必要な場合は各KPIで上書きできます（Phase2で補正UIを追加）。</p>
    </div>
  );
}

function Stat({ label, v, sub, accent }: { label: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-ink/45">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent ? "stat-accent" : ""}`}>{v}</div>
      {sub && <div className="text-[10px] text-ink/40">{sub}</div>}
    </div>
  );
}

export const dynamic = "force-dynamic";
