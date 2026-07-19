import type { SubTab } from "@/components/ui/sub-tabs";

/** 展示会ハブのページ間タブ(IA再編 S2-3)。分析3画面を1つのハブとして行き来できるようにする。 */
export const EXHIBITION_TABS: SubTab[] = [
  { href: "/app/analytics/exhibitions", label: "展示会分析", exact: true },
  { href: "/app/analytics/exhibition-roi", label: "時系列・主催・テーマ" },
  { href: "/app/analytics/exhibition-select", label: "出展選定" },
];
