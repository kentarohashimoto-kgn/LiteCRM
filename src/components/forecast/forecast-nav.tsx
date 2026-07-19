import type { SubTab } from "@/components/ui/sub-tabs";

/**
 * 売上予測ハブのページ間タブ(IA再編 S2-2)。
 * 旧・孤立ページだった「来期計画」(/app/forecast/pipeline)をタブとして接続する。
 */
export const FORECAST_TABS: SubTab[] = [
  { href: "/app/forecast", label: "今期予測", exact: true },
  { href: "/app/forecast/pipeline", label: "来期計画（受注見込み入力）" },
];
