import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listSrankAccounts } from "@/lib/data/srank";
import { designateSrankAction } from "@/server/actions";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { SRANK_STAGE_MAP } from "@/lib/srank";
import { formatYen, formatDateFull } from "@/lib/utils";

export default async function SrankPage() {
  const ws = await getWorkspaceLite();
  const rows = await listSrankAccounts();
  const totalTarget = rows.reduce((s, r) => s + (r.target_sales ?? 0), 0);
  const totalWon = rows.reduce((s, r) => s + r.wonAmount, 0);
  const totalPipeline = rows.reduce((s, r) => s + Math.max(r.openAmount, r.deptAmount), 0);
  const execContact = rows.filter((r) => r.exec_contact).length;

  return (
    <div>
      <PageHeader title="Sランク顧客攻略" subtitle="大手・中堅大手を会社単位で攻略。部署別・キーマン別に横展開し、年間1,000万円以上の重点取引先へ育てます。" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">Sランク顧客</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">今年度目標(合計)</div><div className="text-xl font-bold mt-1 stat-accent">{formatYen(totalTarget)}</div></Card>
        <Card><div className="text-xs text-ink/50">受注額(合計)</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(totalWon)}</div></Card>
        <Card><div className="text-xs text-ink/50">見込み額(合計)</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(totalPipeline)}</div></Card>
        <Card><div className="text-xs text-ink/50">経営層接点あり</div><div className="text-2xl font-bold mt-1">{execContact}<span className="text-sm text-ink/40">/{rows.length}</span></div></Card>
      </div>

      <Section title="Sランク顧客を指定" className="mb-5">
        <form action={designateSrankAction} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select name="account_id" className="input"><option value="">既存顧客から選択</option>{ws.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input name="company_name" placeholder="または会社名を直接入力" className="input" />
          <input name="target_sales" type="number" placeholder="今年度目標売上(円)" className="input" />
          <input name="revenue_potential" type="number" placeholder="年間売上ポテンシャル(円)" className="input" />
          <input name="srank_reason" placeholder="Sランク指定理由(大型化/横展開/戦略実績化 等)" className="input md:col-span-3" />
          <button type="submit" className="btn-primary">Sランク指定</button>
        </form>
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">企業</th><th className="th">攻略ステージ</th><th className="th text-right">今年度目標</th>
              <th className="th text-right">受注/見込み</th><th className="th text-center">部署</th><th className="th text-center">キーマン</th>
              <th className="th text-center">経営層</th><th className="th">アラート</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td font-medium max-w-[220px] truncate"><Link href={`/app/srank/${r.id}`} className="hover:text-teal-deep">{r.company_name}</Link></td>
                <td className="td text-xs whitespace-nowrap"><span className="pill bg-teal-light text-teal-deep">{r.stage}</span> {SRANK_STAGE_MAP[r.stage]?.label ?? ""}</td>
                <td className="td text-right tabular-nums">{formatYen(r.target_sales ?? 0)}</td>
                <td className="td text-right tabular-nums text-xs">{formatYen(r.wonAmount)}<span className="block text-ink/40">見込 {formatYen(Math.max(r.openAmount, r.deptAmount))}</span></td>
                <td className="td text-center tabular-nums">{r.deptCount}</td>
                <td className="td text-center tabular-nums">{r.keypersonCount}</td>
                <td className="td text-center">{r.exec_contact ? "○" : <span className="text-rose-400">—</span>}</td>
                <td className="td">{r.alerts.length ? <div className="flex flex-wrap gap-1">{r.alerts.map((a) => <span key={a} className="pill bg-rose-50 text-rose-500 text-[10px]">{a}</span>)}</div> : <span className="text-ink/30 text-xs">—</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="td text-center text-ink/40 py-8">Sランク顧客が未登録です。上で指定してください。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/40 mt-3">※ 受注/見込みは既存案件(opportunities)を会社で集計。{formatDateFull(new Date().toISOString())} 時点。詳細の攻略計画は企業名から開けます。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
