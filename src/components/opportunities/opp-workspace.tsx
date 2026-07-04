"use client";

import { useState } from "react";
import { List, LayoutGrid, CalendarDays, Loader2 } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { leanToOppView } from "@/lib/data/opps-page";
import { fetchAllOppsLeanAction } from "@/server/actions/opportunities";
import { OppPaginatedTable } from "./opp-paginated-table";
import { OppViews } from "./opp-views";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type View = "list" | "board" | "calendar";

export function OppWorkspace({
  initialRows,
  initialTotal,
  initialSumAmount,
  initialSumWeighted,
  owners,
  products,
  sources,
  campaigns,
}: {
  initialRows: OppView[];
  initialTotal: number;
  initialSumAmount: number;
  initialSumWeighted: number;
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns: Option[];
}) {
  const [view, setView] = useState<View>("list");
  const [allOpps, setAllOpps] = useState<OppView[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  async function ensureAll() {
    if (allOpps || loadingAll) return;
    setLoadingAll(true);
    const rows = await fetchAllOppsLeanAction();
    setAllOpps(rows.map(leanToOppView));
    setLoadingAll(false);
  }
  function switchTo(v: View) {
    setView(v);
    if (v !== "list") ensureAll();
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5">
        <Tab active={view === "list"} onClick={() => switchTo("list")} icon={<List size={15} />} label="一覧" />
        <Tab active={view === "board"} onClick={() => switchTo("board")} icon={<LayoutGrid size={15} />} label="ボード" />
        <Tab active={view === "calendar"} onClick={() => switchTo("calendar")} icon={<CalendarDays size={15} />} label="カレンダー" />
      </div>

      {view === "list" ? (
        <OppPaginatedTable
          initialRows={initialRows}
          initialTotal={initialTotal}
          initialSumAmount={initialSumAmount}
          initialSumWeighted={initialSumWeighted}
          owners={owners}
          products={products}
          sources={sources}
          campaigns={campaigns}
        />
      ) : allOpps ? (
        <OppViews opps={allOpps} owners={owners} products={products} sources={sources} campaigns={campaigns} controlledView={view} hideToggle />
      ) : (
        <div className="card card-pad flex items-center gap-2 text-sm text-ink/40">
          <Loader2 size={15} className="animate-spin" /> 読み込み中…
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
