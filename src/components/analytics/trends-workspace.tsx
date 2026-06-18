"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Factory, Users2, Building, Layers, CalendarRange, Radio } from "lucide-react";
import { REGION_TILE, REGION_ORDER, TREND_SCOPES } from "@/lib/trends";
import type { TrendsData, GroupRow } from "@/lib/data/trends";
import { cn, formatYen } from "@/lib/utils";

type Tab = "area" | "industry" | "empsize" | "department" | "abc" | "cohort" | "source";
const TABS: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: "area", label: "エリア", icon: MapPin },
  { key: "industry", label: "業種", icon: Factory },
  { key: "empsize", label: "会社規模", icon: Users2 },
  { key: "department", label: "部署", icon: Building },
  { key: "abc", label: "ABC分析", icon: Layers },
  { key: "cohort", label: "コホート", icon: CalendarRange },
  { key: "source", label: "流入/アライアンス", icon: Radio },
];

export function TrendsWorkspace({ data, scope }: { data: TrendsData; scope: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("area");

  return (
    <div className="space-y-4">
      {/* 対象範囲 */}
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-ink/50">対象範囲</span>
        <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm flex-wrap">
          {TREND_SCOPES.map((s) => (
            <button key={s.key} onClick={() => router.push(`/app/analytics/trends?scope=${s.key}`)} className={cn("rounded-lg px-3 py-1.5 font-medium", scope === s.key ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink")}>{s.label}</button>
          ))}
        </div>
        <span className="text-sm text-ink/50 ml-auto">対象 <b className="text-ink">{data.totalLeads.toLocaleString()}</b> リード / <b className="text-ink">{data.totalCompanies.toLocaleString()}</b> 社</span>
      </div>

      {/* タブ */}
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          return <button key={t.key} onClick={() => setTab(t.key)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink")}><Icon size={15} />{t.label}</button>;
        })}
      </div>

      {tab === "area" && <AreaView data={data} />}
      {tab === "industry" && <GroupTable title="業種別" rows={data.industry} />}
      {tab === "empsize" && <GroupTable title="会社規模別" rows={data.empsize} />}
      {tab === "department" && <GroupTable title="部署別（上位30）" rows={data.department} />}
      {tab === "source" && <GroupTable title="流入元/アライアンス別" rows={data.source} />}
      {tab === "abc" && <AbcView data={data} />}
      {tab === "cohort" && <CohortView data={data} />}
    </div>
  );
}

// ===== エリア(地図＋表) =====
function AreaView({ data }: { data: TrendsData }) {
  const regionMax = Math.max(1, ...data.region.map((r) => r.count));
  const regionByKey = new Map(data.region.map((r) => [r.key, r]));
  const rows = Math.max(...Object.values(REGION_TILE).map((t) => t.r)) + 1;
  const cols = Math.max(...Object.values(REGION_TILE).map((t) => t.c)) + 1;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card card-pad">
        <h3 className="text-sm font-semibold mb-3">地方別ヒートマップ（簡易地図）</h3>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {REGION_ORDER.map((reg) => {
            const t = REGION_TILE[reg]; const g = regionByKey.get(reg);
            const intensity = g ? g.count / regionMax : 0;
            return (
              <div key={reg} style={{ gridRow: t.r + 1, gridColumn: t.c + 1, backgroundColor: `rgba(0,140,140,${0.12 + intensity * 0.78})` }} className="rounded-lg p-2 text-white min-h-[64px] flex flex-col justify-between">
                <span className="text-[11px] font-medium drop-shadow">{reg}</span>
                <span className="text-base font-bold tabular-nums drop-shadow">{g?.count ?? 0}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ink/40 mt-3">色が濃いほど対象リードが集中。地方区分の簡易タイル表示です。</p>
      </div>
      <GroupTable title="都道府県別ランキング" rows={data.prefecture} maxRows={20} embed />
    </div>
  );
}

// ===== 汎用グループ表 =====
function GroupTable({ title, rows, maxRows = 30, embed }: { title: string; rows: GroupRow[]; maxRows?: number; embed?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const shown = rows.slice(0, maxRows);
  const body = (
    <div className="card overflow-x-auto">
      <div className="px-5 pt-4 pb-2 border-b border-black/[0.04]"><h3 className="section-title">{title}</h3></div>
      <table className="w-full text-sm">
        <thead className="text-ink/40 text-xs"><tr><th className="th">区分</th><th className="th w-1/3">構成</th><th className="th text-right">リード</th><th className="th text-right">企業</th><th className="th text-right">構成比</th><th className="th text-right">受注額</th></tr></thead>
        <tbody className="divide-y divide-black/[0.04]">
          {shown.map((r) => (
            <tr key={r.key} className="row-hover">
              <td className="td font-medium max-w-[200px] truncate" title={r.label}>{r.label}</td>
              <td className="td"><div className="h-2 rounded-full bg-mist-soft overflow-hidden"><div className="h-full bg-teal-primary rounded-full" style={{ width: `${(r.count / max) * 100}%` }} /></div></td>
              <td className="td text-right tabular-nums font-semibold">{r.count.toLocaleString()}</td>
              <td className="td text-right tabular-nums text-ink/60">{r.companies.toLocaleString()}</td>
              <td className="td text-right tabular-nums text-ink/60">{Math.round(r.share * 100)}%</td>
              <td className="td text-right tabular-nums text-teal-deep">{r.wonAmount ? formatYen(r.wonAmount) : "—"}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-8">データがありません</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return embed ? body : <div>{body}</div>;
}

// ===== ABC分析 =====
function AbcView({ data }: { data: TrendsData }) {
  const colors: Record<string, string> = { A: "bg-teal-light text-teal-deep", B: "bg-amber-100 text-amber-700", C: "bg-mist-soft text-ink/50" };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((r) => (
          <div key={r} className="card card-pad">
            <div className="flex items-center gap-2"><span className={`pill text-sm font-bold ${colors[r]}`}>{r}</span><span className="text-xs text-ink/50">ランク</span></div>
            <div className="stat-value stat-accent mt-2">{formatYen(data.abcSummary[r].value)}</div>
            <div className="text-xs text-ink/40 mt-0.5">{data.abcSummary[r].count}社</div>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-2 border-b border-black/[0.04]"><h3 className="section-title">企業別 金額ランキング（受注+パイプライン）</h3></div>
        <table className="w-full text-sm">
          <thead className="text-ink/40 text-xs"><tr><th className="th">ランク</th><th className="th">企業</th><th className="th text-right">金額</th><th className="th text-right">構成比</th><th className="th text-right">累計</th></tr></thead>
          <tbody className="divide-y divide-black/[0.04]">
            {data.abc.map((r) => (
              <tr key={r.key} className="row-hover">
                <td className="td"><span className={`pill text-[10px] font-bold ${colors[r.rank]}`}>{r.rank}</span></td>
                <td className="td font-medium max-w-[240px] truncate" title={r.label}>{r.label}</td>
                <td className="td text-right tabular-nums font-semibold">{formatYen(r.value)}</td>
                <td className="td text-right tabular-nums text-ink/60">{Math.round(r.share * 100)}%</td>
                <td className="td text-right tabular-nums text-ink/50">{Math.round(r.cumShare * 100)}%</td>
              </tr>
            ))}
            {data.abc.length === 0 && <tr><td colSpan={5} className="td text-center text-ink/40 py-8">金額データがありません（受注・パイプラインのある対象範囲を選択）</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink/40">※ 金額降順で累計70%までA・90%までB・残りC。重点顧客（A）を見極め、リソース配分の判断に。</p>
    </div>
  );
}

// ===== コホート =====
function CohortView({ data }: { data: TrendsData }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-5 pt-4 pb-2 border-b border-black/[0.04]"><h3 className="section-title">獲得月別コホート（リード→案件化→受注）</h3></div>
      <table className="w-full text-sm">
        <thead className="text-ink/40 text-xs"><tr><th className="th">獲得月</th><th className="th text-right">リード</th><th className="th text-right">案件化</th><th className="th text-right">案件化率</th><th className="th text-right">受注</th><th className="th text-right">受注率</th></tr></thead>
        <tbody className="divide-y divide-black/[0.04]">
          {data.cohort.map((c) => (
            <tr key={c.month} className="row-hover">
              <td className="td font-medium whitespace-nowrap">{c.month.slice(0, 7)}</td>
              <td className="td text-right tabular-nums">{c.leads.toLocaleString()}</td>
              <td className="td text-right tabular-nums">{c.converted.toLocaleString()}</td>
              <td className="td text-right tabular-nums text-teal-deep">{c.leads ? Math.round((c.converted / c.leads) * 100) : 0}%</td>
              <td className="td text-right tabular-nums">{c.won.toLocaleString()}</td>
              <td className="td text-right tabular-nums text-teal-deep">{c.leads ? Math.round((c.won / c.leads) * 100) : 0}%</td>
            </tr>
          ))}
          {data.cohort.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-8">データがありません</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
