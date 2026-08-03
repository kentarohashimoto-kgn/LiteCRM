import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "settings", label: "基本設定", path: "" },
  { key: "users", label: "受講者", path: "/users" },
  { key: "presets", label: "プリセット", path: "/presets" },
  { key: "usage", label: "利用状況", path: "/usage" },
] as const;

export type CompanyTabKey = (typeof TABS)[number]["key"];

export function CompanyTabs({ companyId, active }: { companyId: string; active: CompanyTabKey }) {
  return (
    <nav className="mb-5 flex gap-1 border-b border-black/[0.06]">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/app/ai-lab/${companyId}${t.path}`}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
            t.key === active
              ? "border-teal-primary text-teal-deep"
              : "border-transparent text-ink/50 hover:text-ink/80",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
