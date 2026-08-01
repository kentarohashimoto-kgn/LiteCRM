import Link from "next/link";

/**
 * SEO各画面共通のサイト切替チップ。
 *
 * catorce.jp は法人HP（/）とキャリプラ（/career/）の2計測サイトが同居しており、
 * KPIも検索意図も別物。切替がサマリーにしか無いと、順位表や提案が
 * 事実上「法人専用」になってしまうため、運用系の全画面に同じ導線を置く。
 */
export interface SwitchableSite {
  id: string;
  name: string;
  audience: string;
  status: string;
}

export function SiteSwitcher({
  sites,
  currentId,
  basePath,
}: {
  sites: SwitchableSite[];
  currentId: string;
  basePath: string;
}) {
  const active = sites.filter((s) => s.status === "active");
  if (active.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {active.map((s) => (
        <Link
          key={s.id}
          href={`${basePath}?site=${s.id}`}
          className={`rounded-full border px-3 py-1 text-xs ${
            s.id === currentId
              ? "border-teal-500 bg-teal-50 text-teal-800"
              : "border-black/10 text-ink/60 hover:bg-black/[0.03]"
          }`}
        >
          {s.name}
          <span className="ml-1 text-ink/40">{s.audience.toUpperCase()}</span>
        </Link>
      ))}
    </div>
  );
}
