"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MoneyInput } from "@/components/ui/money-input";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Trophy, Layers, PencilLine, Search, Repeat } from "lucide-react";
import { YOMI_OPTIONS } from "@/lib/constants";
import { setOppForecastAction } from "@/server/actions";
import { formatYen, formatDateFull } from "@/lib/utils";

export interface WonRow {
  id: string;
  date: string | null;
  account: string;
  name: string;
  amount: number;
  owner: string;
  days: number | null;
  source: string;
  sourceDetail: string;
}

export interface PipelineRow {
  id: string;
  account: string;
  name: string;
  amount: number;
  tier: "A" | "B" | "C" | "other";
  yomiLabel: string;
  expectedClose: string | null;
  repProbability: number | null;
}

export interface InputRow {
  id: string;
  account: string;
  name: string;
  amount: number;
  expectedClose: string | null;
  repProbability: number | null;
  yomi: string;
  stageLabel: string;
}

export interface SubMonthRow {
  key: string;
  label: string;
  confirmed: number;
  openWeighted: number;
  renewalWeighted: number;
}

export interface SubOppRow {
  id: string;
  account: string;
  name: string;
  status: string;
  mrr: number;
  startMonth: string | null;
  endMonth: string | null;
  termMonths: number;
  contractedTcv: number;
  renewalUntil: string | null;
  renewalProbability: number | null;
  renewalWeightedTcv: number;
}

type Tab = "monthly" | "won" | "pipeline" | "sub" | "input";

const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: "monthly", label: "月別予測", icon: BarChart3 },
  { key: "won", label: "受注一覧", icon: Trophy },
  { key: "pipeline", label: "受注見込み", icon: Layers },
  { key: "sub", label: "継続売上", icon: Repeat },
  { key: "input", label: "予測入力", icon: PencilLine },
];

export function ForecastTabs({
  monthly,
  won,
  pipeline,
  inputs,
  subMonthly,
  subs,
}: {
  monthly: ReactNode;
  won: WonRow[];
  pipeline: PipelineRow[];
  inputs: InputRow[];
  subMonthly: SubMonthRow[];
  subs: SubOppRow[];
}) {
  const [tab, setTab] = useState<Tab>("monthly");
  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${tab === t.key ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "monthly" && monthly}
      {tab === "won" && <WonList rows={won} />}
      {tab === "pipeline" && <PipelineScenario rows={pipeline} />}
      {tab === "sub" && <SubscriptionView monthly={subMonthly} subs={subs} />}
      {tab === "input" && <ForecastInput rows={inputs} />}
    </div>
  );
}

// ============ 受注一覧 ============
function WonList({ rows }: { rows: WonRow[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const avgDays = (() => {
    const ds = rows.map((r) => r.days).filter((d): d is number => d != null);
    return ds.length ? Math.round(ds.reduce((s, d) => s + d, 0) / ds.length) : null;
  })();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm text-ink/60 px-1">
        <span>受注 <b className="text-ink">{rows.length}</b> 件</span>
        <span>受注額計 <b className="stat-accent">{formatYen(total)}</b></span>
        {avgDays != null && <span>初回商談→受注 平均 <b className="text-ink">{avgDays}</b> 日</span>}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th whitespace-nowrap">受注日</th>
              <th className="th">顧客名</th>
              <th className="th text-right">受注額</th>
              <th className="th">担当営業</th>
              <th className="th text-right">初回商談→受注</th>
              <th className="th">流入元</th>
              <th className="th">流入元詳細</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td text-xs whitespace-nowrap">{formatDateFull(r.date)}</td>
                <td className="td max-w-[220px]">
                  <Link href={`/app/opportunities/${r.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{r.account}</Link>
                  <span className="text-xs text-ink/45 truncate block">{r.name}</span>
                </td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.amount)}</td>
                <td className="td text-sm whitespace-nowrap">{r.owner || "—"}</td>
                <td className="td text-right tabular-nums">{r.days != null ? `${r.days}日` : "—"}</td>
                <td className="td text-xs">{r.source || "—"}</td>
                <td className="td text-xs text-ink/60 max-w-[160px] truncate">{r.sourceDetail || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="td text-center text-ink/40 py-8">受注はありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 受注見込み一覧(A/B/C ヨミ 試算) ============
function PipelineScenario({ rows }: { rows: PipelineRow[] }) {
  const [pa, setPa] = useState(80);
  const [pb, setPb] = useState(50);
  const [pc, setPc] = useState(30);

  const tiers = useMemo(() => {
    const mk = (tier: "A" | "B" | "C", pct: number) => {
      const list = rows.filter((r) => r.tier === tier);
      const amount = list.reduce((s, r) => s + r.amount, 0);
      return { tier, pct, count: list.length, amount, weighted: Math.round((amount * pct) / 100) };
    };
    return [mk("A", pa), mk("B", pb), mk("C", pc)];
  }, [rows, pa, pb, pc]);

  const totalAmount = tiers.reduce((s, t) => s + t.amount, 0);
  const totalWeighted = tiers.reduce((s, t) => s + t.weighted, 0);
  const other = rows.filter((r) => r.tier === "other");
  const tierColor: Record<string, string> = { A: "text-teal-deep", B: "text-amber-600", C: "text-ink/50" };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/60 px-1">
        ヨミ A / B / C の確度を入力して受注見込みを試算します（既定 A80%・B50%・C30%）。対象はオープン案件のみ。
      </p>

      {/* 試算サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiers.map((t) => (
          <div key={t.tier} className="card card-pad">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${tierColor[t.tier]}`}>{t.tier}ヨミ</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={t.pct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)));
                    if (t.tier === "A") setPa(v); else if (t.tier === "B") setPb(v); else setPc(v);
                  }}
                  className="w-14 rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs text-right outline-none focus:border-teal-primary"
                />
                <span className="text-xs text-ink/40">%</span>
              </div>
            </div>
            <div className="stat-value stat-accent mt-2">{formatYen(t.weighted)}</div>
            <div className="text-xs text-ink/40 mt-0.5">{t.count}件・満額 {formatYen(t.amount)}</div>
          </div>
        ))}
        <div className="card card-pad bg-mist-soft/50">
          <span className="text-sm font-bold text-ink">試算合計</span>
          <div className="stat-value stat-accent mt-2">{formatYen(totalWeighted)}</div>
          <div className="text-xs text-ink/40 mt-0.5">満額 {formatYen(totalAmount)}</div>
        </div>
      </div>

      {/* 明細 */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">ヨミ</th>
              <th className="th">顧客名 / 案件</th>
              <th className="th text-right">満額</th>
              <th className="th text-right">試算額</th>
              <th className="th text-right">担当者予測</th>
              <th className="th whitespace-nowrap">受注予定</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {[...rows.filter((r) => r.tier !== "other")]
              .sort((a, b) => b.amount - a.amount)
              .map((r) => {
                const pct = r.tier === "A" ? pa : r.tier === "B" ? pb : pc;
                return (
                  <tr key={r.id} className="row-hover">
                    <td className="td"><span className={`pill bg-mist-soft ${tierColor[r.tier]}`}>{r.yomiLabel}</span></td>
                    <td className="td max-w-[260px]">
                      <Link href={`/app/opportunities/${r.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{r.account}</Link>
                      <span className="text-xs text-ink/45 truncate block">{r.name}</span>
                    </td>
                    <td className="td text-right tabular-nums">{formatYen(r.amount)}</td>
                    <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(Math.round((r.amount * pct) / 100))}</td>
                    <td className="td text-right tabular-nums text-ink/60">{r.repProbability != null ? `${r.repProbability}%` : "—"}</td>
                    <td className="td text-xs whitespace-nowrap">{formatDateFull(r.expectedClose)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {other.length > 0 && (
        <p className="text-xs text-ink/40 px-1">
          ※ ヨミ A/B/C 以外のオープン案件 {other.length} 件（アポ・調整中など）は試算対象外です。「予測入力」でヨミを設定すると反映されます。
        </p>
      )}
    </div>
  );
}

// ============ 継続売上(サブスク) ============
function fmtMonth(key: string | null): string {
  if (!key) return "—";
  const [y, m] = key.split("-");
  return `${y}/${Number(m)}`;
}

function SubscriptionView({ monthly, subs }: { monthly: SubMonthRow[]; subs: SubOppRow[] }) {
  const totalConfirmed = monthly.reduce((s, m) => s + m.confirmed, 0);
  const totalOpen = monthly.reduce((s, m) => s + m.openWeighted, 0);
  const totalRenewal = monthly.reduce((s, m) => s + m.renewalWeighted, 0);
  const wonMrr = subs.filter((s) => s.status === "won").reduce((s, x) => s + x.mrr, 0);

  if (subs.length === 0) {
    return (
      <div className="card card-pad text-sm text-ink/55">
        サブスク（継続課金）案件がまだありません。案件詳細の「サブスク契約」から月額×契約期間で登録すると、ここに毎月の継続売上と更新見込みが表示されます。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/60 px-1">
        請求スケジュール(毎月)を月次展開した継続売上です。<b>契約確定</b>＝受注済の月額、<b>進行中</b>＝オープン案件の月額×受注確度、
        <b>更新見込み</b>＝契約満了の翌月〜想定継続終了月を月額×更新確度で加重。
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card card-pad"><div className="text-xs text-ink/50">受注済MRR(月額計)</div><div className="stat-value stat-accent mt-1">{formatYen(wonMrr)}</div></div>
        <div className="card card-pad"><div className="text-xs text-ink/50">契約確定(年度計)</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(totalConfirmed)}</div></div>
        <div className="card card-pad"><div className="text-xs text-ink/50">進行中(加重)</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(totalOpen)}</div></div>
        <div className="card card-pad"><div className="text-xs text-ink/50">更新見込み(加重)</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(totalRenewal)}</div></div>
      </div>

      {/* 月次ロールフォワード */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]"><h2 className="section-title">月次 継続売上</h2></div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">月</th>
              <th className="th text-right">契約確定</th>
              <th className="th text-right">進行中(加重)</th>
              <th className="th text-right">更新見込み(加重)</th>
              <th className="th text-right">合計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {monthly.map((m) => (
              <tr key={m.key} className="row-hover">
                <td className="td font-medium whitespace-nowrap">{m.label}</td>
                <td className="td text-right tabular-nums stat-accent">{formatYen(m.confirmed)}</td>
                <td className="td text-right tabular-nums text-ink/70">{formatYen(m.openWeighted)}</td>
                <td className="td text-right tabular-nums text-violet-600">{formatYen(m.renewalWeighted)}</td>
                <td className="td text-right tabular-nums font-semibold">{formatYen(m.confirmed + m.openWeighted + m.renewalWeighted)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/[0.08] bg-mist-soft/40 font-semibold">
              <td className="td">年度計</td>
              <td className="td text-right tabular-nums stat-accent">{formatYen(totalConfirmed)}</td>
              <td className="td text-right tabular-nums">{formatYen(totalOpen)}</td>
              <td className="td text-right tabular-nums text-violet-600">{formatYen(totalRenewal)}</td>
              <td className="td text-right tabular-nums">{formatYen(totalConfirmed + totalOpen + totalRenewal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* サブスク案件一覧 */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]"><h2 className="section-title">サブスク案件</h2></div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客名 / 案件</th>
              <th className="th text-right">月額(MRR)</th>
              <th className="th">契約期間</th>
              <th className="th text-right">契約TCV</th>
              <th className="th">更新見込み</th>
              <th className="th text-right">更新見込み(加重)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {subs.map((s) => (
              <tr key={s.id} className="row-hover">
                <td className="td max-w-[240px]">
                  <Link href={`/app/opportunities/${s.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{s.account}</Link>
                  <span className="text-xs text-ink/45 truncate block">{s.name}</span>
                </td>
                <td className="td text-right tabular-nums">{formatYen(s.mrr)}</td>
                <td className="td text-xs whitespace-nowrap">{fmtMonth(s.startMonth)}〜{fmtMonth(s.endMonth)}<span className="text-ink/40">（{s.termMonths}ヶ月）</span></td>
                <td className="td text-right tabular-nums">{formatYen(s.contractedTcv)}</td>
                <td className="td text-xs whitespace-nowrap">{s.renewalUntil ? `〜${fmtMonth(s.renewalUntil)}・${s.renewalProbability ?? 0}%` : "—"}</td>
                <td className="td text-right tabular-nums text-violet-600">{s.renewalWeightedTcv ? formatYen(s.renewalWeightedTcv) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 受注予測入力(インライン編集) ============
function ForecastInput({ rows }: { rows: InputRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const list = q ? rows.filter((r) => `${r.account} ${r.name}`.toLowerCase().includes(q.toLowerCase())) : rows;
    return [...list].sort((a, b) => b.amount - a.amount).slice(0, 200);
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="顧客・案件で検索" className="input pl-9" />
        </div>
        <span className="text-sm text-ink/50 ml-auto">オープン {rows.length} 件{filtered.length >= 200 && "（上位200件表示）"}</span>
      </div>
      <p className="text-xs text-ink/45 px-1">この案件を<b>いつ・いくらで受注予定か</b>、<b>担当者の予測確率</b>（ヨミとは別）を入力して保存します。</p>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客名 / 案件</th>
              <th className="th">ステージ</th>
              <th className="th">受注予測入力（予定額 / 予定日 / ヨミ / 予測確率% / 保存）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {filtered.map((r) => <InputRowForm key={r.id} row={r} />)}
            {filtered.length === 0 && <tr><td colSpan={3} className="td text-center text-ink/40 py-8">対象がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InputRowForm({ row }: { row: InputRow }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(formData: FormData) {
    setSaving(true);
    setDone(false);
    await setOppForecastAction(formData);
    setSaving(false);
    setDone(true);
    router.refresh();
    setTimeout(() => setDone(false), 2000);
  }

  return (
    <tr className="row-hover">
      <td className="td max-w-[240px]">
        <Link href={`/app/opportunities/${row.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{row.account}</Link>
        <span className="text-xs text-ink/45 truncate block">{row.name}</span>
      </td>
      <td className="td text-xs text-ink/60 whitespace-nowrap">{row.stageLabel}</td>
      <td className="td">
        <form action={onSubmit} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <MoneyInput name="amount" defaultValue={row.amount} placeholder="" className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-right outline-none focus:border-teal-primary" />
          <input name="expected_close_date" type="date" defaultValue={row.expectedClose ?? ""} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary" />
          <select name="yomi" defaultValue={row.yomi} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary">
            <option value="">—</option>
            {YOMI_OPTIONS.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
          </select>
          <input name="rep_probability" type="number" min={0} max={100} defaultValue={row.repProbability ?? ""} placeholder="%" className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-right outline-none focus:border-teal-primary" />
          <button type="submit" disabled={saving} className="btn-ghost text-xs py-1 disabled:opacity-40">
            {saving ? "保存中…" : done ? "✓ 保存" : "保存"}
          </button>
        </form>
      </td>
    </tr>
  );
}
