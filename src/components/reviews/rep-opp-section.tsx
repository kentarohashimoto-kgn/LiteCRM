"use client";

import { useState } from "react";
import { List, CalendarRange } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { RepOppTable } from "@/components/reviews/rep-opp-table";
import { RepMonthlyPlan } from "@/components/reviews/rep-monthly-plan";
import type { RepReportOpp, MonthPlan } from "@/lib/data/rep-report";

type Mode = "list" | "monthly";

/**
 * 担当案件セクション。「一覧」モード(既存の案件テーブル)と
 * 「月別ヨミ」モード(今月〜2ヶ月先の成約計画)を切り替えて表示する。
 */
export function RepOppSection({
  opps,
  ownerId,
  weekStart,
  members,
  monthlyPlan,
  monthlyPlanAll,
}: {
  opps: RepReportOpp[];
  ownerId: string;
  weekStart: string;
  members: { id: string; name: string }[];
  monthlyPlan: MonthPlan[];
  monthlyPlanAll: MonthPlan[];
}) {
  const [mode, setMode] = useState<Mode>("list");

  const toggle = (
    <div className="inline-flex rounded-lg border border-black/10 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode("list")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
          mode === "list" ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink",
        )}
      >
        <List size={13} /> 一覧
      </button>
      <button
        type="button"
        onClick={() => setMode("monthly")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
          mode === "monthly" ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink",
        )}
      >
        <CalendarRange size={13} /> 月別ヨミ
      </button>
    </div>
  );

  const title = mode === "list" ? `担当案件（進行中 ${opps.length}）` : "月別ヨミ（成約計画：今月〜2ヶ月先）";

  return (
    <Section title={title} action={toggle}>
      {mode === "list" ? (
        opps.length === 0 ? (
          <EmptyState message="進行中の担当案件がありません。" />
        ) : (
          <RepOppTable opps={opps} ownerId={ownerId} weekStart={weekStart} members={members} />
        )
      ) : (
        <RepMonthlyPlan plan={monthlyPlan} planAll={monthlyPlanAll} ownerId={ownerId} members={members} />
      )}
    </Section>
  );
}
