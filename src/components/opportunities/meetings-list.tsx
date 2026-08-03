"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { MeetingListRow } from "@/server/actions/opportunities";
import { YomiBadge } from "@/components/ui/badges";
import { cn, formatDateFull, formatTimeJst, toJstDate } from "@/lib/utils";

interface Option { id: string; name: string; color?: string; }
type SortKey = "held" | "created";

/** 商談実施日(日付)を返す。日付列が無ければ日時からJST日付を導出。 */
function heldDate(m: MeetingListRow): string {
  return m.meeting_date ?? toJstDate(m.meeting_at) ?? "";
}

export function MeetingsList({ rows, owners }: { rows: MeetingListRow[]; owners: Option[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("held");
  const [asc, setAsc] = useState(false); // 既定: 新しい順(降順)

  // 営業担当は商談の担当を優先し、未設定なら親案件の担当を代わりに表示する。
  const ownerOf = useMemo(() => {
    const map = new Map(owners.map((o) => [o.id, o]));
    return (m: MeetingListRow): { name: string; color?: string; fromOpp: boolean } | null => {
      const own = m.owner_user_id ? map.get(m.owner_user_id) : undefined;
      if (own) return { name: own.name, color: own.color, fromOpp: false };
      const opp = m.opp_owner_user_id ? map.get(m.opp_owner_user_id) : undefined;
      if (opp) return { name: opp.name, color: opp.color, fromOpp: true };
      return null;
    };
  }, [owners]);

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    const key = (m: MeetingListRow) => (sortKey === "created" ? m.created_at : heldDate(m));
    return [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      // 空(未設定)は常に末尾へ
      if (!ka && !kb) return 0;
      if (!ka) return 1;
      if (!kb) return -1;
      return ka < kb ? -dir : ka > kb ? dir : 0;
    });
  }, [rows, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false); // 列を切り替えたら新しい順から
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-black/[0.06]">
        <span className="text-sm font-bold text-ink">商談一覧</span>
        <span className="pill bg-mist-soft text-ink/50">{rows.length}</span>
        <span className="ml-2 text-xs text-ink/45">並び替え</span>
        <SortButton label="商談登録日" active={sortKey === "created"} asc={asc} onClick={() => toggleSort("created")} />
        <SortButton label="商談実施日" active={sortKey === "held"} asc={asc} onClick={() => toggleSort("held")} />
        <span className="ml-auto text-[11px] text-ink/35">案件 › 商談。行の商談名/案件名から詳細へ移動できます。</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/40 py-10 text-center">商談がありません。アポ・商談登録から作成できます。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <SortableTh label="商談実施日" active={sortKey === "held"} asc={asc} onClick={() => toggleSort("held")} />
                <th className="th">時刻</th>
                <SortableTh label="商談登録日" active={sortKey === "created"} asc={asc} onClick={() => toggleSort("created")} />
                <th className="th">顧客名</th>
                <th className="th">案件名</th>
                <th className="th">商談名</th>
                <th className="th">ヨミ</th>
                <th className="th">営業担当</th>
                <th className="th min-w-[200px]">商談概要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {sorted.map((m) => (
                <tr key={m.id} className="align-top row-hover">
                  <td className="td tabular-nums text-ink/70">{formatDateFull(heldDate(m) || m.meeting_at) || "—"}</td>
                  <td className="td tabular-nums text-ink/70">{formatTimeJst(m.meeting_at) || "—"}</td>
                  <td className="td tabular-nums text-ink/50">{formatDateFull(m.created_at)}</td>
                  <td className="td font-medium max-w-[160px] truncate" title={m.account_name}>{m.account_name}</td>
                  <td className="td max-w-[170px] truncate">
                    <Link href={`/app/opportunities/${m.opportunity_id}`} className="text-teal-deep hover:underline" title={m.opp_name}>{m.opp_name}</Link>
                  </td>
                  <td className="td max-w-[150px] truncate">
                    {m.title
                      ? <Link href={`/app/opportunities/${m.opportunity_id}/meetings/${m.id}`} className="hover:underline text-ink/80" title={m.title}>{m.title}</Link>
                      : <span className="text-ink/30">—</span>}
                  </td>
                  <td className="td"><YomiBadge yomi={m.yomi} /></td>
                  <td className="td whitespace-nowrap"><OwnerCell owner={ownerOf(m)} /></td>
                  <td className="td whitespace-normal text-[12.5px] text-ink/60"><span className="line-clamp-2">{m.summary || <span className="text-ink/25">—</span>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 営業担当セル。色ドット＋氏名。案件担当で補完した場合は末尾に(案件)を付ける。 */
function OwnerCell({ owner }: { owner: { name: string; color?: string; fromOpp: boolean } | null }) {
  if (!owner) return <span className="text-ink/25">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-ink/70" title={owner.fromOpp ? `${owner.name}（案件の担当）` : owner.name}>
      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: owner.color ?? "#008C8C" }} />
      {owner.name}
      {owner.fromOpp && <span className="text-[10px] text-ink/35">(案件)</span>}
    </span>
  );
}

function SortButton({ label, active, asc, onClick }: { label: string; active: boolean; asc: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-teal-primary bg-teal-light text-teal-deep" : "border-black/10 text-ink/55 hover:text-ink",
      )}
    >
      {label}
      {active && (asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
}

function SortableTh({ label, active, asc, onClick }: { label: string; active: boolean; asc: boolean; onClick: () => void }) {
  return (
    <th className="th">
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-teal-deep font-semibold")}>
        {label}
        {active && (asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}
