"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { leanToOppView } from "@/lib/data/opps-page";
import { fetchOppsPageAction, type OppPageFilter } from "@/server/actions/opportunities";
import { YOMI_OPTIONS } from "@/lib/constants";
import { YomiBadge, StageBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { formatYen, formatDate, daysSince, cn } from "@/lib/utils";
import { InlineYomi, InlineAmount, InlineNextDate, type OnEdited } from "./opp-inline";

interface Option { id: string; name: string; }
type SortKey = "expected_close_date" | "amount" | "probability" | "last_activity_at";
const PAGE = 50;

export function OppPaginatedTable({
  initialRows,
  initialTotal,
  initialSumAmount,
  initialSumWeighted,
  owners,
  products,
  sources,
  campaigns = [],
}: {
  initialRows: OppView[];
  initialTotal: number;
  initialSumAmount: number;
  initialSumWeighted: number;
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns?: Option[];
}) {
  const [q, setQ] = useState("");
  const [yomiSel, setYomiSel] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [onlyNoNext, setOnlyNoNext] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [sort, setSort] = useState<SortKey>("expected_close_date");
  const [asc, setAsc] = useState(true);

  const [rows, setRows] = useState<OppView[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [sumAmount, setSumAmount] = useState(initialSumAmount);
  const [sumWeighted, setSumWeighted] = useState(initialSumWeighted);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialRows.length);
  const hasMore = rows.length < total;

  const filter: OppPageFilter = useMemo(
    () => ({
      q: q.trim() || undefined,
      yomi: yomiSel.length ? yomiSel : undefined,
      owner: owner || undefined,
      product: product || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
      only_no_next: onlyNoNext || undefined,
      only_stale: onlyStale || undefined,
    }),
    [q, yomiSel, owner, product, source, campaign, onlyNoNext, onlyStale],
  );

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      const res = await fetchOppsPageAction({ filter, sort, asc, offset, limit: PAGE });
      const views = res.rows.map(leanToOppView);
      offsetRef.current = offset + views.length;
      setRows((prev) => (replace ? views : [...prev, ...views]));
      setTotal(res.total);
      setSumAmount(res.sum_amount);
      setSumWeighted(res.sum_weighted);
      setLoading(false);
    },
    [filter, sort, asc],
  );

  // フィルタ/ソート変更で先頭から再取得(検索語はデバウンス)。初回マウントはSSR結果を使う。
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { offsetRef.current = 0; load(0, true); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  // 無限スクロール(下端の監視)。
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) load(offsetRef.current, false);
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, load]);

  const applyEdit: OnEdited = (id, patch, updatedAt) =>
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch, updated_at: updatedAt } as OppView;
      merged.weighted = Math.round((merged.amount * merged.probability) / 100);
      return merged;
    }));

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((a) => !a);
    else { setSort(key); setAsc(key === "expected_close_date"); }
  }

  return (
    <div className="space-y-4">
      {/* フィルタ */}
      <div className="card card-pad space-y-3">
        <div className="relative max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件名・顧客名で検索" className="input pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiSelect label="ヨミ" options={YOMI_OPTIONS.map((y) => ({ id: y.key, name: y.label }))} selected={yomiSel} onChange={setYomiSel} />
          <Sel value={owner} onChange={setOwner} placeholder="担当営業" options={owners} />
          <Sel value={product} onChange={setProduct} placeholder="商材" options={products} />
          <Sel value={source} onChange={setSource} placeholder="流入経路" options={sources} />
          {campaigns.length > 0 && <Sel value={campaign} onChange={setCampaign} placeholder="展示会・施策" options={campaigns} />}
          <Toggle active={onlyNoNext} onClick={() => setOnlyNoNext((v) => !v)} label="次アクション未設定" />
          <Toggle active={onlyStale} onClick={() => setOnlyStale((v) => !v)} label="放置案件" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{total}件</span>
        <span>合計 <b className="text-ink">{formatYen(sumAmount)}</b></span>
        <span>Weighted <b className="text-teal-deep">{formatYen(sumWeighted)}</b></span>
        <span className="text-xs text-ink/35">表示 {rows.length}件</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客 / 案件</th>
              <th className="th">ヨミ</th>
              <th className="th">担当</th>
              <th className="th">商材</th>
              <th className="th">展示会 / 施策</th>
              <SortTh label="金額" onClick={() => toggleSort("amount")} active={sort === "amount"} asc={asc} align="right" />
              <th className="th">ステージ</th>
              <SortTh label="確度" onClick={() => toggleSort("probability")} active={sort === "probability"} asc={asc} align="right" />
              <SortTh label="受注予定" onClick={() => toggleSort("expected_close_date")} active={sort === "expected_close_date"} asc={asc} />
              <th className="th">次アクション</th>
              <th className="th">メモ</th>
              <SortTh label="最終活動" onClick={() => toggleSort("last_activity_at")} active={sort === "last_activity_at"} asc={asc} />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((o) => {
              const since = daysSince(o.last_activity_at);
              return (
                <tr key={o.id} className="row-hover">
                  <td className="td max-w-[240px]">
                    <Link href={`/app/opportunities/${o.id}`} className="block">
                      <span className="font-medium text-ink hover:text-teal-deep truncate block">{o.account?.name}</span>
                      <span className="text-xs text-ink/45 truncate block">{o.name}</span>
                    </Link>
                  </td>
                  <td className="td"><InlineYomi opp={o} onEdited={applyEdit} /></td>
                  <td className="td"><div className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} /><span className="text-xs">{o.owner?.name}</span></div></td>
                  <td className="td text-xs text-ink/70">{o.product?.name ?? "—"}</td>
                  <td className="td text-xs max-w-[150px]">
                    {o.campaign ? <span className="truncate text-ink/70 block">{o.campaign.name}</span> : <span className="text-ink/30">{o.leadSource?.name ?? "—"}</span>}
                  </td>
                  <td className="td text-right font-semibold tabular-nums"><InlineAmount opp={o} onEdited={applyEdit} /></td>
                  <td className="td"><StageBadge stage={o.stage} /></td>
                  <td className="td text-right tabular-nums">{o.probability}%</td>
                  <td className="td text-xs">{formatDate(o.expected_close_date)}</td>
                  <td className="td"><InlineNextDate opp={o} onEdited={applyEdit} /></td>
                  <td className="td max-w-[220px]">{o.notes ? <span className="block truncate text-xs text-ink/55" title={o.notes}>{o.notes}</span> : <span className="text-ink/25 text-xs">—</span>}</td>
                  <td className="td"><span className={cn("text-xs", since != null && since >= 7 ? "text-rose-500 font-medium" : "text-ink/50")}>{since != null ? `${since}日前` : "—"}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={12} className="td text-center text-ink/40 py-10">条件に一致する案件がありません</td></tr>
            )}
          </tbody>
        </table>
        {/* 無限スクロールの監視点 */}
        <div ref={sentinel} className="h-10 flex items-center justify-center">
          {loading && <span className="inline-flex items-center gap-2 text-xs text-ink/40"><Loader2 size={14} className="animate-spin" /> 読み込み中…</span>}
          {!loading && !hasMore && rows.length > 0 && <span className="text-[11px] text-ink/30">すべて表示しました</span>}
        </div>
      </div>
    </div>
  );
}

function Sel({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: Option[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
      <option value="">{placeholder}：すべて</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("pill border transition-colors", active ? "bg-accent-orange text-white border-accent-orange" : "bg-white text-ink/60 border-black/10")}>{label}</button>
  );
}

function SortTh({ label, onClick, active, asc, align = "left" }: { label: string; onClick: () => void; active: boolean; asc: boolean; align?: "left" | "right" }) {
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={onClick}>
      <span className={cn(active && "text-teal-primary")}>{label}{active ? (asc ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}

function MultiSelect({ label, options, selected, onChange }: { label: string; options: Option[]; selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]); }
  const summary = selected.length === 0 ? `${label}：すべて` : `${label}：${selected.length}件`;
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer select-none rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className={selected.length ? "text-teal-deep font-medium" : ""}>{summary}</span>
        <ChevronDown size={13} className="text-ink/40" />
      </summary>
      <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-black/10 bg-white shadow-lg p-2">
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
