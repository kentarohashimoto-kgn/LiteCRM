"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2 } from "lucide-react";
import { ACCOUNT_RANKS, ACCOUNT_FOCUS } from "@/lib/constants";
import { fetchAccountsPageAction, setAccountFieldAction } from "@/server/actions/accounts";
import type { AccountPageRow, AccountPageFilter } from "@/lib/data/accounts-page";
import { formatYen, cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type SortKey = "revenue" | "openAmount" | "oppCount" | "name" | "rank";
const PAGE = 50;
const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

export function AccountsPaginatedTable({
  initialRows,
  initialTotal,
  owners,
  areas,
  industries,
}: {
  initialRows: AccountPageRow[];
  initialTotal: number;
  owners: Option[];
  areas: string[];
  industries: string[];
}) {
  const [q, setQ] = useState("");
  const [rank, setRank] = useState("");
  const [focus, setFocus] = useState("");
  const [area, setArea] = useState("");
  const [industry, setIndustry] = useState("");
  const [owner, setOwner] = useState("");
  const [active, setActive] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  const [rows, setRows] = useState<AccountPageRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialRows.length);
  const hasMore = rows.length < total;

  const filter: AccountPageFilter = useMemo(
    () => ({
      q: q.trim() || undefined,
      rank: rank || undefined,
      focus: focus || undefined,
      area: area || undefined,
      industry: industry || undefined,
      owner: owner || undefined,
      active: active || undefined,
    }),
    [q, rank, focus, area, industry, owner, active],
  );

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      const res = await fetchAccountsPageAction({ filter, sort, asc, offset, limit: PAGE });
      offsetRef.current = offset + res.rows.length;
      setRows((prev) => (replace ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
      setLoading(false);
    },
    [filter, sort, asc],
  );

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { offsetRef.current = 0; load(0, true); }, 250);
    return () => clearTimeout(t);
  }, [load]);

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

  function setField(id: string, field: "rank" | "focus" | "owner_user_id", value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value || null } : r)));
    setAccountFieldAction({ id, field, value: value || null });
  }
  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((a) => !a);
    else { setSort(key); setAsc(key === "name" || key === "rank"); }
  }

  const shownRevenue = rows.reduce((s, r) => s + r.lifetime_revenue, 0);
  const shownOpen = rows.reduce((s, r) => s + r.open_amount, 0);

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社名で検索" className="input pl-9" />
        </div>
        <Sel value={rank} onChange={setRank} placeholder="ランク" options={ACCOUNT_RANKS.map((r) => ({ id: r.key, name: r.key }))} />
        <Sel value={focus} onChange={setFocus} placeholder="重点" options={ACCOUNT_FOCUS.map((f) => ({ id: f.key, name: f.label }))} />
        <Sel value={area} onChange={setArea} placeholder="エリア" options={areas.map((a) => ({ id: a, name: a }))} />
        <Sel value={industry} onChange={setIndustry} placeholder="業種" options={industries.map((i) => ({ id: i, name: i }))} />
        {owners.length > 0 && <Sel value={owner} onChange={setOwner} placeholder="担当営業" options={[{ id: "__none", name: "未割当" }, ...owners]} />}
        <select value={active} onChange={(e) => setActive(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">状況：すべて</option>
          <option value="active">アクティブのみ</option>
          <option value="inactive">非アクティブのみ</option>
        </select>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{total}社</span>
        <span>累積売上 <b className="stat-accent">{formatYen(shownRevenue)}</b></span>
        <span>進行中見込 <b className="text-teal-deep">{formatYen(shownOpen)}</b></span>
        <span className="text-xs text-ink/35">表示 {rows.length}社</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <SortTh label="会社名" k="name" sort={sort} asc={asc} onClick={toggleSort} />
              <SortTh label="ランク" k="rank" sort={sort} asc={asc} onClick={toggleSort} />
              <th className="th">重点</th>
              <th className="th">担当営業</th>
              <th className="th">区分</th>
              <th className="th">ステータス</th>
              <SortTh label="案件数" k="oppCount" sort={sort} asc={asc} onClick={toggleSort} align="right" />
              <SortTh label="累積売上" k="revenue" sort={sort} asc={asc} onClick={toggleSort} align="right" />
              <SortTh label="進行中見込" k="openAmount" sort={sort} asc={asc} onClick={toggleSort} align="right" />
              <th className="th">エリア/業種</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td max-w-[260px]">
                  <Link href={`/app/accounts/${r.id}`} className="font-medium text-ink hover:text-teal-deep truncate block">{r.name}</Link>
                </td>
                <td className="td">
                  <select value={r.rank ?? ""} onChange={(e) => setField(r.id, "rank", e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                    <option value="">—</option>
                    {ACCOUNT_RANKS.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}
                  </select>
                </td>
                <td className="td">
                  <select value={r.focus ?? ""} onChange={(e) => setField(r.id, "focus", e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                    <option value="">—</option>
                    {ACCOUNT_FOCUS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </td>
                <td className="td">
                  <select value={r.owner_user_id ?? ""} onChange={(e) => setField(r.id, "owner_user_id", e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary max-w-[110px]">
                    <option value="">未割当</option>
                    {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
                <td className="td"><span className="pill bg-mist-soft text-ink/60 text-[11px]">{statusLabel[r.status] ?? r.status}</span></td>
                <td className="td">
                  {r.is_active ? <span className="pill bg-teal-light text-teal-deep text-[11px]">アクティブ</span> : <span className="pill bg-mist-soft text-ink/40 text-[11px]">非アクティブ</span>}
                </td>
                <td className="td text-right tabular-nums">{r.opp_count}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.lifetime_revenue)}</td>
                <td className="td text-right tabular-nums text-teal-deep">{formatYen(r.open_amount)}</td>
                <td className="td text-xs text-ink/55">{[r.area, r.industry].filter(Boolean).join(" / ") || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="td text-center text-ink/40 py-10">条件に一致する顧客がありません</td></tr>
            )}
          </tbody>
        </table>
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

function SortTh({ label, k, sort, asc, onClick, align = "left" }: { label: string; k: SortKey; sort: SortKey; asc: boolean; onClick: (k: SortKey) => void; align?: "left" | "right" }) {
  const activeCol = sort === k;
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={() => onClick(k)}>
      <span className={cn(activeCol && "text-teal-primary")}>{label}{activeCol ? (asc ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}
