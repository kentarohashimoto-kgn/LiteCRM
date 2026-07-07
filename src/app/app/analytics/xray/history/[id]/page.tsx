import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { XrayView, type XrayRange } from "@/components/analytics/xray-view";
import { parseXrayPayload } from "@/lib/xray";

export const dynamic = "force-dynamic";

function fmtPeriodJp(start: string, endExclusive: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(endExclusive + "T00:00:00");
  e.setDate(e.getDate() - 1);
  return `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getFullYear()}/${e.getMonth() + 1}/${e.getDate()}`;
}

/** 保存済みスナップショットの閲覧(保存時点のデータで営業レントゲンを再現)。 */
export default async function XraySnapshotPage({ params }: { params: { id: string } }) {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data: snap } = await sb
    .from("xray_snapshots")
    .select("id, kind, label, taken_at, period_start, period_end, cmp_start, cmp_end, payload")
    .eq("id", params.id)
    .maybeSingle();
  if (!snap) notFound();

  const data = parseXrayPayload(snap.payload);
  if (!data) notFound();

  const range: XrayRange = { start: snap.period_start as string, end: snap.period_end as string };

  return (
    <div>
      <PageHeader
        title="営業レントゲン（保存時点）"
        subtitle="保存されたスナップショットを表示しています。数値は保存時点のもので、現在のデータは反映されません。"
      />
      <XrayView
        initialData={data}
        initialRange={range}
        readOnly
        snapshotMeta={{
          label: (snap.label as string) ?? null,
          kind: snap.kind as string,
          takenAt: snap.taken_at as string,
          periodLabel: fmtPeriodJp(snap.period_start as string, snap.period_end as string),
          cmpLabel: fmtPeriodJp(snap.cmp_start as string, snap.cmp_end as string),
        }}
      />
    </div>
  );
}
