"use client";

import { useMemo, useState } from "react";
import { Search, Phone, List, Building2, BarChart3 } from "lucide-react";
import { LEAD_DISPOSITIONS, LEAD_DISPOSITION_MAP } from "@/lib/constants";
import { setLeadDispositionAction, setLeadCallOwnerAction } from "@/server/actions";
import { cn } from "@/lib/utils";

export interface LeadRow {
  id: string;
  company: string;
  companyNorm: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  empSize: string;
  industry: string;
  pref: string;
  rank: string;
  disposition: string;
  score: number;
  callOwner: string;
  event: string;
  dealOwner: string;
  tags: string;
}

const EVENTS: Record<string, string> = { AIDX: "AIDX展(3/24)", ODEX: "ODEX東京(5/13)", AINATIVE: "AI NATIVE(6/10)" };
const evLabel = (e: string) => EVENTS[e] ?? e ?? "—";

function roleBucket(t: string): string {
  if (/社長|代表|CEO|会長/.test(t)) return "経営者";
  if (/役員|取締役/.test(t)) return "役員";
  if (/本部長|部長|次長|部門長/.test(t)) return "部長";
  if (/課長/.test(t)) return "課長";
  return "担当";
}
function sizeBucket(s: string): string {
  const nums = (s.match(/[\d,]+/g) || []).map((x) => parseInt(x.replace(/,/g, ""), 10));
  const m = nums.length ? Math.max(...nums) : 0;
  return m >= 1000 ? "1000名+" : m >= 300 ? "300-999名" : m >= 100 ? "100-299名" : m ? "〜99名" : "不明";
}

function DispBadge({ d }: { d: string }) {
  const def = LEAD_DISPOSITION_MAP[d];
  return <span className={cn("pill text-[10px]", def?.color ?? "bg-mist-soft text-ink/50")}>{def?.label ?? d}</span>;
}

export function LeadsWorkspace({ rows }: { rows: LeadRow[] }) {
  const [tab, setTab] = useState<"list" | "queue" | "company" | "analysis">("list");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5">
        <Tab active={tab === "list"} onClick={() => setTab("list")} icon={<List size={15} />} label="リード一覧" />
        <Tab active={tab === "queue"} onClick={() => setTab("queue")} icon={<Phone size={15} />} label="架電キュー" />
        <Tab active={tab === "company"} onClick={() => setTab("company")} icon={<Building2 size={15} />} label="企業ビュー" />
        <Tab active={tab === "analysis"} onClick={() => setTab("analysis")} icon={<BarChart3 size={15} />} label="分析" />
      </div>
      {tab === "list" && <LeadList rows={rows} />}
      {tab === "queue" && <CallQueue rows={rows} />}
      {tab === "company" && <CompanyView rows={rows} />}
      {tab === "analysis" && <Analysis rows={rows} />}
    </div>
  );
}

function LeadList({ rows }: { rows: LeadRow[] }) {
  const [q, setQ] = useState("");
  const [ev, setEv] = useState("");
  const [disp, setDisp] = useState("");
  const [rank, setRank] = useState("");
  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (q && !(`${r.company} ${r.name}`.toLowerCase().includes(q.toLowerCase()))) return false;
      if (ev && r.event !== ev) return false;
      if (disp && r.disposition !== disp) return false;
      if (rank && r.rank !== rank) return false;
      return true;
    });
    return list.sort((a, b) => b.score - a.score);
  }, [rows, q, ev, disp, rank]);
  const shown = filtered.slice(0, 400);

  return (
    <div className="space-y-3">
      <div className="card card-pad flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社・担当者で検索" className="input pl-9" />
        </div>
        <Sel value={ev} onChange={setEv} ph="流入" opts={Object.keys(EVENTS).map((k) => ({ id: k, name: EVENTS[k] }))} />
        <Sel value={disp} onChange={setDisp} ph="決着" opts={LEAD_DISPOSITIONS.map((d) => ({ id: d.key, name: d.label }))} />
        <Sel value={rank} onChange={setRank} ph="ランク" opts={["S", "A", "B", "C", "D"].map((x) => ({ id: x, name: x }))} />
        <span className="text-sm text-ink/50 ml-auto">{filtered.length}件{filtered.length > 400 && "（上位400件表示）"}</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">会社 / 担当者</th>
              <th className="th">役職 / 規模</th>
              <th className="th">流入</th>
              <th className="th text-right">優先度</th>
              <th className="th">決着</th>
              <th className="th">架電担当</th>
              <th className="th">電話</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {shown.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td max-w-[240px]">
                  <span className="font-medium text-ink block truncate">{r.company}</span>
                  <span className="text-xs text-ink/45 truncate block">{r.name}{r.rank && <span className="ml-1 pill bg-mist-soft text-ink/50 text-[9px]">{r.rank}</span>}</span>
                </td>
                <td className="td text-xs text-ink/60">{r.jobTitle || "—"}<span className="block text-ink/40">{sizeBucket(r.empSize)}</span></td>
                <td className="td text-xs">{evLabel(r.event)}</td>
                <td className="td text-right tabular-nums font-semibold">{r.score}</td>
                <td className="td">
                  <form action={setLeadDispositionAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <select name="disposition" defaultValue={r.disposition} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                      {LEAD_DISPOSITIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </form>
                </td>
                <td className="td">
                  <form action={setLeadCallOwnerAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input name="call_owner" defaultValue={r.callOwner} onBlur={(e) => { if (e.currentTarget.value !== r.callOwner) e.currentTarget.form?.requestSubmit(); }} placeholder="—" className="w-24 rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary" />
                  </form>
                </td>
                <td className="td text-xs text-ink/60 tabular-nums">{r.phone || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallQueue({ rows }: { rows: LeadRow[] }) {
  const queue = useMemo(
    () => rows.filter((r) => r.disposition === "untouched" || r.disposition === "no_answer").sort((a, b) => b.score - a.score),
    [rows],
  );
  const shown = queue.slice(0, 300);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>架電対象 <b className="text-ink">{queue.length}</b> 件（未着手・不通／優先度降順）</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th text-right">優先度</th>
              <th className="th">会社 / 担当者</th>
              <th className="th">役職</th>
              <th className="th">流入</th>
              <th className="th">決着</th>
              <th className="th">電話</th>
              <th className="th">架電担当</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {shown.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td text-right tabular-nums font-bold stat-accent">{r.score}</td>
                <td className="td max-w-[240px]"><span className="font-medium block truncate">{r.company}</span><span className="text-xs text-ink/45">{r.name} {r.rank && `(${r.rank})`}</span></td>
                <td className="td text-xs text-ink/60">{r.jobTitle || "—"}</td>
                <td className="td text-xs">{evLabel(r.event)}</td>
                <td className="td"><DispBadge d={r.disposition} /></td>
                <td className="td text-xs tabular-nums">{r.phone || "—"}</td>
                <td className="td text-xs text-ink/60">{r.callOwner || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Comp {
  norm: string;
  name: string;
  contacts: number;
  events: Set<string>;
  best: string;
  maxScore: number;
  hasAppt: boolean;
}
function CompanyView({ rows }: { rows: LeadRow[] }) {
  const comps = useMemo(() => {
    const m = new Map<string, Comp>();
    const order = ["appointment", "continuing", "calling", "no_answer", "untouched", "ng", "excluded"];
    for (const r of rows) {
      const k = r.companyNorm || r.company;
      if (!k) continue;
      let c = m.get(k);
      if (!c) { c = { norm: k, name: r.company, contacts: 0, events: new Set(), maxScore: 0, best: r.disposition, hasAppt: false }; m.set(k, c); }
      c.contacts++;
      if (r.event) c.events.add(r.event);
      c.maxScore = Math.max(c.maxScore, r.score);
      if (r.disposition === "appointment") c.hasAppt = true;
      if (order.indexOf(r.disposition) < order.indexOf(c.best)) c.best = r.disposition;
    }
    return [...m.values()].sort((a, b) => b.events.size - a.events.size || b.maxScore - a.maxScore);
  }, [rows]);
  const multi = comps.filter((c) => c.events.size >= 2).length;
  const shown = comps.slice(0, 400);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>名寄せ後 <b className="text-ink">{comps.length}</b> 社</span>
        <span>複数展示会で接点 <b className="text-teal-deep">{multi}</b> 社（ホット）</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">企業</th>
              <th className="th text-right">担当者数</th>
              <th className="th text-right">接点(展示会)</th>
              <th className="th">接点イベント</th>
              <th className="th text-right">最高優先度</th>
              <th className="th">最良決着</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {shown.map((c) => (
              <tr key={c.norm} className={cn("row-hover", c.events.size >= 2 && "bg-teal-light/20")}>
                <td className="td font-medium max-w-[240px] truncate">{c.name}</td>
                <td className="td text-right tabular-nums">{c.contacts}</td>
                <td className="td text-right tabular-nums font-semibold">{c.events.size}</td>
                <td className="td text-xs text-ink/55">{[...c.events].map(evLabel).join(", ")}</td>
                <td className="td text-right tabular-nums">{c.maxScore}</td>
                <td className="td"><DispBadge d={c.best} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Analysis({ rows }: { rows: LeadRow[] }) {
  const total = rows.length;
  const called = rows.filter((r) => r.disposition !== "untouched").length;
  const appt = rows.filter((r) => r.disposition === "appointment").length;
  const ng = rows.filter((r) => r.disposition === "ng").length;
  const noans = rows.filter((r) => r.disposition === "no_answer").length;
  const highUntouched = rows.filter((r) => r.score >= 70 && r.disposition === "untouched").length;

  const dispCounts = LEAD_DISPOSITIONS.map((d) => ({ ...d, n: rows.filter((r) => r.disposition === d.key).length }));
  const maxDisp = Math.max(1, ...dispCounts.map((d) => d.n));

  const byAttr = (fn: (r: LeadRow) => string) => {
    const m = new Map<string, { total: number; appt: number }>();
    for (const r of rows) {
      const k = fn(r) || "—";
      const v = m.get(k) ?? { total: 0, appt: 0 };
      v.total++; if (r.disposition === "appointment") v.appt++;
      m.set(k, v);
    }
    return [...m.entries()].map(([k, v]) => ({ k, ...v, rate: v.total ? v.appt / v.total : 0 })).sort((a, b) => b.total - a.total);
  };

  // 複数接点 vs 単独接点 のアポ率(企業単位)
  const compMap = new Map<string, { events: Set<string>; appt: boolean }>();
  for (const r of rows) {
    const k = r.companyNorm || r.company; if (!k) continue;
    const c = compMap.get(k) ?? { events: new Set(), appt: false };
    if (r.event) c.events.add(r.event); if (r.disposition === "appointment") c.appt = true;
    compMap.set(k, c);
  }
  const comps = [...compMap.values()];
  const multi = comps.filter((c) => c.events.size >= 2);
  const single = comps.filter((c) => c.events.size <= 1);
  const apptRate = (arr: { appt: boolean }[]) => (arr.length ? arr.filter((x) => x.appt).length / arr.length : 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="総リード" v={`${total}`} />
        <Kpi label="架電済" v={`${called}`} sub={pct(called, total)} />
        <Kpi label="アポ獲得" v={`${appt}`} sub={pct(appt, total)} accent />
        <Kpi label="アポ率(架電比)" v={pct(appt, called)} />
        <Kpi label="高優先×未着手" v={`${highUntouched}`} sub="取りこぼし注意" warn={highUntouched > 0} />
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">決着分布</h2>
        <div className="space-y-2">
          {dispCounts.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className="w-24 text-xs text-ink/60">{d.label}</span>
              <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden">
                <div className="h-full rounded-full bg-teal-primary" style={{ width: `${(d.n / maxDisp) * 100}%` }} />
              </div>
              <span className="w-16 text-right text-sm tabular-nums">{d.n}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <AttrTable title="ランク別 アポ率" rows={byAttr((r) => r.rank)} />
        <AttrTable title="役職別 アポ率" rows={byAttr((r) => roleBucket(r.jobTitle))} />
        <AttrTable title="従業員規模別 アポ率" rows={byAttr((r) => sizeBucket(r.empSize))} />
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">複数接点企業の効果</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-ink/50">複数展示会で接点（{multi.length}社）のアポ率</div>
            <div className="text-2xl font-bold stat-accent">{pct(multi.filter((c) => c.appt).length, multi.length)}</div>
          </div>
          <div>
            <div className="text-ink/50">単独接点（{single.length}社）のアポ率</div>
            <div className="text-2xl font-bold text-ink/70">{pct(single.filter((c) => c.appt).length, single.length)}</div>
          </div>
        </div>
        <p className="text-[11px] text-ink/40 mt-2">複数の展示会で接点がある企業は関心が高い傾向。優先的に追客すると効率的です。</p>
      </div>

      <div className="card card-pad border-l-4 border-l-accent-orange">
        <h2 className="section-title mb-2">改善アラート</h2>
        <ul className="text-sm text-ink/70 space-y-1.5 list-disc pl-5">
          <li>高優先度(70+)なのに<b>未着手</b>のリードが <b className="text-accent-orange">{highUntouched}</b> 件 → 架電キューの最上位へ。</li>
          <li><b>不通</b>のまま放置が <b className="text-accent-orange">{noans}</b> 件 → 再架電/メール切替を検討。</li>
          <li>NG(お断り) <b>{ng}</b> 件 → 理由を蓄積し、ターゲティング/トークを改善。</li>
          <li>架電未着手 <b>{total - called}</b> 件（全体の {pct(total - called, total)}）→ 架電チームの稼働を確認。</li>
        </ul>
      </div>
    </div>
  );
}

function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : "—"; }

function Kpi({ label, v, sub, accent, warn }: { label: string; v: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold text-ink/50">{label}</div>
      <div className={cn("text-2xl font-bold mt-1 tabular-nums", accent && "stat-accent", warn && "text-accent-orange")}>{v}</div>
      {sub && <div className="text-[11px] text-ink/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function AttrTable({ title, rows }: { title: string; rows: { k: string; total: number; appt: number; rate: number }[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-black/[0.04]"><h3 className="text-sm font-semibold">{title}</h3></div>
      <table className="w-full">
        <thead className="text-[11px] text-ink/40"><tr><th className="th">区分</th><th className="th text-right">数</th><th className="th text-right">アポ</th><th className="th text-right">率</th></tr></thead>
        <tbody className="divide-y divide-black/[0.04]">
          {rows.map((r) => (
            <tr key={r.k}><td className="td text-xs">{r.k}</td><td className="td text-right tabular-nums text-xs">{r.total}</td><td className="td text-right tabular-nums text-xs">{r.appt}</td><td className="td text-right tabular-nums text-xs font-semibold text-teal-deep">{Math.round(r.rate * 100)}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink")}>
      {icon}{label}
    </button>
  );
}

function Sel({ value, onChange, ph, opts }: { value: string; onChange: (v: string) => void; ph: string; opts: { id: string; name: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
      <option value="">{ph}：すべて</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
