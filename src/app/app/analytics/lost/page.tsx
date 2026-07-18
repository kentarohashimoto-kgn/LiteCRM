import { redirect } from "next/navigation";

/**
 * 旧「失注分析」。理由別・競合別は失注/成約分析(winloss)が同等以上をカバーし、
 * 独自だった月別集計もwinlossへ吸収済みのためリダイレクトのみ残す
 * (docs/IA_MENU_REORG_PLAN_2026-07.md S2-1)。
 */
export default function LostAnalysisPage() {
  redirect("/app/analytics/winloss");
}
