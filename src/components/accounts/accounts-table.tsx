"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { ACCOUNT_RANKS, ACCOUNT_FOCUS, RANK_ORDER, FOCUS_ORDER } from "@/lib/constants";
import { setAccountRankAction, setAccountFocusAction, setAccountOwnerAction } from "@/server/actions";
import { formatYen, cn } from "@/lib/utils";
import { matchesCompanyQuery } from "@/lib/company-name";

export interface AccountRow {
  id: string;
  name: string;
  industry?: string;
  area?: string;
  status: string;
  rank?: string;
  focus?: string;
  ownerId?: string;
  lifetimeRevenue: number;
  openAmount: number;
  oppCount: number;
  isActive: boolean;
}

interface Owner {
  id: string;
  name: string;
}

type SortKey = "revenue" | "openAmount" | "oppCount" | "rank" | "focus" | "name";

const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

export function AccountsTable({ rows, owners = [] }: { rows: AccountRow[]; owners?: Owner[] }) {
  const [q, setQ] = useState("");
  const [rank, setRank] = useState("");
  const [focus, setFocus] = useState("");
  const [area, setArea] = useState("");
  const [industry, setIndustry] = useState("");
  const [owner, setOwner] = useState("");
  const [active, setActive] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  const ownerName = useMemo(() => new Map(owners.map((o) => [o.id, o.name])), [owners]);
  const areaOptions = useMemo(() => uniqueSorted(rows.map((r) => r.area)), [rows]);
  const industryOptions = useMemo(() => uniqueSorted(rows.map((r) => r.industry)), [rows]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      // 法人格の有無・全半角・かなの違いを吸収して照合(DB側の company_search_key と同一規則)
      if (!matchesCompanyQuery(r.name, q)) return false;
      if (rank && r.rank !== rank) return false;
      if (focus && r.focus !== focus) return false;
      if (area && r.area !== area) return false;
      if (industry && r.industry !== industry) return false;
      if (owner && (owner === "__none" ? r.ownerId : r.ownerId !== owner)) return false;
      if (active === "active" && !r.isActive) return false;
      if (active === "inactive" && r.isActive) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const v = cmp(a, b, sort);
      return asc ? v : -v;
    });
  }, [rows, q, rank, focus, area, industry, owner, active, sort, asc]);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc(!asc);
    else {
      setSort(key);
      setAsc(key === "name" || key === "rank" || key === "focus"); // 文字系は昇順から
    }
  }

  const totalRevenue = filtered.reduce((s, r) => s + r.lifetimeRevenue, 0);
  const totalOpen = filtered.reduce((s, r) => s + r.openAmount, 0);

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社名で検索" className="input pl-9" />
        </div>
        <FilterSelect value={rank} onChange={setRank} placeholder="ランク" options={ACCOUNT_RANKS.map((r) => ({ id: r.key, name: r.key }))} />
        <FilterSelect value={focus} onChange={setFocus} placeholder="重点" options={ACCOUNT_FOCUS.map((f) => ({ id: f.key, name: f.label }))} />
        <FilterSelect value={area} onChange={setArea} placeholder="エリア" options={areaOptions.map((a) => ({ id: a, name: a }))} />
        <FilterSelect value={industry} onChange={setIndustry} placeholder="業種" options={industryOptions.map((i) => ({ id: i, name: i }))} />
        {owners.length > 0 && (
          <FilterSelect
            value={owner}
            onChange={setOwner}
            placeholder="担当営業"
            options={[{ id: "__none", name: "未割当" }, ...owners.map((o) => ({ id: o.id, name: o.name }))]}
          />
        )}
        <select value={active} onChange={(e) => setActive(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">状況：すべて</option>
          <option value="active">アクティブのみ</option>
          <option value="inactive">非アクティブのみ</option>
        </select>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{filtered.length}社</span>
        <span>累積売上 <b className="stat-accent">{formatYen(totalRevenue)}</b></span>
        <span>進行中見込 <b className="text-teal-deep">{formatYen(totalOpen)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <SortTh label="会社名" k="name" sort={sort} asc={asc} onClick={toggleSort} />
              <SortTh label="ランク" k="rank" sort={sort} asc={asc} onClick={toggleSort} />
              <SortTh label="重点" k="focus" sort={sort} asc={asc} onClick={toggleSort} />
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
            {filtered.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td max-w-[260px]">
                  <Link href={`/app/accounts/${r.id}`} className="font-medium text-ink hover:text-teal-deep truncate block">{r.name}</Link>
                </td>
                <td className="td">
                  <form action={setAccountRankAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <select name="rank" defaultValue={r.rank ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                      <option value="">—</option>
                      {ACCOUNT_RANKS.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}
                    </select>
                  </form>
                </td>
                <td className="td">
                  <form action={setAccountFocusAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <select name="focus" defaultValue={r.focus ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
                      <option value="">—</option>
                      {ACCOUNT_FOCUS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </form>
                </td>
                <td className="td">
                  {owners.length > 0 ? (
                    <form action={setAccountOwnerAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <select name="owner_user_id" defaultValue={r.ownerId ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary max-w-[110px]">
                        <option value="">未割当</option>
                        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </form>
                  ) : (
                    <span className="text-xs text-ink/40">{r.ownerId ? ownerName.get(r.ownerId) ?? "—" : "—"}</span>
                  )}
                </td>
                <td className="td"><span className="pill bg-mist-soft text-ink/60 text-[11px]">{statusLabel[r.status] ?? r.status}</span></td>
                <td className="td">
                  {r.isActive ? (
                    <span className="pill bg-teal-light text-teal-deep text-[11px]">アクティブ</span>
                  ) : (
                    <span className="pill bg-mist-soft text-ink/40 text-[11px]">非アクティブ</span>
                  )}
                </td>
                <td className="td text-right tabular-nums">{r.oppCount}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.lifetimeRevenue)}</td>
                <td className="td text-right tabular-nums text-teal-deep">{formatYen(r.openAmount)}</td>
                <td className="td text-xs text-ink/55">{[r.area, r.industry].filter(Boolean).join(" / ") || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="td text-center text-ink/40 py-10">条件に一致する顧客がありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function uniqueSorted(vals: (string | undefined)[]): string[] {
  return Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== ""))).sort((a, b) => a.localeCompare(b, "ja"));
}

function cmp(a: AccountRow, b: AccountRow, key: SortKey): number {
  switch (key) {
    case "revenue": return a.lifetimeRevenue - b.lifetimeRevenue;
    case "openAmount": return a.openAmount - b.openAmount;
    case "oppCount": return a.oppCount - b.oppCount;
    case "rank": return (RANK_ORDER[a.rank ?? ""] ?? 9) - (RANK_ORDER[b.rank ?? ""] ?? 9);
    case "focus": return (FOCUS_ORDER[a.focus ?? ""] ?? 9) - (FOCUS_ORDER[b.focus ?? ""] ?? 9);
    case "name": return a.name.localeCompare(b.name, "ja");
    default: return 0;
  }
}

function SortTh({ label, k, sort, asc, onClick, align = "left" }: { label: string; k: SortKey; sort: SortKey; asc: boolean; onClick: (k: SortKey) => void; align?: "left" | "right" }) {
  const activeCol = sort === k;
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={() => onClick(k)}>
      <span className={cn(activeCol && "text-teal-primary")}>{label}{activeCol ? (asc ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: { id: string; name: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
      <option value="">{placeholder}：すべて</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
