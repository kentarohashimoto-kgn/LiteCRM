"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { STAGES, YOMI_OPTIONS } from "@/lib/constants";
import { YomiBadge, RiskBadge, StageBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { formatYen, formatDate, daysSince, cn } from "@/lib/utils";
import { isStale, noNextAction } from "@/lib/risk";
import { matchesCompanyQuery } from "@/lib/company-name";
import { InlineYomi, InlineAmount, InlineNextDate, NextDateReadonly, type OnEdited } from "./opp-inline";

type SortKey = "amount" | "expected_close_date" | "last_activity_at" | "probability";

const COL_COUNT = 12;

interface Option {
  id: string;
  name: string;
}

function yomiOrder(y?: string): number {
  const i = YOMI_OPTIONS.findIndex((o) => o.key === y);
  return i === -1 ? 99 : i;
}

export function OppTable({
  opps,
  owners,
  products,
  sources,
  campaigns = [],
  onEdited,
}: {
  opps: OppView[];
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns?: Option[];
  onEdited?: OnEdited;
}) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [yomiSel, setYomiSel] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [onlyNoNext, setOnlyNoNext] = useState(false);
  const [sort, setSort] = useState<SortKey>("expected_close_date");
  const [asc, setAsc] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return opps.filter((o) => {
      // 案件名＋顧客名に対し、法人格や全半角の違いを吸収して照合(従来の部分一致も維持)
      if (!matchesCompanyQuery(`${o.name} ${o.account?.name ?? ""}`, q)) return false;
      if (stage && o.stage !== stage) return false;
      if (yomiSel.length && !yomiSel.includes(o.yomi ?? "")) return false;
      if (owner && o.owner_user_id !== owner) return false;
      if (product && o.primary_product_id !== product) return false;
      if (source && o.lead_source_id !== source) return false;
      if (campaign && (o.source_detail ?? "") !== campaign) return false;
      if (onlyStale && !isStale(o)) return false;
      if (onlyNoNext && !noNextAction(o)) return false;
      return true;
    });
  }, [opps, q, stage, yomiSel, owner, product, source, campaign, onlyStale, onlyNoNext]);

  // ヨミ昇順でグループ化。各グループ内は選択中の列でソート。
  const groups = useMemo(() => {
    const map = new Map<string, OppView[]>();
    for (const o of filtered) {
      const key = o.yomi ?? "";
      const arr = map.get(key);
      if (arr) arr.push(o);
      else map.set(key, [o]);
    }
    const entries = [...map.entries()].sort((a, b) => yomiOrder(a[0] || undefined) - yomiOrder(b[0] || undefined));
    for (const [, list] of entries) {
      list.sort((a, b) => (asc ? sortVal(a, sort) - sortVal(b, sort) : sortVal(b, sort) - sortVal(a, sort)));
    }
    return entries;
  }, [filtered, sort, asc]);

  const totalAmount = filtered.reduce((s, o) => s + o.amount, 0);
  const totalWeighted = filtered.reduce((s, o) => s + o.weighted, 0);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc(!asc);
    else {
      setSort(key);
      setAsc(true);
    }
  }
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const allCollapsed = groups.length > 0 && groups.every(([k]) => collapsed.has(k));
  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map(([k]) => k)));
  }

  return (
    <div className="space-y-4">
      {/* フィルタ */}
      <div className="card card-pad space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="案件名・顧客名で検索"
              className="input pl-9"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiSelect
            label="ヨミ"
            options={YOMI_OPTIONS.map((y) => ({ id: y.key, name: y.label }))}
            selected={yomiSel}
            onChange={setYomiSel}
          />
          <Select value={stage} onChange={setStage} placeholder="ステージ" options={STAGES.map((s) => ({ id: s.key, name: s.label }))} />
          <Select value={owner} onChange={setOwner} placeholder="担当営業" options={owners} />
          <Select value={product} onChange={setProduct} placeholder="商材" options={products} />
          <Select value={source} onChange={setSource} placeholder="流入経路" options={sources} />
          {campaigns.length > 0 && (
            <Select value={campaign} onChange={setCampaign} placeholder="展示会・施策" options={campaigns} />
          )}
          <Toggle active={onlyNoNext} onClick={() => setOnlyNoNext((v) => !v)} label="次アクション未設定" />
          <Toggle active={onlyStale} onClick={() => setOnlyStale((v) => !v)} label="放置案件" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{filtered.length}件</span>
        <span>合計 <b className="text-ink">{formatYen(totalAmount)}</b></span>
        <span>Weighted <b className="text-teal-deep">{formatYen(totalWeighted)}</b></span>
        <button onClick={toggleAll} className="ml-auto text-xs text-teal-deep hover:underline">
          {allCollapsed ? "すべて展開" : "すべて折りたたむ"}
        </button>
      </div>

      {/* テーブル */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客 / 案件</th>
              <th className="th">ヨミ</th>
              <th className="th">担当</th>
              <th className="th">商材</th>
              <th className="th">展示会 / 施策</th>
              <SortableTh label="金額" onClick={() => toggleSort("amount")} active={sort === "amount"} asc={asc} align="right" />
              <th className="th">ステージ</th>
              <SortableTh label="確度" onClick={() => toggleSort("probability")} active={sort === "probability"} asc={asc} align="right" />
              <SortableTh label="受注予定" onClick={() => toggleSort("expected_close_date")} active={sort === "expected_close_date"} asc={asc} />
              <th className="th">次アクション</th>
              <th className="th">メモ</th>
              <SortableTh label="最終活動" onClick={() => toggleSort("last_activity_at")} active={sort === "last_activity_at"} asc={asc} />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {groups.map(([key, list]) => {
              const isOpen = !collapsed.has(key);
              const groupAmount = list.reduce((s, o) => s + o.amount, 0);
              return (
                <GroupRows
                  key={key || "__none"}
                  groupKey={key}
                  list={list}
                  isOpen={isOpen}
                  groupAmount={groupAmount}
                  onToggle={() => toggleGroup(key)}
                  onEdited={onEdited}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="td text-center text-ink/40 py-10">条件に一致する案件がありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({
  groupKey,
  list,
  isOpen,
  groupAmount,
  onToggle,
  onEdited,
}: {
  groupKey: string;
  list: OppView[];
  isOpen: boolean;
  groupAmount: number;
  onToggle: () => void;
  onEdited?: OnEdited;
}) {
  return (
    <>
      <tr className="bg-mist-soft/50 border-y border-black/[0.04] cursor-pointer select-none hover:bg-mist-soft" onClick={onToggle}>
        <td colSpan={COL_COUNT} className="px-4 py-2">
          <div className="flex items-center gap-2">
            {isOpen ? <ChevronDown size={15} className="text-ink/40" /> : <ChevronRight size={15} className="text-ink/40" />}
            {groupKey ? <YomiBadge yomi={groupKey} /> : <span className="pill bg-mist-soft text-ink/40">ヨミ未設定</span>}
            <span className="text-xs text-ink/50">{list.length}件</span>
            <span className="text-xs text-ink/40">合計 {formatYen(groupAmount)}</span>
          </div>
        </td>
      </tr>
      {isOpen &&
        list.map((o) => {
          const since = daysSince(o.last_activity_at);
          return (
            <tr key={o.id} className="row-hover">
              <td className="td max-w-[240px]">
                <Link href={`/app/opportunities/${o.id}`} className="block">
                  <span className="font-medium text-ink hover:text-teal-deep truncate block">{o.account?.name}</span>
                  <span className="text-xs text-ink/45 truncate block">{o.name}</span>
                </Link>
              </td>
              <td className="td">{onEdited ? <InlineYomi opp={o} onEdited={onEdited} /> : <YomiBadge yomi={o.yomi} />}</td>
              <td className="td"><div className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} /><span className="text-xs">{o.owner?.name}</span></div></td>
              <td className="td text-xs text-ink/70">{o.product?.name ?? "—"}</td>
              <td className="td text-xs max-w-[150px]">
                {o.source_detail ? (
                  <span className="truncate text-ink/70 block" title={o.source_detail}>{o.source_detail}</span>
                ) : o.campaign ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate text-ink/70">{o.campaign.name}</span>
                    {o.campaign_estimated && (
                      <span className="pill bg-mist-soft text-ink/40 text-[9px] shrink-0" title="作成日からの自動推定。修正可能です。">推定</span>
                    )}
                  </span>
                ) : (
                  <span className="text-ink/30">{o.leadSource?.name ?? "—"}</span>
                )}
              </td>
              <td className="td text-right font-semibold tabular-nums">{onEdited ? <InlineAmount opp={o} onEdited={onEdited} /> : formatYen(o.amount)}</td>
              <td className="td"><StageBadge stage={o.stage} /></td>
              <td className="td text-right tabular-nums">{o.probability}%</td>
              <td className="td text-xs">{formatDate(o.expected_close_date)}</td>
              <td className="td">
                {onEdited ? <InlineNextDate opp={o} onEdited={onEdited} /> : <NextDateReadonly date={o.next_action_date} />}
              </td>
              <td className="td max-w-[220px]">
                {o.notes ? (
                  <span className="block truncate text-xs text-ink/55" title={o.notes}>{o.notes}</span>
                ) : (
                  <span className="text-ink/25 text-xs">—</span>
                )}
              </td>
              <td className="td">
                <span className={cn("text-xs", since != null && since >= 7 ? "text-rose-500 font-medium" : "text-ink/50")}>
                  {since != null ? `${since}日前` : "—"}
                </span>
                {o.risk_level === "high" && <span className="ml-1"><RiskBadge level="high" /></span>}
              </td>
            </tr>
          );
        })}
    </>
  );
}

function sortVal(o: OppView, key: SortKey): number {
  if (key === "amount") return o.amount;
  if (key === "probability") return o.probability;
  if (key === "expected_close_date") return o.expected_close_date ? +new Date(o.expected_close_date) : 0;
  return o.last_activity_at ? +new Date(o.last_activity_at) : 0;
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: Option[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
      <option value="">{placeholder}：すべて</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  const summary = selected.length === 0 ? `${label}：すべて` : `${label}：${selected.length}件`;
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer select-none rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm marker:hidden flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className={selected.length ? "text-teal-deep font-medium" : ""}>{summary}</span>
        <ChevronDown size={13} className="text-ink/40" />
      </summary>
      <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-black/10 bg-white shadow-lg p-2">
        <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-black/[0.05]">
          <span className="text-[11px] text-ink/40">{label}を選択</span>
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="text-[11px] text-teal-deep hover:underline">クリア</button>
          )}
        </div>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-mist-soft rounded-lg cursor-pointer">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="accent-teal-primary" />
            {o.name}
          </label>
        ))}
      </div>
    </details>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("pill border transition-colors", active ? "bg-accent-orange text-white border-accent-orange" : "bg-white text-ink/60 border-black/10")}>
      {label}
    </button>
  );
}

function SortableTh({ label, onClick, active, asc, align = "left" }: { label: string; onClick: () => void; active: boolean; asc: boolean; align?: "left" | "right" }) {
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={onClick}>
      <span className={cn(active && "text-teal-primary")}>{label}{active ? (asc ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}
