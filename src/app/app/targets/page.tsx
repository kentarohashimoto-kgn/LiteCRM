import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities, listLeads } from "@/lib/data/select";
import { PageHeader, Section } from "@/components/ui/primitives";
import { saveTargetsAction } from "@/server/actions";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { actualByMonth } from "@/lib/targets";
import { formatYen } from "@/lib/utils";

export default async function TargetsPage({ searchParams }: { searchParams: { fy?: string; ok?: string } }) {
  const ws = await getWorkspace();
  const cur = currentFiscalStartYear();
  const fy = searchParams.fy ? parseInt(searchParams.fy, 10) : cur;
  const months = fiscalMonths(fy);
  const targets = getSalesTargets(ws);
  const targetMap = new Map(targets.map((t) => [t.target_month, t]));
  const actuals = actualByMonth(listOpportunities(ws), listLeads(ws));

  const fyOptions = [cur - 1, cur, cur + 1];

  return (
    <div>
      <PageHeader
        title="目標入力"
        subtitle="売上・成約・アポ・リードの月別目標を年度単位で設定します（決算6月＝7月始まり）。"
        action={
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            {fyOptions.map((y) => (
              <Link
                key={y}
                href={`/app/targets?fy=${y}`}
                className={`rounded-lg px-3 py-1.5 font-medium ${y === fy ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}
              >
                {fiscalYearLabel(y)}
              </Link>
            ))}
          </div>
        }
      />

      {searchParams.ok && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">目標を保存しました（{fiscalYearLabel(fy)}）。</p>
      )}

      <Section title={`${fiscalYearLabel(fy)} の月別目標`} action={<span className="text-xs text-ink/40">下段は実績（参考）</span>}>
        <form action={saveTargetsAction}>
          <input type="hidden" name="fy" value={fy} />
          <input type="hidden" name="months" value={months.map((m) => m.key).join(",")} />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">月</th>
                  <th className="th text-right">売上目標(円)</th>
                  <th className="th text-right">成約目標(件)</th>
                  <th className="th text-right">アポ目標(件)</th>
                  <th className="th text-right">リード目標(件)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {months.map((m) => {
                  const t = targetMap.get(m.key);
                  const a = actuals.get(m.key);
                  return (
                    <tr key={m.key} className="row-hover align-top">
                      <td className="td font-medium whitespace-nowrap">
                        {m.year}年{m.month}月
                      </td>
                      <td className="td">
                        <input name={`m_${m.key}_amount`} type="number" defaultValue={t?.target_amount || ""} className="input text-right" placeholder="0" />
                        <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {formatYen(a?.revenue ?? 0)}</div>
                      </td>
                      <td className="td">
                        <input name={`m_${m.key}_deals`} type="number" defaultValue={t?.target_deals || ""} className="input text-right" placeholder="0" />
                        <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {a?.deals ?? 0}</div>
                      </td>
                      <td className="td">
                        <input name={`m_${m.key}_appts`} type="number" defaultValue={t?.target_appointments || ""} className="input text-right" placeholder="0" />
                        <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {a?.appts ?? 0}</div>
                      </td>
                      <td className="td">
                        <input name={`m_${m.key}_leads`} type="number" defaultValue={t?.target_leads || ""} className="input text-right" placeholder="0" />
                        <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {a?.leads ?? 0}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <button type="submit" className="btn-primary">{fiscalYearLabel(fy)} の目標を保存</button>
          </div>
        </form>
      </Section>

      <p className="text-xs text-ink/40 mt-3">
        ※ 実績は参考表示です（売上・成約=受注日、アポ=初回商談日、リード=リード獲得日）。
        目標と実績の対比は<Link href="/app/forecast" className="text-teal-primary hover:underline">売上予測</Link>・ダッシュボードに反映されます。
      </p>
    </div>
  );
}
