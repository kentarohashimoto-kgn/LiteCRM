"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { OppView } from "@/lib/data/store";
import { STAGES, FORECAST_CATEGORIES } from "@/lib/constants";
import { ForecastBadge, RiskBadge, StageBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { formatYen, formatDate, daysSince, cn } from "@/lib/utils";
import { isStale, noNextAction } from "@/lib/risk";

type SortKey = "amount" | "expected_close_date" | "last_activity_at" | "probability";

interface Option {
  id: string;
  name: string;
}

export function OppTable({
  opps,
  owners,
  products,
  sources,
}: {
  opps: OppView[];
  owners: Option[];
  products: Option[];
  sources: Option[];
}) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [forecast, setForecast] = useState("");
  const [owner, setOwner] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [onlyNoNext, setOnlyNoNext] = useState(false);
  const [sort, setSort] = useState<SortKey>("expected_close_date");
  const [asc, setAsc] = useState(true);

  const filtered = useMemo(() => {
    let list = opps.filter((o) => {
      if (q && !(`${o.name} ${o.account?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
      if (stage && o.stage !== stage) return false;
      if (forecast && o.forecast_category !== forecast) return false;
      if (owner && o.owner_user_id !== owner) return false;
      if (product && o.primary_product_id !== product) return false;
      if (source && o.lead_source_id !== source) return false;
      if (onlyStale && !isStale(o)) return false;
      if (onlyNoNext && !noNextAction(o)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const av = sortVal(a, sort);
      const bv = sortVal(b, sort);
      return asc ? av - bv : bv - av;
    });
    return list;
  }, [opps, q, stage, forecast, owner, product, source, onlyStale, onlyNoNext, sort, asc]);

  const totalAmount = filtered.reduce((s, o) => s + o.amount, 0);
  const totalWeighted = filtered.reduce((s, o) => s + o.weighted, 0);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc(!asc);
    else {
      setSort(key);
      setAsc(true);
    }
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
              placeholder="商談名・顧客名で検索"
              className="input pl-9"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={stage} onChange={setStage} placeholder="ステージ" options={STAGES.map((s) => ({ id: s.key, name: s.label }))} />
          <Select value={forecast} onChange={setForecast} placeholder="ヨミ" options={FORECAST_CATEGORIES.map((f) => ({ id: f.key, name: f.label }))} />
          <Select value={owner} onChange={setOwner} placeholder="担当営業" options={owners} />
          <Select value={product} onChange={setProduct} placeholder="商材" options={products} />
          <Select value={source} onChange={setSource} placeholder="流入経路" options={sources} />
          <Toggle active={onlyNoNext} onClick={() => setOnlyNoNext((v) => !v)} label="次アクション未設定" />
          <Toggle active={onlyStale} onClick={() => setOnlyStale((v) => !v)} label="放置案件" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{filtered.length}件</span>
        <span>合計 <b className="text-ink">{formatYen(totalAmount)}</b></span>
        <span>Weighted <b className="text-teal-deep">{formatYen(totalWeighted)}</b></span>
      </div>

      {/* テーブル */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客 / 商談</th>
              <th className="th">担当</th>
              <th className="th">商材</th>
              <SortableTh label="金額" onClick={() => toggleSort("amount")} active={sort === "amount"} asc={asc} align="right" />
              <th className="th">ステージ</th>
              <th className="th">ヨミ</th>
              <SortableTh label="確度" onClick={() => toggleSort("probability")} active={sort === "probability"} asc={asc} align="right" />
              <SortableTh label="受注予定" onClick={() => toggleSort("expected_close_date")} active={sort === "expected_close_date"} asc={asc} />
              <th className="th">次アクション</th>
              <SortableTh label="最終活動" onClick={() => toggleSort("last_activity_at")} active={sort === "last_activity_at"} asc={asc} />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {filtered.map((o) => {
              const since = daysSince(o.last_activity_at);
              return (
                <tr key={o.id} className="row-hover">
                  <td className="td max-w-[260px]">
                    <Link href={`/app/opportunities/${o.id}`} className="block">
                      <span className="font-medium text-ink hover:text-teal-deep truncate block">{o.account?.name}</span>
                      <span className="text-xs text-ink/45 truncate block">{o.name}</span>
                    </Link>
                  </td>
                  <td className="td"><div className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} /><span className="text-xs">{o.owner?.name}</span></div></td>
                  <td className="td text-xs text-ink/70">{o.product?.name ?? "—"}</td>
                  <td className="td text-right font-semibold tabular-nums">{formatYen(o.amount)}</td>
                  <td className="td"><StageBadge stage={o.stage} /></td>
                  <td className="td"><ForecastBadge category={o.forecast_category} /></td>
                  <td className="td text-right tabular-nums">{o.probability}%</td>
                  <td className="td text-xs">{formatDate(o.expected_close_date)}</td>
                  <td className="td">
                    {o.next_action_date ? (
                      <span className="text-xs">{formatDate(o.next_action_date)}</span>
                    ) : (
                      <span className="pill bg-amber-50 text-accent-orange text-[10px]">未設定</span>
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="td text-center text-ink/40 py-10">条件に一致する商談がありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
