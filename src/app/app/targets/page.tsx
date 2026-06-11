import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities, listLeads, listMembers, listRepTargets } from "@/lib/data/select";
import { PageHeader, Section } from "@/components/ui/primitives";
import { saveTargetsAction, saveRepTargetsAction } from "@/server/actions";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { actualByMonth } from "@/lib/targets";
import { monthKey, startOfMonth, formatYen } from "@/lib/utils";

export default async function TargetsPage({ searchParams }: { searchParams: { fy?: string; ok?: string; scope?: string } }) {
  const ws = await getWorkspace();
  const cur = currentFiscalStartYear();
  const fy = searchParams.fy ? parseInt(searchParams.fy, 10) : cur;
  const months = fiscalMonths(fy);
  const fyOptions = [cur - 1, cur, cur + 1];

  const members = listMembers(ws);
  const memberIds = new Set(members.map((m) => m.user.id));
  const scope = searchParams.scope ?? "all";
  const repMode = memberIds.has(scope) || scope === "rep";
  const selectedUser = memberIds.has(scope) ? scope : repMode ? (memberIds.has(ws.ctx.userId) ? ws.ctx.userId : members[0]?.user.id) : null;

  return (
    <div>
      <PageHeader
        title="目標入力"
        subtitle="売上・成約・アポ・リードの月別目標を年度単位で設定（決算6月＝7月始まり）。営業マン別の月別売上目標も設定できます。"
        action={
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            {fyOptions.map((y) => (
              <Link key={y} href={`/app/targets?fy=${y}&scope=${scope}`} className={`rounded-lg px-3 py-1.5 font-medium ${y === fy ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}>
                {fiscalYearLabel(y)}
              </Link>
            ))}
          </div>
        }
      />

      {/* スコープ切替: 全社 / 各営業マン */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Link href={`/app/targets?fy=${fy}&scope=all`} className={`pill border ${scope === "all" ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10"}`}>全社</Link>
        {members.map((m) => (
          <Link key={m.user.id} href={`/app/targets?fy=${fy}&scope=${m.user.id}`} className={`pill border ${selectedUser === m.user.id ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10"}`}>
            {m.user.name}
          </Link>
        ))}
      </div>

      {searchParams.ok && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">目標を保存しました（{fiscalYearLabel(fy)}）。</p>
      )}

      {repMode && selectedUser ? (
        <RepTargetForm ws={ws} fy={fy} months={months} userId={selectedUser} userName={members.find((m) => m.user.id === selectedUser)?.user.name ?? ""} />
      ) : (
        <AllTargetForm ws={ws} fy={fy} months={months} />
      )}

      <p className="text-xs text-ink/40 mt-3">
        ※ 実績は参考表示（売上・成約=受注日、アポ=初回商談日、リード=リード獲得日）。
        対比は<Link href="/app/forecast" className="text-teal-primary hover:underline">売上予測</Link>・<Link href="/app/analytics/sales-reps" className="text-teal-primary hover:underline">営業マン別分析</Link>に反映されます。
      </p>
    </div>
  );
}

function AllTargetForm({ ws, fy, months }: { ws: Awaited<ReturnType<typeof getWorkspace>>; fy: number; months: ReturnType<typeof fiscalMonths> }) {
  const targets = getSalesTargets(ws);
  const targetMap = new Map(targets.map((t) => [t.target_month, t]));
  const actuals = actualByMonth(listOpportunities(ws), listLeads(ws));

  return (
    <Section title={`全社 ${fiscalYearLabel(fy)} の月別目標`} action={<span className="text-xs text-ink/40">下段は実績（参考）</span>}>
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
                    <td className="td font-medium whitespace-nowrap">{m.year}年{m.month}月</td>
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
        <div className="mt-4"><button type="submit" className="btn-primary">全社の目標を保存</button></div>
      </form>
    </Section>
  );
}

function RepTargetForm({ ws, fy, months, userId, userName }: { ws: Awaited<ReturnType<typeof getWorkspace>>; fy: number; months: ReturnType<typeof fiscalMonths>; userId: string; userName: string }) {
  const repTargetMap = new Map(listRepTargets(ws).filter((t) => t.user_id === userId).map((t) => [t.target_month, t.target_amount]));
  // この営業マンの月別受注実績
  const repRev = new Map<string, number>();
  for (const o of listOpportunities(ws)) {
    if (o.owner_user_id !== userId || o.status !== "won" || !o.amount) continue;
    const ref = o.expected_close_date || o.expected_revenue_month;
    if (!ref) continue;
    const mk = monthKey(startOfMonth(new Date(ref)));
    repRev.set(mk, (repRev.get(mk) ?? 0) + o.amount);
  }

  return (
    <Section title={`${userName} ${fiscalYearLabel(fy)} の月別売上目標`} action={<span className="text-xs text-ink/40">下段は受注実績（参考）</span>}>
      <form action={saveRepTargetsAction}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="fy" value={fy} />
        <input type="hidden" name="months" value={months.map((m) => m.key).join(",")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-black/[0.06]">
              <tr>
                <th className="th">月</th>
                <th className="th text-right">売上目標(円)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {months.map((m) => (
                <tr key={m.key} className="row-hover">
                  <td className="td font-medium whitespace-nowrap">{m.year}年{m.month}月</td>
                  <td className="td">
                    <input name={`m_${m.key}_amount`} type="number" defaultValue={repTargetMap.get(m.key) || ""} className="input text-right" placeholder="0" />
                    <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {formatYen(repRev.get(m.key) ?? 0)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4"><button type="submit" className="btn-primary">{userName} の目標を保存</button></div>
      </form>
    </Section>
  );
}
