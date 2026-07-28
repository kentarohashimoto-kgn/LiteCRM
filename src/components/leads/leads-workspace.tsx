"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Phone, List, Building2, BarChart3, History, Trash2, Upload, ChevronLeft, ChevronRight, Download, Filter, Inbox } from "lucide-react";
import { DownloadPanel } from "@/components/leads/download-panel";
import { LEAD_DISPOSITIONS, LEAD_DISPOSITION_MAP } from "@/lib/constants";
import { setLeadDispositionAction, setLeadCallOwnerAction, setLeadFunnelStageAction, deleteImportBatchAction, setAcquirerAliasAction, upsertLeadsBatchAction, recomputeEngagementAction } from "@/server/actions";
import { parseDelimited, detectDelim, rowToRawInput, dedupLeads, LEAD_KINDS } from "@/lib/lead-import";
import { FUNNEL_STAGES, FUNNEL_STAGE_MAP, FUNNEL_MAIN, nextFunnelStage, SQL_CRITERIA, NURTURE_CRITERIA } from "@/lib/lead-funnel";
import { PromoteLeadButton } from "@/components/leads/promote-button";
import { BulkMailPanel } from "@/components/leads/bulk-mail-panel";
import { StickyGrid } from "@/components/ui/sticky-grid";
import { cn, formatDateFull, formatDateTimeJst } from "@/lib/utils";
import type { WsListRow, WsQueueRow, WsCompanyRow, WsAnalysisScope, WsAttr, LeadsFilters, CompaniesData, AnalysisData, FunnelData } from "@/lib/data/leads-workspace";

export interface BatchRow {
  id: string;
  label: string;
  rawEvent: string;
  sourceName: string;
  rowCount: number;
  createdAt: string;
  config: Record<string, unknown>;
}
export interface AliasRow { raw: string; name: string }
export type LeadsTab = "list" | "inquiries" | "funnel" | "queue" | "company" | "analysis" | "download" | "batches";
interface ListData { rows: WsListRow[]; total: number; page: number; pageSize: number }
interface QueueData { rows: WsQueueRow[]; total: number }
interface PresetRow { id: string; name: string; columns: string[] }

const EVENTS: Record<string, string> = { AIDX: "AIDX展(3/24)", ODEX: "ODEX東京(5/13)", AINATIVE: "AI NATIVE(6/10)" };
const evLabel = (e: string) => EVENTS[e] ?? e ?? "—";

function DispBadge({ d }: { d: string }) {
  const def = LEAD_DISPOSITION_MAP[d];
  return <span className={cn("pill text-[10px]", def?.color ?? "bg-mist-soft text-ink/50")}>{def?.label ?? d}</span>;
}

const ENG_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-amber-100 text-amber-700", B: "bg-teal-light text-teal-deep",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/35",
};
function EngBadge({ rank, score }: { rank: string; score: number }) {
  return <span className={cn("pill text-[10px] tabular-nums", ENG_COLOR[rank] ?? ENG_COLOR.D)} title={`エンゲージメント ${score}pt`}>{rank}</span>;
}

export function LeadsWorkspace({
  tab,
  list,
  funnel,
  queue,
  company,
  analysis,
  batches = [],
  aliases = [],
  events = [],
  mediaOptions = [],
  presets = [],
  filters,
}: {
  tab: LeadsTab;
  list?: ListData;
  funnel?: FunnelData;
  queue?: QueueData;
  company?: CompaniesData;
  analysis?: AnalysisData;
  batches?: BatchRow[];
  aliases?: AliasRow[];
  events?: string[];
  mediaOptions?: string[];
  presets?: PresetRow[];
  filters: LeadsFilters;
}) {
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 flex-wrap">
        <TabLink active={tab === "list"} tab="list" icon={<List size={15} />} label="リード一覧" />
        <TabLink active={tab === "inquiries"} tab="inquiries" icon={<Inbox size={15} />} label="HP問合せ" />
        <TabLink active={tab === "funnel"} tab="funnel" icon={<Filter size={15} />} label="ファネル" />
        <TabLink active={tab === "queue"} tab="queue" icon={<Phone size={15} />} label="架電キュー" />
        <TabLink active={tab === "company"} tab="company" icon={<Building2 size={15} />} label="企業ビュー" />
        <TabLink active={tab === "analysis"} tab="analysis" icon={<BarChart3 size={15} />} label="分析" />
        <TabLink active={tab === "download"} tab="download" icon={<Download size={15} />} label="ダウンロード" />
        <TabLink active={tab === "batches"} tab="batches" icon={<History size={15} />} label="取込履歴" />
      </div>
      {tab === "list" && list && <LeadList list={list} filters={filters} events={events} />}
      {tab === "inquiries" && list && <LeadList list={list} filters={filters} events={events} tabKey="inquiries" mediaOptions={mediaOptions} />}
      {tab === "funnel" && funnel && <FunnelView funnel={funnel} />}
      {tab === "queue" && queue && <CallQueue queue={queue} />}
      {tab === "company" && company && <CompanyView companies={company} />}
      {tab === "analysis" && analysis && <Analysis analysis={analysis} aliases={aliases} />}
      {tab === "download" && <DownloadPanel events={events} presets={presets} />}
      {tab === "batches" && <Batches batches={batches} />}
    </div>
  );
}

// ============ リード一覧(サーバー側フィルタ＋ページング) ============
// tabKey="inquiries" のときは「HP問合せ」タブとして、Webフォーム由来(HP問合せ・資料請求)に
// 絞った一覧を表示する(絞り込み自体はサーバー側で sourceIn により適用済み)。
function LeadList({ list, filters, events, tabKey = "list", mediaOptions = [] }: { list: ListData; filters: LeadsFilters; events: string[]; tabKey?: LeadsTab; mediaOptions?: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const isInquiries = tabKey === "inquiries";

  const go = (next: Partial<LeadsFilters>) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    p.set("tab", tabKey);
    if (f.q) p.set("q", f.q);
    if (f.event) p.set("ev", f.event);
    if (f.media) p.set("md", f.media);
    if (f.disposition) p.set("disp", f.disposition);
    if (f.rank) p.set("rank", f.rank);
    if (isInquiries && f.sort && f.sort !== "date") p.set("sort", f.sort);
    if (isInquiries && f.dir === "asc") p.set("dir", "asc");
    if (f.page && f.page > 1) p.set("page", String(f.page));
    router.push(`/app/leads?${p.toString()}`);
  };

  const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));

  // 並べ替え(HP問合せタブ)。同じ列を押すと昇順/降順トグル、別列は既定方向へ。
  const sortKey = filters.sort ?? "date";
  const sortDir = filters.dir ?? "desc";
  const toggleSort = (key: string) => {
    if (sortKey === key) go({ sort: key, dir: sortDir === "asc" ? "desc" : "asc", page: 1 });
    else go({ sort: key, dir: key === "date" ? "desc" : "asc", page: 1 });
  };

  return (
    <div className="space-y-3">
      {isInquiries && (
        <p className="text-sm text-ink/60 px-1">
          HPの問い合わせ・資料請求フォームから届いた新規問合せだけを分離表示しています（流入元で絞り込み可）。
          不要な営業問合せは「決着」を<b>対象外</b>に、有効な問合せは右端の<b>案件化</b>で商談化してください。
        </p>
      )}
      <div className="card card-pad flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); go({ q, page: 1 }); }}
          className="relative flex-1 min-w-[200px] max-w-xs"
        >
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社・担当者で検索（Enter）" className="input pl-9" />
        </form>
        {isInquiries && <Sel value={filters.media ?? ""} onChange={(v) => go({ media: v, page: 1 })} ph="流入元" opts={mediaOptions.map((m) => ({ id: m, name: m }))} />}
        <Sel value={filters.event ?? ""} onChange={(v) => go({ event: v, page: 1 })} ph={isInquiries ? "流入詳細" : "流入"} opts={events.map((e) => ({ id: e, name: evLabel(e) }))} />
        <Sel value={filters.disposition ?? ""} onChange={(v) => go({ disposition: v, page: 1 })} ph="決着" opts={LEAD_DISPOSITIONS.map((d) => ({ id: d.key, name: d.label }))} />
        {!isInquiries && <Sel value={filters.rank ?? ""} onChange={(v) => go({ rank: v, page: 1 })} ph="ランク" opts={["S", "A", "B", "C", "D"].map((x) => ({ id: x, name: x }))} />}
        {!isInquiries && <BulkMailPanel filters={{ q: filters.q, event: filters.event, disposition: filters.disposition, rank: filters.rank }} />}
        <span className="text-sm text-ink/50 ml-auto">{list.total}件</span>
      </div>
      <div className="card">
        <StickyGrid freeze maxHeight="66vh">
        {isInquiries ? (
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <SortTh label="受付日時" col="date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="th">会社 / 担当者</th>
              <SortTh label="流入元" col="media" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="流入詳細" col="detail" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="タグ" col="tags" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="決着" col="disposition" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="th">電話</th>
              <th className="th">案件化</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {list.rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td text-xs text-ink/60 whitespace-nowrap tabular-nums">{r.createdAt ? formatDateTimeJst(r.createdAt) : "—"}</td>
                <td className="td max-w-[220px]">
                  <Link href={`/app/leads/${r.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{r.company}</Link>
                  <span className="text-xs text-ink/45 truncate block">{r.name || "—"}</span>
                </td>
                <td className="td text-xs">{r.media ? <span className="pill bg-teal-light text-teal-deep text-[10px]">{r.media}</span> : <span className="text-ink/35">—</span>}</td>
                <td className="td text-xs text-ink/70 max-w-[200px] truncate" title={r.event}>{r.event || "—"}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {r.tags.length ? r.tags.map((t) => <span key={t} className="pill bg-mist-soft text-ink/60 text-[10px]">{t}</span>) : <span className="text-ink/35 text-xs">—</span>}
                  </div>
                </td>
                <td className="td">
                  <form action={setLeadDispositionAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <select name="disposition" defaultValue={r.disposition} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                      {LEAD_DISPOSITIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </form>
                </td>
                <td className="td text-xs text-ink/60 tabular-nums">{r.phone || "—"}{r.mobilePhone && <span className="block text-ink/40">{r.mobilePhone}</span>}</td>
                <td className="td">
                  {r.converted ? <span className="pill bg-teal-light text-teal-deep text-[10px]">済</span> : <PromoteLeadButton leadId={r.id} size="mini" />}
                </td>
              </tr>
            ))}
            {list.rows.length === 0 && <tr><td colSpan={8} className="td text-center text-ink/40 py-8">該当する問合せがありません</td></tr>}
          </tbody>
        </table>
        ) : (
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">会社 / 担当者</th>
              <th className="th">役職 / 規模</th>
              <th className="th">流入</th>
              <th className="th">ファネル</th>
              <th className="th text-center">エンゲージ</th>
              <th className="th text-right">優先度</th>
              <th className="th">決着</th>
              <th className="th">架電担当</th>
              <th className="th">電話</th>
              <th className="th">案件化</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {list.rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td max-w-[240px]">
                  <Link href={`/app/leads/${r.id}`} className="font-medium text-ink hover:text-teal-deep block truncate">{r.company}</Link>
                  <span className="text-xs text-ink/45 truncate block">{r.name}{r.rank && <span className="ml-1 pill bg-mist-soft text-ink/50 text-[9px]">{r.rank}</span>}</span>
                </td>
                <td className="td text-xs text-ink/60">{r.jobTitle || "—"}<span className="block text-ink/40">{r.empSizeBucket}</span></td>
                <td className="td text-xs">{evLabel(r.event)}</td>
                <td className="td"><StageSelect id={r.id} value={r.funnelStage} /></td>
                <td className="td text-center"><EngBadge rank={r.engRank} score={r.engScore} /></td>
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
                <td className="td text-xs text-ink/60 tabular-nums">{r.phone || "—"}{r.mobilePhone && <span className="block text-ink/40">{r.mobilePhone}</span>}</td>
                <td className="td">
                  {r.converted ? <span className="pill bg-teal-light text-teal-deep text-[10px]">済</span> : <PromoteLeadButton leadId={r.id} size="mini" />}
                </td>
              </tr>
            ))}
            {list.rows.length === 0 && <tr><td colSpan={10} className="td text-center text-ink/40 py-8">該当するリードがありません</td></tr>}
          </tbody>
        </table>
        )}
        </StickyGrid>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button onClick={() => go({ page: (filters.page ?? 1) - 1 })} disabled={(filters.page ?? 1) <= 1} className="btn-ghost text-xs disabled:opacity-30"><ChevronLeft size={14} /> 前</button>
          <span className="text-ink/50 tabular-nums">{filters.page ?? 1} / {pageCount}</span>
          <button onClick={() => go({ page: (filters.page ?? 1) + 1 })} disabled={(filters.page ?? 1) >= pageCount} className="btn-ghost text-xs disabled:opacity-30">次 <ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ============ 架電キュー ============
function CallQueue({ queue }: { queue: QueueData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>架電対象 <b className="text-ink">{queue.total}</b> 件（未着手・不通／優先度降順・上位{queue.rows.length}件）</span>
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
            {queue.rows.map((r: WsQueueRow) => (
              <tr key={r.id} className="row-hover">
                <td className="td text-right tabular-nums font-bold stat-accent">{r.score}</td>
                <td className="td max-w-[240px]"><Link href={`/app/leads/${r.id}`} className="font-medium block truncate hover:text-teal-deep">{r.company}</Link><span className="text-xs text-ink/45">{r.name} {r.rank && `(${r.rank})`}</span></td>
                <td className="td text-xs text-ink/60">{r.jobTitle || "—"}</td>
                <td className="td text-xs">{evLabel(r.event)}</td>
                <td className="td"><DispBadge d={r.disposition} /></td>
                <td className="td text-xs tabular-nums">{r.phone || "—"}{r.mobilePhone && <span className="block text-ink/40">{r.mobilePhone}</span>}</td>
                <td className="td text-xs text-ink/60">{r.callOwner || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 企業ビュー ============
function CompanyView({ companies }: { companies: CompaniesData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>名寄せ後 <b className="text-ink">{companies.total}</b> 社</span>
        <span>複数展示会で接点 <b className="text-teal-deep">{companies.multi}</b> 社（ホット）</span>
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
            {companies.rows.map((c: WsCompanyRow) => (
              <tr key={c.norm} className={cn("row-hover", c.multi && "bg-teal-light/20")}>
                <td className="td font-medium max-w-[240px] truncate">{c.name}</td>
                <td className="td text-right tabular-nums">{c.contacts}</td>
                <td className="td text-right tabular-nums font-semibold">{c.events.length}</td>
                <td className="td text-xs text-ink/55">{c.events.map(evLabel).join(", ")}</td>
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

// ============ 分析(イベント別スコープは事前集計済み・即時切替) ============
function Analysis({ analysis, aliases }: { analysis: AnalysisData; aliases: AliasRow[] }) {
  const router = useRouter();
  const [ev, setEv] = useState("");
  const s: WsAnalysisScope = analysis.scopes[ev] ?? analysis.scopes[""];
  const aliasMap = new Map(aliases.map((a) => [a.raw, a.name]));

  const maxAcq = Math.max(1, ...s.acqPerf.map((a) => a.total));
  const hours = s.hourDist.map((n, h) => ({ h, n })).filter((x) => x.n > 0);
  const maxHour = Math.max(1, ...s.hourDist);
  const maxDisp = Math.max(1, ...s.dispCounts.map((d) => d.n));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink/40">対象:</span>
        <select value={ev} onChange={(e) => setEv(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">全体</option>
          {analysis.events.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="総リード" v={`${s.total}`} />
        <Kpi label="架電済" v={`${s.called}`} sub={pct(s.called, s.total)} />
        <Kpi label="アポ獲得" v={`${s.appt}`} sub={pct(s.appt, s.total)} accent />
        <Kpi label="アポ率(架電比)" v={pct(s.appt, s.called)} />
        <Kpi label="高優先×未着手" v={`${s.highUntouched}`} sub="取りこぼし注意" warn={s.highUntouched > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-black/[0.04]"><h3 className="text-sm font-semibold">取得担当別 パフォーマンス</h3></div>
          <table className="w-full">
            <thead className="text-[11px] text-ink/40"><tr><th className="th">取得担当</th><th className="th text-right">取得数</th><th className="th w-1/3">構成</th><th className="th text-right">アポ率</th></tr></thead>
            <tbody className="divide-y divide-black/[0.04]">
              {s.acqPerf.map((a) => (
                <tr key={a.k}>
                  <td className="td text-xs">{a.k}</td>
                  <td className="td text-right tabular-nums text-xs font-semibold">{a.total}</td>
                  <td className="td"><div className="h-2 rounded-full bg-mist-soft overflow-hidden"><div className="h-full bg-teal-primary rounded-full" style={{ width: `${(a.total / maxAcq) * 100}%` }} /></div></td>
                  <td className="td text-right tabular-nums text-xs text-teal-deep">{Math.round(a.rate * 100)}%</td>
                </tr>
              ))}
              {s.acqPerf.length === 0 && <tr><td colSpan={4} className="td text-center text-ink/40 py-4 text-xs">取得担当データなし</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card card-pad">
          <h3 className="text-sm font-semibold mb-3">時間帯別 リード取得数</h3>
          {hours.length === 0 ? <p className="text-xs text-ink/40">スキャン時刻データなし</p> : (
            <div className="space-y-1.5">
              {hours.map((x) => (
                <div key={x.h} className="flex items-center gap-2">
                  <span className="w-10 text-[11px] text-ink/50 tabular-nums">{x.h}時</span>
                  <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden"><div className="h-full bg-accent-orange rounded-full" style={{ width: `${(x.n / maxHour) * 100}%` }} /></div>
                  <span className="w-8 text-right text-xs tabular-nums">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">決着分布</h2>
        <div className="space-y-2">
          {s.dispCounts.map((d) => (
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
        <AttrTable title="ランク別 アポ率" rows={s.byRank} />
        <AttrTable title="役職別 アポ率" rows={s.byRole} />
        <AttrTable title="従業員規模別 アポ率" rows={s.bySize} />
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">複数接点企業の効果</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-ink/50">複数展示会で接点（{s.multiCount}社）のアポ率</div>
            <div className="text-2xl font-bold stat-accent">{pct(s.multiAppt, s.multiCount)}</div>
          </div>
          <div>
            <div className="text-ink/50">単独接点（{s.singleCount}社）のアポ率</div>
            <div className="text-2xl font-bold text-ink/70">{pct(s.singleAppt, s.singleCount)}</div>
          </div>
        </div>
        <p className="text-[11px] text-ink/40 mt-2">複数の展示会で接点がある企業は関心が高い傾向。優先的に追客すると効率的です。</p>
      </div>

      <div className="card card-pad border-l-4 border-l-accent-orange">
        <h2 className="section-title mb-2">改善アラート</h2>
        <ul className="text-sm text-ink/70 space-y-1.5 list-disc pl-5">
          <li>高優先度(70+)なのに<b>未着手</b>のリードが <b className="text-accent-orange">{s.highUntouched}</b> 件 → 架電キューの最上位へ。</li>
          <li><b>不通</b>のまま放置が <b className="text-accent-orange">{s.noans}</b> 件 → 再架電/メール切替を検討。</li>
          <li>NG(お断り) <b>{s.ng}</b> 件 → 理由を蓄積し、ターゲティング/トークを改善。</li>
          <li>架電未着手 <b>{s.total - s.called}</b> 件（全体の {pct(s.total - s.called, s.total)}）→ 架電チームの稼働を確認。</li>
        </ul>
      </div>

      {analysis.rawAcquirers.length > 0 && (
        <AcquirerAliasEditor raws={analysis.rawAcquirers} aliasMap={aliasMap} onSaved={() => router.refresh()} />
      )}
    </div>
  );
}

function AcquirerAliasEditor({ raws, aliasMap, onSaved }: { raws: string[]; aliasMap: Map<string, string>; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function save(raw: string, name: string) {
    setBusy(raw);
    await setAcquirerAliasAction(raw, name);
    onSaved();
    setBusy(null);
  }
  return (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold mb-1">取得担当の名前設定（数字 → 氏名）</h3>
      <p className="text-[11px] text-ink/40 mb-3">読取端末のIDや番号で記録された取得担当に、表示名を割り当てます（分析に反映）。</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {raws.map((raw) => (
          <form key={raw} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); save(raw, String(fd.get("name") ?? "")); }} className="flex items-center gap-2">
            <span className="w-32 text-xs text-ink/60 truncate" title={raw}>{raw}</span>
            <span className="text-ink/30 text-xs">→</span>
            <input name="name" defaultValue={aliasMap.get(raw) ?? ""} placeholder="表示名" className="input text-xs flex-1" />
            <button type="submit" disabled={busy === raw} className="btn-ghost text-xs disabled:opacity-40">{busy === raw ? "…" : "保存"}</button>
          </form>
        ))}
      </div>
    </div>
  );
}

// ============ 取込履歴 ============
function Batches({ batches }: { batches: BatchRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  async function undo(b: BatchRow) {
    if (!confirm(`「${b.label}」の取込(${b.rowCount}件)を取り消します。よろしいですか？`)) return;
    setBusy(b.id);
    await deleteImportBatchAction(b.id);
    router.refresh();
    setBusy(null);
  }

  async function updateFromFile(b: BatchRow, file: File) {
    const cfg = b.config as { mapping?: Record<string, string>; customFields?: { key: string; header: string }[]; kind?: string; campaignId?: string | null; leadSourceId?: string | null; eventDate?: string | null; acquiredDate?: string | null };
    if (!cfg.mapping) { alert("この取込にはマッピング情報が保存されていません。新規投入画面から取り込んでください。"); return; }
    setBusy(b.id);
    try {
      const text = await file.text();
      const all = parseDelimited(text, detectDelim(text));
      const headers = all[0].map((h) => h.trim());
      const inputs = dedupLeads(all.slice(1).map((row) => rowToRawInput(headers, row, cfg.mapping!, cfg.customFields ?? [])));
      const base = LEAD_KINDS.find((k) => k.key === cfg.kind)?.base ?? 20;
      const opts = { campaignId: cfg.campaignId ?? null, leadSourceId: cfg.leadSourceId ?? null, rawEvent: b.rawEvent, base, eventDate: cfg.eventDate ?? null, acquiredDate: cfg.acquiredDate ?? null, importBatchId: b.id };
      let upd = 0, ins = 0;
      const CHUNK = 300;
      for (let i = 0; i < inputs.length; i += CHUNK) {
        const res = await upsertLeadsBatchAction(inputs.slice(i, i + CHUNK), opts);
        if (res.error) throw new Error(res.error);
        upd += res.updated; ins += res.inserted;
        setStatus((st) => ({ ...st, [b.id]: `更新中… ${Math.min(100, Math.round(((i + CHUNK) / inputs.length) * 100))}%` }));
      }
      await recomputeEngagementAction();
      setStatus((st) => ({ ...st, [b.id]: `✅ 更新${upd}件・新規${ins}件` }));
      router.refresh();
    } catch (e) {
      setStatus((st) => ({ ...st, [b.id]: "エラー: " + (e instanceof Error ? e.message : String(e)) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink/60 px-1">
        取込の履歴です。<b>「上書き更新」</b>＝同じファイルを再アップロードするだけで、保存済みマッピングを使い<b>決着など変更分を上書き</b>（マッピング不要）。
        <b>「一括取り消し」</b>＝その取込ぶんを削除。マッピングを変えたい時は「取込」画面から新規投入してください。
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr><th className="th">取込日時</th><th className="th">イベント名</th><th className="th">元ファイル</th><th className="th text-right">件数</th><th className="th text-right">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {batches.map((b) => {
              const hasCfg = !!(b.config as { mapping?: unknown }).mapping;
              return (
                <tr key={b.id} className="row-hover">
                  <td className="td text-xs whitespace-nowrap">{formatDateFull(b.createdAt)}</td>
                  <td className="td font-medium">{b.label}</td>
                  <td className="td text-xs text-ink/50 max-w-[180px] truncate">{b.sourceName || "—"}</td>
                  <td className="td text-right tabular-nums">{b.rowCount}</td>
                  <td className="td text-right">
                    <div className="inline-flex items-center gap-3 justify-end">
                      {status[b.id] && <span className="text-[11px] text-ink/50">{status[b.id]}</span>}
                      <label className={cn("inline-flex items-center gap-1 text-xs cursor-pointer", hasCfg ? "text-teal-deep hover:text-teal-primary" : "text-ink/30 cursor-not-allowed")} title={hasCfg ? "同じ形式のファイルを再アップロードして上書き更新" : "マッピング未保存（新規投入から取込）"}>
                        <Upload size={13} /> {busy === b.id ? "更新中…" : "上書き更新"}
                        <input type="file" accept=".tsv,.csv,.txt" className="hidden" disabled={!hasCfg || busy === b.id} onChange={(e) => { const f = e.target.files?.[0]; if (f) updateFromFile(b, f); e.currentTarget.value = ""; }} />
                      </label>
                      <button onClick={() => undo(b)} disabled={busy === b.id} className="inline-flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 disabled:opacity-40">
                        <Trash2 size={13} /> 一括取り消し
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {batches.length === 0 && <tr><td colSpan={5} className="td text-center text-ink/40 py-8">取込履歴がありません</td></tr>}
          </tbody>
        </table>
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

function AttrTable({ title, rows }: { title: string; rows: WsAttr[] }) {
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

// ファネルステージのインライン変更(アポにすると自動案件化)
function StageSelect({ id, value }: { id: string; value: string }) {
  return (
    <form action={setLeadFunnelStageAction}>
      <input type="hidden" name="id" value={id} />
      <select name="funnel_stage" defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()} className={cn("rounded-lg border border-black/10 px-1.5 py-1 text-xs outline-none focus:border-teal-primary", FUNNEL_STAGE_MAP[value]?.color ?? "bg-white")}>
        {FUNNEL_STAGES.map((s) => <option key={s.key} value={s.key}>{s.short}</option>)}
      </select>
    </form>
  );
}

// ============ アポ前ファネル ============
function FunnelView({ funnel }: { funnel: FunnelData }) {
  const count = (k: string) => funnel.stages[k]?.count ?? 0;
  const main = FUNNEL_MAIN;
  const newC = count("new");
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink/60 px-1">名刺→<b>相談候補(MQL)</b>→<b>商談候補(SQL)</b>→<b>アポ獲得</b>と、ヨミ評価の前段でリードを仕組みで前進させます。各ステージのリードを次へ進めると、アポ獲得で自動的に案件化されます。</p>

      {/* 本流ファネル */}
      <div className="card card-pad">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-stretch">
          {main.map((s, i) => {
            const c = count(s.key);
            const prev = i > 0 ? count(main[i - 1].key) : null;
            const conv = prev != null && prev > 0 ? Math.round((c / prev) * 100) : null;
            return (
              <div key={s.key} className="relative">
                <div className={cn("rounded-xl p-4 h-full", s.color)}>
                  <div className="text-xs font-medium opacity-80">{s.label}</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">{c.toLocaleString()}</div>
                  {conv != null && <div className="text-[11px] opacity-70 mt-1">前段からの転換 {conv}%</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-ink/50">
          <span>育成対象 <b className="text-violet-700">{count("nurturing")}</b></span>
          <span>対象外 <b className="text-rose-500">{count("excluded")}</b></span>
          <span className="ml-auto">新規未着手 <b className="text-ink">{newC}</b></span>
        </div>
      </div>

      {/* ステージ別リード(次へ進める) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {main.map((s) => {
          const st = funnel.stages[s.key];
          const next = nextFunnelStage(s.key);
          return (
            <div key={s.key} className="card overflow-hidden">
              <div className="px-4 pt-3 pb-2 border-b border-black/[0.04] flex items-center justify-between">
                <h3 className="text-sm font-semibold"><span className={cn("pill text-[10px] mr-1.5", s.color)}>{s.short}</span>{s.label}</h3>
                <span className="text-xs text-ink/40">{st?.count ?? 0}件・上位{Math.min(st?.rows.length ?? 0, 8)}表示</span>
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-black/[0.04]">
                  {(st?.rows ?? []).slice(0, 8).map((r) => (
                    <tr key={r.id} className="row-hover">
                      <td className="td max-w-[160px]"><Link href={`/app/leads/${r.id}`} className="font-medium hover:text-teal-deep block truncate">{r.company}</Link><span className="text-ink/45 truncate block">{r.name}</span></td>
                      <td className="td text-right tabular-nums w-12">{r.score}</td>
                      <td className="td w-28">
                        <div className="flex items-center gap-1 justify-end">
                          {next && <StageAdvance id={r.id} to={next} label={`→${FUNNEL_STAGE_MAP[next]?.short}`} primary />}
                          {s.key !== "nurturing" && <StageAdvance id={r.id} to="nurturing" label="育成" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(st?.rows.length ?? 0) === 0 && <tr><td className="td text-center text-ink/40 py-4">なし</td></tr>}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* 判定ガイド */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card card-pad"><h3 className="text-sm font-semibold mb-2">商談候補(SQL)へ上げる条件</h3><ul className="text-xs text-ink/60 space-y-1 list-disc pl-4">{SQL_CRITERIA.map((c) => <li key={c}>{c}</li>)}</ul></div>
        <div className="card card-pad"><h3 className="text-sm font-semibold mb-2">育成対象に回す条件</h3><ul className="text-xs text-ink/60 space-y-1 list-disc pl-4">{NURTURE_CRITERIA.map((c) => <li key={c}>{c}</li>)}</ul></div>
      </div>
    </div>
  );
}

function StageAdvance({ id, to, label, primary }: { id: string; to: string; label: string; primary?: boolean }) {
  return (
    <form action={setLeadFunnelStageAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="funnel_stage" value={to} />
      <button type="submit" className={cn("rounded-lg px-2 py-0.5 text-[11px] font-medium", primary ? "bg-teal-primary text-white hover:bg-teal-deep" : "bg-mist-soft text-ink/60 hover:text-ink")}>{label}</button>
    </form>
  );
}

function TabLink({ active, tab, icon, label }: { active: boolean; tab: LeadsTab; icon: React.ReactNode; label: string }) {
  return (
    <Link href={`/app/leads?tab=${tab}`} prefetch className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink")}>
      {icon}{label}
    </Link>
  );
}

// 並べ替え可能な見出しセル(HP問合せタブ)。押すと昇順/降順トグル、矢印で状態表示。
function SortTh({ label, col, sortKey, sortDir, onSort }: { label: string; col: string; sortKey: string; sortDir: string; onSort: (col: string) => void }) {
  const active = sortKey === col;
  return (
    <th className="th">
      <button type="button" onClick={() => onSort(col)} className={cn("inline-flex items-center gap-0.5 hover:text-teal-deep", active && "text-teal-deep font-semibold")}>
        {label}
        <span className="text-[9px] leading-none">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
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
