import { cn } from "@/lib/utils";
import { FORECAST_MAP, STAGE_MAP } from "@/lib/constants";
import type {
  ForecastCategory,
  OpportunityStage,
  OpportunityStatus,
} from "@/lib/types";

const stageColor: Record<string, string> = {
  open: "bg-teal-light text-teal-deep",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-rose-100 text-rose-600",
  on_hold: "bg-mist-soft text-ink/50",
};

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  const def = STAGE_MAP[stage];
  if (!def) return null;
  return (
    <span className={cn("pill", stageColor[def.group])}>
      {def.label}
      <span className="opacity-60">{def.probability}%</span>
    </span>
  );
}

const forecastColor: Record<ForecastCategory, string> = {
  commit: "bg-teal-primary text-white",
  best_case: "bg-teal-light text-teal-deep",
  pipeline: "bg-mist-soft text-ink/70 border border-black/5",
  upside: "bg-amber-50 text-accent-orange border border-accent-orange/20",
  omitted: "bg-mist-soft text-ink/40",
};

export function ForecastBadge({ category }: { category: ForecastCategory }) {
  const def = FORECAST_MAP[category];
  if (!def) return null;
  return <span className={cn("pill", forecastColor[category])}>{def.label}</span>;
}

const statusColor: Record<OpportunityStatus, string> = {
  open: "bg-teal-light text-teal-deep",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-rose-100 text-rose-600",
  on_hold: "bg-mist-soft text-ink/50",
};
const statusLabel: Record<OpportunityStatus, string> = {
  open: "進行中",
  won: "受注",
  lost: "失注",
  on_hold: "保留",
};

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  return <span className={cn("pill", statusColor[status])}>{statusLabel[status]}</span>;
}

export function RiskBadge({ level }: { level?: string }) {
  if (!level) return null;
  const map: Record<string, string> = {
    high: "bg-rose-100 text-rose-600",
    middle: "bg-amber-50 text-accent-orange",
    low: "bg-emerald-50 text-emerald-600",
  };
  const label: Record<string, string> = { high: "高", middle: "中", low: "低" };
  return <span className={cn("pill", map[level])}>リスク {label[level]}</span>;
}

export function Tag({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "orange" | "gray" }) {
  const map = {
    teal: "bg-teal-light text-teal-deep",
    orange: "bg-amber-50 text-accent-orange",
    gray: "bg-mist-soft text-ink/60",
  };
  return <span className={cn("pill", map[tone])}>{children}</span>;
}
