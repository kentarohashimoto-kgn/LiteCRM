"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, ChevronDown, X, RotateCcw } from "lucide-react";
import { ACCOUNT_RANKS, ACCOUNT_FOCUS } from "@/lib/constants";
import { fetchAccountsPageAction, setAccountFieldAction } from "@/server/actions/accounts";
import type { AccountPageRow, AccountPageFilter } from "@/lib/data/accounts-page";
import { formatYen, cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type SortKey = "revenue" | "openAmount" | "oppCount" | "name" | "rank" | "engagement";
const PAGE = 50;
const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

// エンゲージランクの配色(リード一覧と同じ)と合計点の下限候補(ランク閾値に対応)
const ENG_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-amber-100 text-amber-700", B: "bg-teal-light text-teal-deep",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/35",
};
const ENG_MIN_OPTS = [
  { id: "1", name: "1pt以上（反応あり）" },
  { id: "3", name: "3pt以上（C相当）" },
  { id: "7", name: "7pt以上（B相当）" },
  { id: "15", name: "15pt以上（A相当）" },
  { id: "30", name: "30pt以上（S相当）" },
];

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
  // 各絞り込みは複数選択(OR)。空配列は絞り込みなし。
  const [rank, setRank] = useState<string[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  const [area, setArea] = useState<string[]>([]);
  const [industry, setIndustry] = useState<string[]>([]);
  const [owner, setOwner] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [engRank, setEngRank] = useState<string[]>([]);
  const [engMin, setEngMin] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  const hasActiveFilters =
    q.trim() !== "" || rank.length > 0 || focus.length > 0 || area.length > 0 || industry.length > 0 || owner.length > 0 || active !== "" || engRank.length > 0 || engMin !== "";

  function resetFilters() {
    setQ("");
    setRank([]);
    setFocus([]);
    setArea([]);
    setIndustry([]);
    setOwner([]);
    setActive("");
    setEngRank([]);
    setEngMin("");
  }

  const [rows, setRows] = useState<AccountPageRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialRows.length);
  const hasMore = rows.length < total;

  const filter: AccountPageFilter = useMemo(
    () => ({
      q: q.trim() || undefined,
      rank: rank.length ? rank : undefined,
      focus: focus.length ? focus : undefined,
      area: area.length ? area : undefined,
      industry: industry.length ? industry : undefined,
      owner: owner.length ? owner : undefined,
      active: active || undefined,
      engRank: engRank.length ? engRank : undefined,
      engMin: engMin || undefined,
    }),
    [q, rank, focus, area, industry, owner, active, engRank, engMin],
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
    else { setSort(key); setAsc(key === "name" || key === "rank"); }  // エンゲージ・金額系は降順始まり
  }

  // CSVエクスポート(現在の絞込条件で全件)
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    const res = await fetchAccountsPageAction({ filter, sort, asc, offset: 0, limit: 5000 });
    const header = ["会社名", "ランク", "重点", "担当営業", "区分", "アクティブ", "エンゲージランク", "エンゲージ点", "案件数", "累積売上", "進行中見込", "エリア", "業種"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = res.rows.map((r) => [
      r.name, r.rank ?? "", r.focus ?? "", r.owner_name ?? "", statusLabel[r.status] ?? r.status,
      r.is_active ? "アクティブ" : "非アクティブ", r.engagement_rank ?? "D", r.engagement_score ?? 0,
      r.opp_count, r.lifetime_revenue, r.open_amount, r.area ?? "", r.industry ?? "",
    ].map(escape).join(","));
    const csv = "\uFEFF" + header.map(escape).join(",") + "\n" + lines.join("\n"); // BOM付きUTF-8(Excel対応)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `顧客_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
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
        <MultiSelect selected={rank} onChange={setRank} placeholder="ランク" options={ACCOUNT_RANKS.map((r) => ({ id: r.key, name: r.key }))} />
        <MultiSelect selected={focus} onChange={setFocus} placeholder="重点" options={ACCOUNT_FOCUS.map((f) => ({ id: f.key, name: f.label }))} />
        <MultiSelect selected={area} onChange={setArea} placeholder="エリア" options={areas.map((a) => ({ id: a, name: a }))} />
        <MultiSelect selected={industry} onChange={setIndustry} placeholder="業種" options={industries.map((i) => ({ id: i, name: i }))} />
        {owners.length > 0 && <MultiSelect selected={owner} onChange={setOwner} placeholder="担当営業" options={[{ id: "__none", name: "未割当" }, ...owners]} />}
        <select value={active} onChange={(e) => setActive(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">状況：すべて</option>
          <option value="active">アクティブのみ</option>
          <option value="inactive">非アクティブのみ</option>
        </select>
        <MultiSelect selected={engRank} onChange={setEngRank} placeholder="エンゲージ" options={["S", "A", "B", "C", "D"].map((x) => ({ id: x, name: x === "D" ? "D（反応なし含む）" : x }))} />
        <select value={engMin} onChange={(e) => setEngMin(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">反応スコア：すべて</option>
          {ENG_MIN_OPTS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button
          type="button"
          onClick={resetFilters}
          disabled={!hasActiveFilters}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm text-ink/60 hover:bg-black/[0.03] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw size={14} /> 絞り込みをリセット
        </button>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{total}社</span>
        <span>累積売上 <b className="stat-accent">{formatYen(shownRevenue)}</b></span>
        <span>進行中見込 <b className="text-teal-deep">{formatYen(shownOpen)}</b></span>
        <span className="text-xs text-ink/35">表示 {rows.length}社</span>
        <button type="button" onClick={exportCsv} disabled={exporting} className="ml-auto text-xs text-teal-deep hover:underline">
          {exporting ? "出力中…" : "CSV出力（絞込済 全件）"}
        </button>
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
              <SortTh label="エンゲージ" k="engagement" sort={sort} asc={asc} onClick={toggleSort} />
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
                <td className="td">
                  <span className={cn("pill text-[10px] tabular-nums", ENG_COLOR[r.engagement_rank ?? "D"] ?? ENG_COLOR.D)} title={`エンゲージメント ${r.engagement_score ?? 0}pt`}>{r.engagement_rank ?? "D"}</span>
                  <span className="ml-1 text-[10px] text-ink/45 tabular-nums">{r.engagement_score ?? 0}pt</span>
                </td>
                <td className="td text-right tabular-nums">{r.opp_count}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.lifetime_revenue)}</td>
                <td className="td text-right tabular-nums text-teal-deep">{formatYen(r.open_amount)}</td>
                <td className="td text-xs text-ink/55">{[r.area, r.industry].filter(Boolean).join(" / ") || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={11} className="td text-center text-ink/40 py-10">条件に一致する顧客がありません</td></tr>
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

/**
 * 1つのプルダウンで複数選択できる絞り込み。ボタンを押すとチェックボックス一覧が開き、
 * 選んだ項目は OR で絞り込まれる。外側クリック・Escで閉じる。
 */
function MultiSelect({
  selected,
  onChange,
  placeholder,
  options,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  options: Option[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  const label =
    selected.length === 0
      ? `${placeholder}：すべて`
      : selected.length <= 2
        ? `${placeholder}：${selected.map(nameOf).join("・")}`
        : `${placeholder}：${nameOf(selected[0])} 他${selected.length - 1}件`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-sm outline-none",
          selected.length > 0 ? "border-teal-primary text-teal-deep" : "border-black/10 text-ink/70",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="max-w-[180px] truncate">{label}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`${placeholder}の選択をクリア`}
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange([]); } }}
            className="text-ink/40 hover:text-rose-500"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={14} className="text-ink/40" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-56 overflow-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg" role="listbox">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink/40">選択肢がありません</div>
          ) : (
            options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-black/[0.04]"
                  role="option"
                  aria-selected={on}
                >
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-teal-primary bg-teal-primary text-white" : "border-black/20")}>
                    {on && <span className="text-[10px] leading-none">✓</span>}
                  </span>
                  <span className="min-w-0 truncate text-ink/80">{o.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
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
