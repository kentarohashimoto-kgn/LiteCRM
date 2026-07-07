import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { XrayView, type XrayRange } from "@/components/analytics/xray-view";
import { parseXrayPayload } from "@/lib/xray";

export const dynamic = "force-dynamic";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 営業レントゲン: 売上の方程式を因数分解し、悪化ノードと機会損失額を診断する。 */
export default async function XrayPage() {
  await requireCtx();
  const sb = getSupabaseServer();

  // 初期表示: 過去3ヶ月 vs 直前3ヶ月(クライアント側で自由に変更可)
  const end = new Date();
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 3);
  const cmpStart = new Date(start);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  cmpStart.setDate(cmpStart.getDate() - days);

  const range: XrayRange = { start: isoDate(start), end: isoDate(end) };
  const { data } = await sb.rpc("xray_metrics", {
    p_start: range.start,
    p_end: range.end,
    p_cmp_start: isoDate(cmpStart),
    p_cmp_end: range.start,
  });

  return (
    <div>
      <PageHeader
        title="営業レントゲン"
        subtitle="売上 = リード数 × アポ獲得率 × 商談実施率 × 受注率 × 平均単価。どの因数が悪化しているかを診断し、改善インパクトの大きい順に処方箋を出します。"
      />
      <XrayView initialData={parseXrayPayload(data)} initialRange={range} />
    </div>
  );
}
