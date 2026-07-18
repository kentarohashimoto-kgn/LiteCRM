import type { SubTab } from "@/components/ui/sub-tabs";

/** 営業担当別ハブのページ間タブ(IA再編 S2-4)。担当別の「現在・分析・週報」を1つのハブとして接続する。 */
export const REP_TABS: SubTab[] = [
  { href: "/app/reps", label: "営業ビュー" },
  { href: "/app/analytics/sales-reps", label: "営業マン別分析" },
  { href: "/app/reviews/rep", label: "営業マン別週報" },
];
