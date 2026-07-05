"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2 } from "lucide-react";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { fetchActivitiesPageAction, type ActivityPageFilter, type ActivityPageRow } from "@/server/actions/activities";

interface Option { id: string; name: string; }
const PAGE = 50;

function fmtDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ActivitiesPaginatedList({
  initialRows,
  initialTotal,
  owners,
}: {
  initialRows: ActivityPageRow[];
  initialTotal: number;
  owners: Option[];
}) {
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");

  const [rows, setRows] = useState<ActivityPageRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialRows.length);
  const hasMore = rows.length < total;

  const filter: ActivityPageFilter = useMemo(
    () => ({ q: q.trim() || undefined, owner: owner || undefined, type: type || undefined }),
    [q, owner, type],
  );

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      const res = await fetchActivitiesPageAction({ filter, offset, limit: PAGE });
      offsetRef.current = offset + res.rows.length;
      setRows((prev) => (replace ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
      setLoading(false);
    },
    [filter],
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
      if (entries[0]?.isIntersecting && !loading && hasMore) load(offsetRef.current, false);
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load, loading, hasMore]);

  return (
    <div>
      {/* フィルタ */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="タイトル・内容・会社名で検索"
            className="input pl-9 w-64"
          />
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="input w-auto">
          <option value="">担当: 全員</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input w-auto">
          <option value="">種別: すべて</option>
          {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <span className="text-xs text-ink/40 ml-auto">{total.toLocaleString()}件</span>
      </div>

      <div className="card card-pad">
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-ink/40 py-8 text-center">活動履歴がありません</p>
        ) : (
          <ul className="space-y-4">
            {rows.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ backgroundColor: a.owner_color ?? "#94a3b8" }}
                >
                  {(a.owner_name || "—").slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1 border-b border-black/[0.04] pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="pill bg-teal-light text-teal-deep">{ACTIVITY_TYPE_MAP[a.activity_type]?.label ?? a.activity_type}</span>
                    <span className="text-sm font-medium text-ink">{a.title}</span>
                    {a.opportunity_id && (
                      <Link href={`/app/opportunities/${a.opportunity_id}`} className="text-xs text-teal-deep hover:underline">
                        {a.opportunity_name ?? "案件を見る"}
                      </Link>
                    )}
                  </div>
                  {a.body && <p className="text-sm text-ink/60 mt-1 whitespace-pre-line">{a.body}</p>}
                  <div className="text-xs text-ink/40 mt-1">
                    {fmtDateTime(a.activity_at)} ・ {a.owner_name}
                    {a.account_name ? ` ・ ${a.account_name}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinel} />
        {loading && (
          <div className="flex justify-center py-4 text-ink/40">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {!hasMore && rows.length > 0 && (
          <p className="text-center text-xs text-ink/30 pt-3">すべて表示しました</p>
        )}
      </div>
    </div>
  );
}
