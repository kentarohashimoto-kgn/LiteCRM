"use client";

import { useState } from "react";
import { List, LayoutGrid, CalendarDays, FileText, Loader2 } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { leanToOppView } from "@/lib/data/opps-page";
import { fetchAllOppsLeanAction, fetchCalendarItemsAction } from "@/server/actions/opportunities";
import type { CalItem } from "@/lib/data/calendar";
import { fetchProposalOppsAction, type ProposalOppRow } from "@/server/actions/proposals";
import { OppPaginatedTable } from "./opp-paginated-table";
import { OppViews } from "./opp-views";
import { ProposalBoard } from "./proposal-board";
import { AppointmentCalendarPro, type BookingLink } from "./appointment-calendar-pro";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type View = "list" | "board" | "calendar" | "proposal";

export function OppWorkspace({
  initialRows,
  initialTotal,
  initialSumAmount,
  initialSumWeighted,
  owners,
  products,
  sources,
  campaigns,
  bookingLinks = [],
  canReassign = false,
}: {
  initialRows: OppView[];
  initialTotal: number;
  initialSumAmount: number;
  initialSumWeighted: number;
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns: Option[];
  bookingLinks?: BookingLink[];
  canReassign?: boolean;
}) {
  const [view, setView] = useState<View>("list");
  const [allOpps, setAllOpps] = useState<OppView[] | null>(null);      // ボード用(全件)
  const [calItems, setCalItems] = useState<CalItem[] | null>(null);    // カレンダー用(アポ＋アポ済)
  const [proposalRows, setProposalRows] = useState<ProposalOppRow[] | null>(null); // 提案タブ用
  const [loadingAll, setLoadingAll] = useState(false);

  async function ensureAll() {
    if (allOpps || loadingAll) return;
    setLoadingAll(true);
    const rows = await fetchAllOppsLeanAction();
    setAllOpps(rows.map(leanToOppView));
    setLoadingAll(false);
  }
  async function ensureAppts() {
    if (calItems || loadingAll) return;
    setLoadingAll(true);
    setCalItems(await fetchCalendarItemsAction());
    setLoadingAll(false);
  }
  async function ensureProposals() {
    if (proposalRows || loadingAll) return;
    setLoadingAll(true);
    setProposalRows(await fetchProposalOppsAction());
    setLoadingAll(false);
  }
  function switchTo(v: View) {
    setView(v);
    if (v === "board") ensureAll();
    if (v === "calendar") ensureAppts();
    if (v === "proposal") ensureProposals();
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5">
        <Tab active={view === "list"} onClick={() => switchTo("list")} icon={<List size={15} />} label="一覧" />
        <Tab active={view === "board"} onClick={() => switchTo("board")} icon={<LayoutGrid size={15} />} label="ボード" />
        <Tab active={view === "calendar"} onClick={() => switchTo("calendar")} icon={<CalendarDays size={15} />} label="カレンダー" />
        <Tab active={view === "proposal"} onClick={() => switchTo("proposal")} icon={<FileText size={15} />} label="提案" />
      </div>

      {view === "proposal" ? (
        proposalRows ? (
          <ProposalBoard rows={proposalRows} />
        ) : (
          <div className="card card-pad flex items-center gap-2 text-sm text-ink/40"><Loader2 size={15} className="animate-spin" /> 読み込み中…</div>
        )
      ) : view === "list" ? (
        <OppPaginatedTable
          initialRows={initialRows}
          initialTotal={initialTotal}
          initialSumAmount={initialSumAmount}
          initialSumWeighted={initialSumWeighted}
          owners={owners}
          products={products}
          sources={sources}
          campaigns={campaigns}
          canReassign={canReassign}
        />
      ) : view === "calendar" ? (
        calItems ? (
          <AppointmentCalendarPro items={calItems} owners={owners} bookingLinks={bookingLinks} />
        ) : (
          <div className="card card-pad flex items-center gap-2 text-sm text-ink/40"><Loader2 size={15} className="animate-spin" /> 読み込み中…</div>
        )
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
