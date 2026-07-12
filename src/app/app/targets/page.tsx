import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities, listMembers, listRepTargets, getLeadSources } from "@/lib/data/select";
import { getLeadMetrics } from "@/lib/data/leads";
import { PageHeader, Section } from "@/components/ui/primitives";
import { saveTargetsAction, saveRepTargetsAction } from "@/server/actions";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { actualByMonth } from "@/lib/targets";
import { monthKey, startOfMonth, formatYen } from "@/lib/utils";
import { MoneyInput } from "@/components/ui/money-input";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { AllocationEditor } from "@/components/targets/allocation-editor";
import { getAllocations } from "@/lib/data/target-allocations";

const MGMT_ROLES = ["owner", "admin", "sales_manager"];

export default async function TargetsPage({ searchParams }: { searchParams: { fy?: string; ok?: string; scope?: string; month?: string; saved?: string; error?: string } }) {
  const ws = await getWorkspaceLite();
  const isMgmt = MGMT_ROLES.includes(ws.ctx.role);
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
        {isMgmt && (
          <Link href={`/app/targets?fy=${fy}&scope=alloc`} className={`pill border ${scope === "alloc" ? "bg-accent-orange text-white border-accent-orange" : "bg-white text-accent-orange border-accent-orange/30"}`}>担当・流入元へ配分</Link>
        )}
        {members.map((m) => (
          <Link key={m.user.id} href={`/app/targets?fy=${fy}&scope=${m.user.id}`} className={`pill border ${selectedUser === m.user.id ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10"}`}>
            {m.user.name}
          </Link>
        ))}
      </div>

      {searchParams.ok && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">目標を保存しました（{fiscalYearLabel(fy)}）。</p>
      )}
      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ alloc: "配分を保存しました。担当分は営業マン別週報の目標に反映されています。" }}
        errorMessages={{
          invalid_month: "月の指定が不正で保存できませんでした。",
          forbidden: "配分の設定は管理者・営業マネージャーのみ可能です。",
          save_failed: "配分の保存に失敗しました。もう一度お試しください。",
          rep_reflect_failed: "配分は保存しましたが、週報目標への反映に失敗しました。",
        }}
      />

      {scope === "alloc" && isMgmt ? (
        <AllocationSection ws={ws} fy={fy} months={months} month={searchParams.month} />
      ) : repMode && selectedUser ? (
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

async function AllTargetForm({ ws, fy, months }: { ws: Awaited<ReturnType<typeof getWorkspaceLite>>; fy: number; months: ReturnType<typeof fiscalMonths> }) {
  const targets = getSalesTargets(ws);
  const targetMap = new Map(targets.map((t) => [t.target_month, t]));
  const opps = listOpportunities(ws);
  const actuals = actualByMonth(opps, (await getLeadMetrics(opps)).byMonth);

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
                      <MoneyInput name={`m_${m.key}_amount`} defaultValue={t?.target_amount ?? ""} />
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
        <div className="mt-4"><SubmitButton className="btn-primary" pendingLabel="保存中…">全社の目標を保存</SubmitButton></div>
      </form>
    </Section>
  );
}

function RepTargetForm({ ws, fy, months, userId, userName }: { ws: Awaited<ReturnType<typeof getWorkspaceLite>>; fy: number; months: ReturnType<typeof fiscalMonths>; userId: string; userName: string }) {
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
                    <MoneyInput name={`m_${m.key}_amount`} defaultValue={repTargetMap.get(m.key) ?? ""} />
                    <div className="text-[10px] text-ink/40 text-right mt-0.5">実績 {formatYen(repRev.get(m.key) ?? 0)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4"><SubmitButton className="btn-primary" pendingLabel="保存中…">{userName} の目標を保存</SubmitButton></div>
      </form>
    </Section>
  );
}

/** 全社の月間目標を担当×流入元に配分(担当分は rep_targets→週報目標へ反映)。管理ロールのみ。 */
async function AllocationSection({ ws, fy, months, month }: { ws: Awaited<ReturnType<typeof getWorkspaceLite>>; fy: number; months: ReturnType<typeof fiscalMonths>; month?: string }) {
  const targetMap = new Map(getSalesTargets(ws).map((t) => [t.target_month, t]));
  const thisKey = monthKey(startOfMonth(new Date()));
  const sel = month && months.some((m) => m.key === month) ? month : months.some((m) => m.key === thisKey) ? thisKey : months[0].key;
  const selMonth = months.find((m) => m.key === sel);
  const companyTarget = targetMap.get(sel)?.target_amount ?? 0;
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const sources = getLeadSources(ws).map((s) => ({ id: s.id, name: s.name }));
  const initial = await getAllocations(sel);

  return (
    <Section
      title="担当・流入元への目標配分"
      action={
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="fy" value={fy} />
          <input type="hidden" name="scope" value="alloc" />
          <select name="month" defaultValue={sel} className="rounded-lg border border-black/10 px-2 py-1 text-sm">
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.year}年{m.month}月</option>
            ))}
          </select>
          <button type="submit" className="btn-ghost text-xs">表示</button>
        </form>
      }
    >
      <AllocationEditor
        month={sel}
        monthLabel={`${selMonth?.year}年${selMonth?.month}月`}
        fy={fy}
        companyTarget={companyTarget}
        members={members}
        sources={sources}
        initial={initial}
      />
    </Section>
  );
}
