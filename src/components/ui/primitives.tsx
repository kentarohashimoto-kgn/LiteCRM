import Link from "next/link";
import { cn, formatManYen, initials } from "@/lib/utils";
import type { User } from "@/lib/types";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card card-pad", className)}>{children}</div>;
}

export function Section({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card", className)}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.04]">
        <h2 className="section-title">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink/50 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** ダッシュボードの強調指標カード。数字は大きく、単位は小さく(デザインガイド) */
export function StatCard({
  label,
  amount,
  accent = false,
  sub,
  raw,
}: {
  label: string;
  amount?: number;
  accent?: boolean;
  sub?: React.ReactNode;
  raw?: string;
}) {
  const { value, unit } = amount != null ? formatManYen(amount) : { value: raw ?? "—", unit: "" };
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold text-ink/50">{label}</div>
      <div className="mt-2 flex items-baseline">
        <span className={cn("stat-value", accent && "stat-accent")}>{value}</span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-ink/50">{sub}</div>}
    </div>
  );
}

export function Avatar({ user, size = 28 }: { user?: User; size?: number }) {
  if (!user) return null;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: user.avatarColor ?? "#008C8C" }}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-sm text-ink/40">{message}</div>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "accent" | "ghost";
}) {
  const cls = variant === "accent" ? "btn-accent" : variant === "ghost" ? "btn-ghost" : "btn-primary";
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** 進捗バー(目標達成度など) */
export function ProgressBar({ value, max, tone = "teal" }: { value: number; max: number; tone?: "teal" | "orange" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden">
      <div
        className={cn("h-full rounded-full", tone === "orange" ? "bg-accent-orange" : "bg-teal-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
